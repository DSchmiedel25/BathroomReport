#!/usr/bin/env node
/*
 * compact-locations.js — ONE-TIME whitespace compaction of every *-locations.js file.
 *
 * The bake scripts used to pretty-print these files (2-space indents), which shipped a
 * third of pure whitespace to every user on every load. The bake writers now emit a
 * one-record-per-line format, but they only rewrite files they touch — this script
 * converts the whole fleet at once so the payload win lands immediately.
 *
 * Safe by design: each file is loaded exactly the way the app loads it (evaluated with a
 * stub window), re-serialized, then RE-LOADED and record-counted before the original is
 * replaced. Any file that fails any step is left untouched and reported.
 *
 * USAGE (from the repo root):  node compact-locations.js
 * Then review `git diff --stat`, commit, and deploy with a sw.js cache bump as usual.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function load(file){
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  const varName = Object.keys(sandbox.window)[0];
  return { varName, records: sandbox.window[varName] };
}
function serialize(varName, records){
  return 'window.' + varName + ' = [\n' +
    records.map(r => JSON.stringify(r)).join(',\n') +
    '\n];\n';
}

const dir = '.';
const files = fs.readdirSync(dir).filter(f => /-locations\.js$/.test(f) && f !== path.basename(__filename));
let before = 0, after = 0, converted = 0, skipped = [];
for(const f of files){
  const full = path.join(dir, f);
  try{
    const { varName, records } = load(full);
    if(!varName || !Array.isArray(records)) throw new Error('unexpected shape');
    const out = serialize(varName, records);
    // verify: re-load the new text and confirm the record count survives round-trip
    const sandbox = { window: {} };
    new Function('window', out)(sandbox.window);
    const check = sandbox.window[varName];
    if(!Array.isArray(check) || check.length !== records.length) throw new Error('round-trip mismatch');
    const oldSize = fs.statSync(full).size;
    fs.writeFileSync(full, out);
    before += oldSize; after += out.length; converted++;
    console.log(f + ': ' + (oldSize/1024).toFixed(0) + 'K -> ' + (out.length/1024).toFixed(0) + 'K');
  }catch(e){
    skipped.push(f + ' (' + e.message + ')');
  }
}
console.log('\n' + converted + ' file(s) compacted: ' +
  (before/1048576).toFixed(2) + ' MB -> ' + (after/1048576).toFixed(2) + ' MB (' +
  (before ? (100*(before-after)/before).toFixed(0) : 0) + '% smaller)');
if(skipped.length) console.log('SKIPPED (unchanged): ' + skipped.join(', '));
