#!/usr/bin/env node
/* audit-ui.js — the checks that a screenshot caught and the file audit didn't.
 *
 * Run from the repo root:   node tools/audit-ui.js
 *
 * Three classes of bug, each of which shipped at least once:
 *
 *   1. SIBLING GEOMETRY   Rows in one container disagreeing on padding, weight, or display.
 *                         The Gift shop row was an <a>, so the `.d-items button` rule never
 *                         reached it: 16px side padding against everyone else's 20px.
 *
 *   2. ICON SLOT CONTEXT  A fixed-width icon column only works inside a flex parent. The two
 *                         .d-section-label rows were plain blocks, so flex-basis was ignored and
 *                         `gap` did nothing — their labels sat ~38px left of every other row.
 *
 *   3. STALE SELECTORS    A rule from a previous layout still applying. #passportToggle was left
 *                         in the old absolute-positioned map-control stack, and its
 *                         justify-content:center survived to centre the drawer label. It was
 *                         invisible to a conflict check because nothing competed with it.
 *
 * Exits non-zero when anything fails, so it can gate a commit.
 */
const fs = require('fs');

const css = fs.readFileSync('shell.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
          + '\n' + fs.readFileSync('styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync('index.html', 'utf8');
let failures = 0;
const fail = (msg) => { console.log('  FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('  ok    ' + msg);

// Collect the winning declarations for a selector across both sheets, in source order.
function declsFor(selector) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map(s => s.trim());
    if (!sels.includes(selector)) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

// ---- 1 + 2: every drawer row must be a flex row on the same left gutter ----
/* Repointed from the drawer to the SHEET, which replaced it. Left aimed at #appDrawer these
 * checks reported "0 drawer rows" and passed while guarding nothing at all — a green tick for an
 * element that no longer exists is worse than no check, because it reads as coverage. */
console.log('\nmenu row geometry');
const ROWS = ['.ss-row', '.ss-body .d-toggle',
              '.ss-body .d-collapse-head', '.ss-body .d-section-label'];
const geo = ROWS.map(sel => {
  const d = declsFor(sel);
  const padLeft = (d.padding || '').replace('!important', '').trim().split(/\s+/);
  return {
    sel,
    display: (d.display || '').replace('!important', '').trim(),
    gap: (d.gap || '').trim(),
    left: padLeft.length >= 2 ? padLeft[1] : padLeft[0] || '',
  };
});
/* Resolve var() before comparing. The rules are tokenised now, so a literal string compare
 * reported every row as broken while the computed geometry was in fact identical — a check that
 * fails on correct code trains you to ignore it, which is worse than not having it. */
const TOKENS = Object.fromEntries(
  [...css.matchAll(/--([\w-]+)\s*:\s*([^;}]+)[;}]/g)].map(m => [m[1], m[2].trim()]));
const resolve = (v) => {
  let out = String(v || ''), guard = 0;
  while (/var\(--/.test(out) && guard++ < 6) {
    out = out.replace(/var\(--([\w-]+)(?:,[^)]*)?\)/g, (_, k) => TOKENS[k] || '');
  }
  return out.trim();
};
const WANT = { gap: '12px', left: '16px' };
const bad = geo.filter(g => g.display !== 'flex' || resolve(g.gap) !== WANT.gap || resolve(g.left) !== WANT.left);
if (bad.length) bad.forEach(b => fail(`${b.sel}: display=${b.display || '-'} gap=${resolve(b.gap) || '-'} left=${resolve(b.left) || '-'} (want flex / ${WANT.gap} / ${WANT.left})`));
else pass(`all ${ROWS.length} row types: flex, gap ${WANT.gap}, left padding ${WANT.left}`);

console.log('\nicon slot');
const items = html.slice(html.indexOf('<div class="ss-body">'), html.indexOf('<div class="ss-foot">'));
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const rowRe = /<(button|div|a)[^>]*class="[^"]*(?:ss-row|ss-shop|d-collapse-head|d-section-label|d-toggle)[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
let r, checked = 0, stray = 0;
while ((r = rowRe.exec(items))) {
  checked++;
  const label = r[2].replace(/<span class="d-ico[^>]*>[\s\S]*?<\/span>/g, '')
                    .replace(/<[^>]*>/g, '').replace(/[▾▸]/g, '').trim();
  if (EMOJI.test(label)) { fail('emoji outside .d-ico in row: ' + JSON.stringify(label.slice(0, 40))); stray++; }
}
if (!stray) pass(checked + ' menu rows, every emoji inside a .d-ico slot');

// ---- 3: stale selectors — absolute positioning on a drawer child ----
console.log('\nstale selectors');
const drawerIds = [...items.matchAll(/id="([^"]+)"/g)].map(m => '#' + m[1]);   // sheet ids now
let staleFound = 0;
for (const id of drawerIds) {
  const d = declsFor(id);
  if (!Object.keys(d).length) continue;
  const bad = [];
  if ((d.position || '').includes('absolute')) bad.push('position:absolute');
  if ((d.justifyContent || d['justify-content'] || '').includes('center')) bad.push('justify-content:center');
  if (bad.length) { fail(`${id} is a menu row but still has ${bad.join(' + ')} from an earlier layout`); staleFound++; }
}
if (!staleFound) pass(drawerIds.length + ' menu ids carry no leftover positioning rules');

// ---- 3b: the menu must be reachable ----
/* With the drawer deleted the sheet is the ONLY route to every setting, the passport and the
 * FAQ. If #menuBtn ever stops opening it, the app has no menu at all — a failure no other check
 * here would notice, because every individual control would still be present and correct. */
console.log('\nmenu reachable');
if (!/getElementById\('menuBtn'\)/.test(html)) fail('#menuBtn is never looked up');
else if (!/openSettingsSheet\s*\(/.test(html)) fail('#menuBtn does not open the settings sheet');
else pass('#menuBtn opens the settings sheet');
if (/id="appDrawer"/.test(html)) fail('the drawer markup is back — two menus again');
else pass('no drawer markup remains');

// ---- 3c: the popup builders must actually RUN ----
/* Added after a temporal-dead-zone bug shipped in four consecutive builds and broke every popup
 * on the map. `node --check` passed (the syntax was valid), every grep passed (every pattern was
 * correct), and nothing here noticed, because none of these checks EXECUTE anything.
 *
 * A const read four lines above its own declaration is invisible to static inspection and
 * instant on the first call. So this calls the function. */
console.log('\npopup builders execute');
(() => {
  const L = html && fs.readFileSync('app.js', 'utf8').split('\n');
  const at = re => L.findIndex(x => re.test(x));
  const s1 = at(/^const RATING_DIMS = \[/), e1 = at(/^const ratingSkips = \{\};/);
  const s2 = at(/^function ratingSectionInnerHtml/);
  if (s1 < 0 || e1 < 0 || s2 < 0) { fail('could not locate the rating block to test'); return; }
  let d = 0, e2 = s2;
  for (let i = s2; i < L.length; i++) {
    d += (L[i].match(/\{/g) || []).length - (L[i].match(/\}/g) || []).length;
    if (i > s2 && d === 0) { e2 = i; break; }
  }
  const stub = `
    const escapeHtml = s => String(s ?? '');
    const avgStr = (s, c) => c > 0 ? (s / c).toFixed(1) : '-';
    const oooCache = {};
    function oooStatus(){ return { phase:'none' }; }
    function relativeTimeFromNow(){ return 'x'; }
    function ico(){ return ''; }
    function plate(t){ return '[' + t + ']'; }
    function ratingConfidenceHtml(){ return ''; }
    function quipFor(){ return 'q'; }
    function starsHtml(){ return '[stars]'; }
    ${L.slice(s1, e1 + 1).join('\n')}
    ${L.slice(s2, e2 + 1).join('\n')}
    return ratingSectionInnerHtml;`;
  let fn;
  try { fn = new Function(stub)(); }
  catch (e) { fail('rating block will not even load: ' + e.message); return; }
  const loc = { id: 'x' };
  const agg = { bathroomSum: 8, bathroomCount: 2, safeSum: 9, safeCount: 2 };
  const states = [
    ['nothing answered', { bathroom: 0, safe: 0 }],
    ['overall only',     { bathroom: 4, safe: 0 }],
    ['safety only',      { bathroom: 0, safe: 5 }],
    ['both answered',    { bathroom: 4, safe: 5 }],
  ];
  let bad = 0;
  for (const [name, vote] of states) {
    try {
      const out = fn(loc, agg, vote);
      if (!out || !out.includes('[stars]')) { fail(name + ': rendered without a star row'); bad++; }
    } catch (e) { fail(name + ': THREW ' + e.message); bad++; }
  }
  if (!bad) pass('ratingSectionInnerHtml renders in all ' + states.length + ' answer states');
})();

// ---- 3d: personal counts must not depend on what has downloaded ----
/* Public restrooms load region by region, so seedLocations holds a fraction of the map at any
 * moment. Anything that counts a person's own history by looking a location UP will silently
 * drop the rest — which is how a passport came to show 1 rating for someone who had left 12,
 * and how the footer came to claim 28,074 locations out of 84,079. Both were the same mistake
 * in different places, so this checks for the shape of it rather than either instance. */
console.log('\npersonal counts vs lazy loading');
{
  /* Read locally: `app` is declared BELOW this block, and reaching for it here threw exactly
   * the temporal-dead-zone error this file now exists to catch. Fitting, and a reminder that a
   * check written above its own dependency is no better than the code it audits. */
  const appSrc = fs.readFileSync('app.js', 'utf8');
  /* Comments stripped first. The function carries a comment explaining why it no longer uses
   * seedLocations.find, and matching prose that describes the bug is how a check reports a
   * failure that was already fixed. */
  const stats = appSrc.slice(appSrc.indexOf('async function computeAchievementStats'),
                             appSrc.indexOf('async function computeAchievementStats') + 9000)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/seedLocations\.find/.test(stats))
    fail('computeAchievementStats resolves locations by scanning seedLocations — unloaded regions will be dropped');
  else if (!/bathroomRatedCount = ratedAll\.length/.test(stats))
    fail('bathroomRatedCount is derived from location-resolved votes, not from the votes themselves');
  else pass('rating counts come from the votes, not from what is loaded');

  if (/pendingPublicCount/.test(appSrc)) pass('footer totals include regions not yet downloaded');
  else fail('footer counts only what has downloaded');
}

// ---- 3e: rows moved between panels must bring their filler ----
/* The email row was moved from the passport into settings and its populating function stayed
 * behind, so it showed a loading placeholder forever. The same trap applies to any row that is
 * written by JS rather than authored in markup: check that whatever fills it is reachable from
 * the panel it now lives in. */
console.log('\nmoved rows keep their data');
{
  const src = fs.readFileSync('app.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const open = src.slice(src.indexOf('function openSettingsSheet'),
                         src.indexOf('function closeSettingsSheet'));
  if (!/renderAccountRecovery\(\)/.test(open))
    fail('#acctEmailRow lives in settings but nothing fills it when settings opens');
  else pass('settings fills the account rows it owns');
}

// ---- 3f: every amenity value list in the rules must agree ----
/* firestore.rules validates amenity values in THREE separate places — two helpers for the
 * admin-override path and one inside knownAmenityMap, which is the one that actually guards a
 * vote. Adding a new state to two of the three looks published and rejects every write, with a
 * permission-denied the UI reported as a generic "could not save". */
console.log('\namenity value lists');
{
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  const lists = [...rules.matchAll(/\['yes','no','unknown',([^\]]*)\]/g)].map(m => m[0]);
  const app = fs.readFileSync('app.js', 'utf8');
  const states = new Set(['yes', 'no', 'unknown', '']);
  [...app.matchAll(/states:\[([^\]]+)\]/g)].forEach(m =>
    m[1].replace(/'/g, '').split(',').forEach(v => states.add(v.trim())));

  if (!lists.length) fail('no amenity value list found in firestore.rules');
  else if (new Set(lists).size !== 1)
    fail(`${new Set(lists).size} DIFFERENT amenity value lists in firestore.rules — a value allowed by one will be rejected by another`);
  else {
    const allowed = new Set(lists[0].replace(/[\[\]']/g, '').split(',').map(v => v.trim()));
    const missing = [...states].filter(v => !allowed.has(v));
    if (missing.length) fail('app.js can emit amenity value(s) the rules reject: ' + missing.join(', '));
    else pass(`all ${lists.length} rules lists agree, and cover every state app.js can emit`);
  }
}

// ---- 3g: removing a field needs deleteField, not a merge ----
/* Every vote write goes through setDoc({ merge: true }), and a merge cannot remove anything —
 * it merges nested maps key by key. Deleting a key from the local object and saving therefore
 * looks like it worked until the next reload, when the server's copy comes back. Any code path
 * whose PURPOSE is to remove an answer has to use deleteField on the dotted path. */
console.log('\nfield removal');
{
  const src = fs.readFileSync('app.js', 'utf8');
  const fbjs = fs.existsSync('firebase.js') ? fs.readFileSync('firebase.js', 'utf8') : '';
  const reopen = src.slice(src.indexOf("closest('[data-reopen]')"), src.indexOf("closest('[data-reopen]')") + 2600);
  if (!reopen) fail('could not find the reopen handler to check');
  else if (/saveMyVote\(/.test(reopen) && !/deleteField\(\)/.test(reopen))
    fail('the reopen handler saves via merge — the removed answer will come back on reload');
  else if (!/deleteField\(\)/.test(reopen))
    fail('the reopen handler does not use deleteField');
  else if (!/deleteField/.test(fbjs))
    fail('deleteField is used in app.js but not exported from firebase.js');
  else pass('answer removal uses deleteField on a dotted path, and it is exported');
}

// ---- 4: constants duplicated across files ----
console.log('\nduplicated constants');
const app = fs.readFileSync('app.js', 'utf8');
const thr = (app.match(/const CONFIRM_THRESHOLD\s*=\s*(\d+)/) || [])[1];
if (fs.existsSync('bake-confirmed.js')) {
  const mn = (fs.readFileSync('bake-confirmed.js', 'utf8').match(/const MIN_YES\s*=\s*(\d+)/) || [])[1];
  if (thr && mn && thr !== mn) fail(`CONFIRM_THRESHOLD is ${thr} in app.js but MIN_YES is ${mn} in bake-confirmed.js`);
  else pass(`vote threshold agrees across app.js and bake-confirmed.js (${thr})`);
}
const dates = [...new Set((html.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/g) || []))];
if (dates.length > 1) fail('more than one date string in index.html: ' + dates.join(' | '));
else pass('index.html shows a single date' + (dates[0] ? ' (' + dates[0] + ')' : ''));

// ---- 5: Firestore-safe ids ----
console.log('\nfirestore-safe ids');
{
  const dataFiles = fs.readdirSync('.').filter(f => f.endsWith('-locations.js') && f !== 'compact-locations.js');
  const g = {};
  for (const f of dataFiles) {
    const src = fs.readFileSync(f, 'utf8');
    if (/^\s*#!/.test(src)) continue;
    try { new Function('window', src)(g); } catch (e) { fail(`${f} did not evaluate: ${e.message}`); }
  }
  let unsafe = 0, missingSrc = 0, total = 0;
  for (const arr of Object.values(g)) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (!r || !r.id) continue;
      total++;
      const id = String(r.id);
      // '/' is a Firestore path separator: doc(db,'votes','node/1_uid') is a 3-segment path and
      // doc() throws on an odd count. 6,595 ids used to contain one, so ratings, aggregates,
      // tips and admin overrides failed silently for 23.5% of the map.
      if (id.includes('/')) unsafe++;
      // A renamed id must keep its original, because the transform has no correct inverse:
      // 39 ids hold two slashes and one holds a genuine '__'.
      if (id.includes('__') && !(r.meta && r.meta.srcId)) missingSrc++;
    }
  }
  if (unsafe) fail(`${unsafe} location id(s) contain "/" and cannot be Firestore document ids`);
  else pass(`${total} ids are Firestore-safe`);
  if (missingSrc) fail(`${missingSrc} id(s) contain "__" without meta.srcId — provenance lost, and the transform has no inverse`);
  else pass('every "__" id preserves meta.srcId');
}

// ---- 6: no unnormalised id reaches a Firestore path ----
console.log('\nfirestore path construction');
{
  const LOC_KEYED = ['votes', 'aggregates', 'tips', 'amenityOverrides', 'hourReports', 'overrides'];
  // Comments must be stripped first: the explanatory comments beside fsId() quote example calls
  // like doc(db,'votes','node/123_uid') to show what used to break, and scanning raw source
  // flagged those as real leaks.
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  let leaks = 0;
  for (const file of ['app.js', 'flushpanel.html']) {
    if (!fs.existsSync(file)) continue;
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const coll of LOC_KEYED) {
      const re = new RegExp("doc\\(db,\\s*'" + coll + "',\\s*([^)]+?)\\)", 'g');
      let m;
      while ((m = re.exec(src))) {
        const arg = m[1];
        // Accept fsId(...) anywhere in the argument, or a variable already named safeId.
        if (/fsId\(/.test(arg) || /\bsafeId\b/.test(arg)) continue;
        leaks++;
        fail(`${file}: doc(db,'${coll}', ${arg.trim().slice(0, 46)}) is not normalised — wrap the id in fsId()`);
      }
    }
  }
  if (!leaks) pass('every location-keyed doc() path is normalised');
}

// ---- 7: chain keys referenced in code must exist in CHAIN_REGISTRY ----
console.log('\nchain keys');
{
  const appSrc = fs.readFileSync('app.js', 'utf8');
  const seg = appSrc.slice(appSrc.indexOf('const CHAIN_REGISTRY'), appSrc.indexOf('const DEFAULT_CHAIN_KEY'));
  const registry = new Set([...seg.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]));
  const pairs = [...seg.matchAll(/(\w+):\s*\{[^}]*?dataVar:\s*'(\w+)'/g)].map(m => [m[2], m[1]]);
  // Every hand-written key list in app.js
  let unknown = 0;
  for (const name of ['TRAVEL_CENTER_KEYS']) {
    const m = appSrc.match(new RegExp('const ' + name + "\\s*=\\s*new Set\\(\\[([^\\]]*)\\]"));
    if (!m) continue;
    for (const k of [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1])) {
      if (!registry.has(k)) { fail(`${name} references '${k}', which is not a CHAIN_REGISTRY key`); unknown++; }
    }
  }
  if (!unknown) pass(`hand-kept chain key lists all resolve against ${registry.size} registry entries`);
  // FlushPanel must map any dataVar whose naive suffix-strip differs from the registry key
  if (fs.existsSync('flushpanel.html')) {
    const fp = fs.readFileSync('flushpanel.html', 'utf8');
    let untabled = 0;
    for (const [dv, key] of pairs) {
      if (dv.replace(/Locations$/, '') === key) continue;
      if (!new RegExp(dv + "\\s*:\\s*'" + key + "'").test(fp)) {
        fail(`flushpanel: ${dv} maps to registry key '${key}', but DATAVAR_TO_CHAIN_KEY does not say so`);
        untabled++;
      }
    }
    if (!untabled) pass('flushpanel dataVar -> chain key mapping is complete');
  }
}

// ---- 8: FlushPanel must see every dataset the app does ----
console.log('\nadmin dataset coverage');
{
  const idxFiles = [...html.matchAll(/src="([\w-]+-locations\.js)"/g)].map(m => m[1]);
  if (!fs.existsSync('flushpanel.html')) {
    pass('flushpanel.html not present, skipped');
  } else {
    const fp = fs.readFileSync('flushpanel.html', 'utf8');
    const fpFiles = new Set([...fp.matchAll(/src="([\w-]+-locations\.js)"/g)].map(m => m[1]));
    // 18 of 40 used to load, so 13,915 records could not be moderated at all.
    const missing = idxFiles.filter(f => !fpFiles.has(f));
    if (missing.length) fail(`flushpanel is missing ${missing.length} dataset(s) the app loads: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}`);
    else pass(`flushpanel loads all ${idxFiles.length} datasets`);

    // The one table that replaced three drifted hand-kept lists must cover every registry chain.
    /* Except the generated ones. CHAIN_TABLE's third column is "the file to paste a new record
     * into", which assumes a hand-maintained dataset. usPublic spans ten public-*-locations.js
     * files written by build-public-toilets.js, and anything pasted into one is destroyed by
     * the next build — offering it in Add Location would invite work that silently disappears.
     * Listed here rather than silently skipped, so a future generated chain has to make the
     * same decision on purpose. */
    const GENERATED_CHAINS = new Set(['usPublic']);
    const appSrc = fs.readFileSync('app.js', 'utf8');
    const seg = appSrc.slice(appSrc.indexOf('const CHAIN_REGISTRY'), appSrc.indexOf('const DEFAULT_CHAIN_KEY'));
    const regKeys = [...seg.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
    const tableKeys = new Set([...fp.matchAll(/\["[^"]*","(\w+)","[\w-]+-locations\.js"\]/g)].map(m => m[1]));
    const absent = regKeys.filter(k => !tableKeys.has(k) && !GENERATED_CHAINS.has(k));
    if (absent.length) fail(`CHAIN_TABLE is missing registry key(s): ${absent.join(', ')}`);
    else pass(`CHAIN_TABLE covers all ${regKeys.length - GENERATED_CHAINS.size} hand-maintained registry chains`
      + ` (${GENERATED_CHAINS.size} generated chain(s) exempt)`);
    const wrongly = [...GENERATED_CHAINS].filter(k => tableKeys.has(k));
    if (wrongly.length) fail(`CHAIN_TABLE lists generated chain(s) whose files are rebuilt: ${wrongly.join(', ')}`);

    // And every filename it names must actually exist.
    const bad = [...fp.matchAll(/\["[^"]*","\w+","([\w-]+-locations\.js)"\]/g)]
      .map(m => m[1]).filter(f => !fs.existsSync(f));
    if (bad.length) fail(`CHAIN_TABLE names ${bad.length} file(s) that do not exist: ${bad.join(', ')}`);
    else pass('every CHAIN_TABLE filename exists');
  }
}

// ---- 9: every field the app writes onto a vote must be in the rules allowlist ----
console.log('\nvote field allowlist');
{
  if (!fs.existsSync('firestore.rules')) {
    pass('firestore.rules not present, skipped');
  } else {
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    const appSrc = fs.readFileSync('app.js', 'utf8');
    // The create allowlist inside match /votes/
    const voteBlock = rules.slice(rules.indexOf('match /votes/'), rules.indexOf('match /votes/') + 1400);
    const m = voteBlock.match(/hasOnly\(\[([\s\S]*?)\]\)/);
    const allow = m ? [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : [];
    // Every field assigned onto a vote object in app.js, plus emptyVote's own shape.
    const assigned = [
      ...[...appSrc.matchAll(/myVote(?:Cache\[[^\]]+\])?\.(\w+)\s*=/g)].map(x => x[1]),
      ...[...appSrc.matchAll(/updatedVote\.(\w+)\s*=/g)].map(x => x[1]),
      ...[...appSrc.matchAll(/payload\.(\w+)\s*=/g)].map(x => x[1]),
    ];
    const ev = appSrc.match(/function emptyVote\(\)\s*\{\s*return\s*\{([^}]*)\}/);
    if (ev) assigned.push(...[...ev[1].matchAll(/(\w+)\s*:/g)].map(x => x[1]));
    const missing = [...new Set(assigned)].filter(k => !allow.includes(k));
    /* wasHiddenGem was assigned onto the vote by the Hidden Gem Hunter achievement and was never
     * in this allowlist, so from the moment it was set EVERY write of that vote was rejected —
     * the rating and every amenity answer after it. It only fires where bathroomCount < 5, so it
     * hit precisely the locations nobody had rated yet, and it went unnoticed for weeks. */
    if (missing.length) fail(`app.js writes vote field(s) the rules reject: ${missing.join(', ')}`);
    else pass(`all ${new Set(assigned).size} vote fields written by app.js are allowlisted (${allow.length} allowed)`);
  }
}

// ---- 10: the hours canonicalisers must agree ----
console.log('\nhours canonicaliser');
{
  const pull = (file, name) => {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const start = lines.findIndex(l => l.includes('function ' + name + '('));
    if (start < 0) return null;
    let end = start;
    for (let i = start + 1; i < lines.length; i++) if (lines[i] === '}') { end = i; break; }
    try {
      const ex = {};
      new Function('exports', lines.slice(start, end + 1).join('\n') + '; exports.f=' + name + ';')(ex);
      return ex.f;
    } catch (e) { return null; }
  };
  const A = pull('app.js', 'canonHrsOne');
  const F = pull('functions/index.js', 'canonOne');
  if (!A || !F) {
    fail('could not extract one of the hours canonicalisers');
  } else {
    /* Both accepted 2401-2459, which are not clock times. isLocationOpenNow reads the first two
     * digits as the hour, so "24:30" would have parsed as 2430 and made a store look closed from
     * 23:59 until the next midnight. Two copies of the same logic in two files is exactly the
     * duplicated-constant shape that has bitten repeatedly, so this pins them together. */
    const cases = [['0500-2300','0500-2300'],['24','24'],['0000-2400','24'],['2430-2300',null],
                   ['2401-0500',null],['0500-2430',null],['2400-0500','2400-0500'],
                   ['1260-1300',null],['2359-0100','2359-0100']];
    let bad = 0;
    for (const [inp, want] of cases) {
      if (A(inp) !== want) { fail(`app.js canonHrsOne(${JSON.stringify(inp)}) = ${JSON.stringify(A(inp))}, expected ${JSON.stringify(want)}`); bad++; }
      if (F(inp) !== want) { fail(`functions canonOne(${JSON.stringify(inp)}) = ${JSON.stringify(F(inp))}, expected ${JSON.stringify(want)}`); bad++; }
    }
    if (!bad) pass(`both canonicalisers agree on ${cases.length} cases, including rejecting 24:01-24:59`);
  }
}

// ---- 11: no record may be both doubted and claiming a toilet ----
console.log('\nrestroom signal consistency');
{
  const g = {};
  for (const f of fs.readdirSync('.')) {
    if (!f.endsWith('-locations.js') || f === 'compact-locations.js') continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/^\s*#!/.test(src)) continue;
    try { new Function('window', src)(g); } catch (e) { /* reported by check 5 */ }
  }
  let conflict = 0, doubted = 0;
  for (const arr of Object.values(g)) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (!r || !r.osm || !r.osm.restroomUnconfirmed) continue;
      doubted++;
      // Asking "is there a public restroom here?" at a place whose own source data already says
      // yes wastes the one question slot that can prune the map. restroomDoubted() guards this at
      // runtime; this catches the data getting into that state in the first place.
      if (r.osm.restroomConfirmed || (r.meta && r.meta.toilets === 'yes')) conflict++;
    }
  }
  if (conflict) fail(`${conflict} record(s) are flagged restroomUnconfirmed AND claim a toilet`);
  else pass(`${doubted} doubted record(s), none of them also claiming a toilet`);
}

// ---- 12: every username that reaches Firestore must be length-capped ----
console.log('\nusername caps');
{
  const appSrc = fs.readFileSync('app.js', 'utf8');
  /* The votes, users and activity rules all bound username at 40. An account whose handle is
   * longer would have EVERY write rejected — silently, because two of the three call sites
   * swallow their own errors. Same shape as the wasHiddenGem bug: a field the rules cap and the
   * client does not. */
  /* Only the WRITE paths matter. All three assign to `uname`; a fourth read assigns to
   * `username` and is display-only (it uppercases the handle for the account panel and never
   * touches Firestore), so matching every split('@') flagged it as a false positive. */
  /* Only the WRITE paths matter. All three assign to `uname`; a fourth read assigns to
   * `username` and is display-only (it uppercases the handle for the account panel and never
   * touches Firestore), so matching every split('@') flagged it as a false positive.
   *
   * Must span newlines: two of the three assignments wrap, e.g.
   *     const uname = (window.__currentUser && window.__currentUser.email)
   *       ? window.__currentUser.email.split('@')[0].slice(0, 40) : '';
   * A line-bounded pattern saw only the single-line one, reported "all 1 capped", and passed a
   * deliberately broken build. */
  /* The name now comes from ONE helper. Checking for the old email.split('@')[0] pattern would
   * pass vacuously — there are zero such sites left — so check the helper itself instead. It has
   * to cap at 40 on BOTH branches: the displayName and the email fallback. The votes, users and
   * activity rules all bound username at 40, and a longer one makes every write from that
   * account fail silently. */
  const helper = appSrc.match(/function displayNameFor\(user\)\s*\{[\s\S]*?\n\}/);
  const sites = helper ? [helper[0]] : [];
  if (!helper) fail('displayNameFor() is gone — the username cap is no longer enforced anywhere');
  const caps = helper ? (helper[0].match(/\.slice\(0,\s*40\)/g) || []).length : 0;
  const uncapped = (helper && caps < 2) ? ['displayNameFor caps ' + caps + ' of 2 branches'] : [];
  if (uncapped.length) fail(`${uncapped.length} username write(s) not capped to 40 — the rules will reject them`);
  else pass(`all ${sites.length} username reads are capped to 40`);
  // and sign-up must refuse a handle longer than the input's maxlength
  if (!/clean\.length > 20/.test(appSrc)) fail('signUpAccount has no maximum username length');
  else pass('sign-up enforces a maximum username length');
}

// ---- 13: the geofence radius must stay bounded ----
console.log('\ngeofence');
{
  const appSrc = fs.readFileSync('app.js', 'utf8');
  const lines = appSrc.split('\n');
  const st = lines.findIndex(l => l.includes('function verifyRadiusMiles('));
  if (st < 0) { fail('verifyRadiusMiles is gone'); }
  else {
    let end = st;
    for (let i = st + 1; i < lines.length; i++) if (lines[i] === '}') { end = i; break; }
    const num = (name, dflt) => {
      const m = appSrc.match(new RegExp('const ' + name + '\\s*=\\s*([\\d.]+)'));
      return m ? parseFloat(m[1]) : dflt;
    };
    const FLOOR = num('VERIFY_RADIUS_MIN_MILES', 0.1);
    const CEIL  = num('VERIFY_RADIUS_MILES', 0.3);
    const ex = {};
    new Function('exports', 'VERIFY_RADIUS_MILES', 'VERIFY_RADIUS_MIN_MILES', 'METRES_PER_MILE',
      lines.slice(st, end + 1).join('\n') + '; exports.f=verifyRadiusMiles;')(ex, CEIL, FLOOR, 1609.34);
    /* A rating is only trustworthy if the person was actually there. Too tight and someone
     * standing inside a store is told they are not; too loose and a quarter of the map can be
     * rated from across the street. Whatever the multiplier becomes, the result must stay inside
     * the floor and ceiling — including for junk input, which is where an unguarded formula
     * quietly returns NaN and lets everything through. */
    let bad = 0;
    const inputs = [null, undefined, NaN, -1, 0, 1, 50, 107, 108, 322, 1000, 1e9, 'x'];
    for (const a of inputs) {
      const r = ex.f(a);
      if (!(typeof r === 'number' && isFinite(r) && r >= FLOOR && r <= CEIL)) {
        fail(`verifyRadiusMiles(${JSON.stringify(a)}) = ${r}, outside [${FLOOR}, ${CEIL}]`);
        bad++;
      }
    }
    if (!bad) pass(`radius stays within [${FLOOR}, ${CEIL}] mi across ${inputs.length} inputs including junk`);
  }
}

// ---- 14: script blocks must be well-formed and self-contained ----
console.log('\nscript block integrity');
{
  for (const file of ['index.html', 'flushpanel.html']) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const blocks = [];
    const re = /<script[^>]*>/g;
    let m;
    while ((m = re.exec(src))) {
      const end = src.indexOf('</script>', m.index + m[0].length);
      blocks.push({ start: m.index + m[0].length, end: end < 0 ? src.length : end });
    }
    /* A function defined outside every block is dead: the browser renders its comment as visible
     * page text and the identifier is undefined wherever it is called. That is exactly what
     * happened to fsId in flushpanel.html — every override save threw ReferenceError, the catch
     * swallowed it, and the UI blamed the Firestore rule. */
    const inABlock = (i) => blocks.some(b => i > b.start && i < b.end);
    let orphan = 0;
    for (const fn of [...src.matchAll(/^\s*function\s+(\w+)\s*\(/gm)]) {
      if (!inABlock(fn.index)) { fail(`${file}: function ${fn[1]}() is declared outside every script block`); orphan++; }
    }
    // And a literal closing-script sequence inside a block ends it, even in a comment or string.
    let stray = 0;
    for (const b of blocks) if (src.slice(b.start, b.end).includes('</script')) stray++;
    if (stray) fail(`${file}: ${stray} script block(s) contain a literal closing-script sequence`);
    if (!orphan && !stray) pass(`${file}: ${blocks.length} script blocks, no orphaned functions`);
  }
}

// ---- 15: the amenity key list must agree in all three places ----
console.log('\namenity key agreement');
{
  const appSrc = fs.readFileSync('app.js', 'utf8');
  const block = (name) => {
    const i = appSrc.indexOf('const ' + name);
    const j = appSrc.indexOf('];', i);
    return i < 0 ? '' : appSrc.slice(i, j > i ? j : i + 2000);
  };
  const appKeys = [...new Set([
    ...[...block('BATHROOM_AMENITIES').matchAll(/key:'(\w+)'/g)].map(m => m[1]),
    ...[...block('STORE_FEATURES').matchAll(/key:'(\w+)'/g)].map(m => m[1]),
  ])].sort();

  const grab = (file, re) => {
    if (!fs.existsSync(file)) return null;
    const m = fs.readFileSync(file, 'utf8').match(re);
    return m ? [...new Set([...m[0].matchAll(/'(\w+)'/g)].map(x => x[1]))].sort() : null;
  };
  /* The two sets must be DISJOINT and must match per FIELD, not merely as a union. Both maps
   * used to accept all eleven keys, so accessible:'yes' in amenities AND storeFeatures let one
   * person contribute two confirmations — enough to reach CONFIRM_THRESHOLD alone. */
  const pair = (file, reA, reB) => {
    if (!fs.existsSync(file)) return null;
    const src = fs.readFileSync(file, 'utf8');
    const a = src.match(reA), b = src.match(reB);
    if (!a || !b) return null;
    return {
      amenities:     [...new Set([...a[0].matchAll(/'(\w+)'/g)].map(x => x[1]))].filter(k => k !== 'amenities').sort(),
      storeFeatures: [...new Set([...b[0].matchAll(/'(\w+)'/g)].map(x => x[1]))].filter(k => k !== 'storeFeatures').sort(),
    };
  };
  const fnPair = pair('functions/index.js',
    /amenities:\s*new Set\(\[[^\]]*\]/, /storeFeatures:\s*new Set\(\[[^\]]*\]/);
  const ruPair = pair('firestore.rules',
    /knownAmenityMap\('amenities',\s*\n?\s*\[[^\]]*\]/, /knownAmenityMap\('storeFeatures',\s*\n?\s*\[[^\]]*\]/);
  const fnKeys = fnPair ? [...new Set([...fnPair.amenities, ...fnPair.storeFeatures])].sort() : null;
  const ruKeys = ruPair ? [...new Set([...ruPair.amenities, ...ruPair.storeFeatures])].sort() : null;
  if (fnPair && ruPair) {
    const overlap = fnPair.amenities.filter(k => fnPair.storeFeatures.includes(k));
    if (overlap.length) fail(`amenity and storeFeature key sets overlap: ${overlap.join(', ')} — one vote could count twice`);
    if (JSON.stringify(fnPair.amenities) !== JSON.stringify(ruPair.amenities)
     || JSON.stringify(fnPair.storeFeatures) !== JSON.stringify(ruPair.storeFeatures)) {
      fail('functions and rules disagree on WHICH field each amenity key belongs to');
    }
  }

  /* Three copies of one list, because a client must not be able to name a server field path.
   * The Cloud Function turns amenity keys into Firestore dot paths, so an unlisted key produced
   * `amen.a.b.c.yes` or `amen..yes` — the latter has an empty segment, which Firestore rejects,
   * throwing and taking the rating update with it. Adding an amenity means touching all three. */
  if (!fnKeys) fail('AMENITY_KEYS not found in functions/index.js');
  else if (!ruKeys) fail('the amenity key allowlist was not found in firestore.rules');
  else if (JSON.stringify(appKeys) !== JSON.stringify(fnKeys) || JSON.stringify(appKeys) !== JSON.stringify(ruKeys)) {
    fail(`amenity key lists disagree — app.js ${appKeys.length}, functions ${fnKeys.length}, rules ${ruKeys.length}`);
    const miss = appKeys.filter(k => !fnKeys.includes(k) || !ruKeys.includes(k));
    if (miss.length) fail(`  missing downstream: ${miss.join(', ')}`);
  } else pass(`all three amenity key lists agree (${appKeys.length} keys)`);
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all UI checks passed') + '\n');
process.exit(failures ? 1 : 0);
