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

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all UI checks passed') + '\n');
process.exit(failures ? 1 : 0);
