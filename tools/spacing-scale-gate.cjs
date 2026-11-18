#!/usr/bin/env node
/* Spacing-scale gate (P25): every literal px value of gap / row-gap / column-gap / padding* / margin* in src/styles must be on the spacing scale
   (tokens.css --space-* + the explicit role tokens). Token references (var(...)) and calc() built from tokens are fine; only raw px literals are checked.
   Static, no browser. Exit 1 on any off-scale value. Scale: 0, 1, 2, 4, 5, 7, 8, 10, 12, 16, 22, 24, 30, 32, 45, 48, 64, 96, 128. */
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const SCALE = new Set([0, 1, 2, 4, 5, 7, 8, 10, 12, 16, 22, 24, 30, 32, 45, 48, 64, 96, 128]);
const PROP = /^(gap|row-gap|column-gap|padding(-[a-z]+)*|margin(-[a-z]+)*)$/;
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.css')) files.push(p); } })(path.join(ROOT, 'src/styles'));
const bad = [];
for (const f of files) { const rel = path.relative(ROOT, f); if (/design-system-page|tokens\.css/.test(rel)) continue;
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  src.split('\n').forEach((line, i) => { for (const m of line.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;}]*)/g)) { if (!PROP.test(m[1])) continue; const val = m[2].replace(/var\([^)]*\)/g, ' ').replace(/calc\([^)]*\)/g, ' ');
    for (const n of val.matchAll(/(-?\d*\.?\d+)px/g)) { const v = Math.abs(parseFloat(n[1])); if (!SCALE.has(v)) bad.push(rel + ':' + (i + 1) + ' ' + m[1] + ': ' + n[1] + 'px'); } } }); }
console.log('spacing-scale gate: ' + files.length + ' files, scale ' + [...SCALE].join('/'));
if (bad.length) { console.log('FAIL off-scale values (' + bad.length + '):'); bad.forEach((b) => console.log('  ' + b)); process.exit(1); }
console.log('PASS: all raw gap/padding/margin px values are on the scale');
