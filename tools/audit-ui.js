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
console.log('\ndrawer row geometry');
const ROWS = ['#appDrawer .d-items button', '#appDrawer .d-collapse-head',
              '#appDrawer .d-shop-link',    '#appDrawer .d-section-label'];
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
for (const g of geo) {
  if (g.display !== 'flex') fail(`${g.sel} is "${g.display || 'block'}", not flex — .d-ico cannot size and gap will not apply`);
  if (g.gap !== '10px')     fail(`${g.sel} gap is "${g.gap || 'none'}", expected 10px`);
}
const lefts = [...new Set(geo.map(g => g.left))];
if (lefts.length > 1) fail('drawer rows disagree on left padding: ' + geo.map(g => `${g.sel}=${g.left}`).join(', '));
else pass('all ' + geo.length + ' row types: flex, gap 10px, left padding ' + lefts[0]);

// ---- 2b: every icon must be in the slot, not inline in the label ----
console.log('\nicon slot');
const items = html.slice(html.indexOf('<div class="d-items">'), html.indexOf('</nav>', html.indexOf('<div class="d-items">')));
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const rowRe = /<(button|div|a)[^>]*(?:class="[^"]*(?:d-collapse-head|d-section-label|d-shop-link|d-toggle)[^"]*"|id="(?:passportToggle|infoBtn)")[^>]*>([\s\S]*?)<\/\1>/g;
let r, checked = 0, stray = 0;
while ((r = rowRe.exec(items))) {
  checked++;
  const label = r[2].replace(/<span class="d-ico[^>]*>[\s\S]*?<\/span>/g, '')
                    .replace(/<[^>]*>/g, '').replace(/[▾▸]/g, '').trim();
  if (EMOJI.test(label)) { fail('emoji outside .d-ico in row: ' + JSON.stringify(label.slice(0, 40))); stray++; }
}
if (!stray) pass(checked + ' drawer rows, every emoji inside a .d-ico slot');

// ---- 3: stale selectors — absolute positioning on a drawer child ----
console.log('\nstale selectors');
const drawerIds = [...items.matchAll(/id="([^"]+)"/g)].map(m => '#' + m[1]);
let staleFound = 0;
for (const id of drawerIds) {
  const d = declsFor(id);
  if (!Object.keys(d).length) continue;
  const bad = [];
  if ((d.position || '').includes('absolute')) bad.push('position:absolute');
  if ((d.justifyContent || d['justify-content'] || '').includes('center')) bad.push('justify-content:center');
  if (bad.length) { fail(`${id} is a drawer row but still has ${bad.join(' + ')} from an earlier layout`); staleFound++; }
}
if (!staleFound) pass(drawerIds.length + ' drawer ids carry no leftover positioning rules');

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
    const appSrc = fs.readFileSync('app.js', 'utf8');
    const seg = appSrc.slice(appSrc.indexOf('const CHAIN_REGISTRY'), appSrc.indexOf('const DEFAULT_CHAIN_KEY'));
    const regKeys = [...seg.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
    const tableKeys = new Set([...fp.matchAll(/\["[^"]*","(\w+)","[\w-]+-locations\.js"\]/g)].map(m => m[1]));
    const absent = regKeys.filter(k => !tableKeys.has(k));
    if (absent.length) fail(`CHAIN_TABLE is missing registry key(s): ${absent.join(', ')}`);
    else pass(`CHAIN_TABLE covers all ${regKeys.length} registry chains`);

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

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all UI checks passed') + '\n');
process.exit(failures ? 1 : 0);
