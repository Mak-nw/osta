#!/usr/bin/env node
/* Icon-box gate (rules ICON-A / ICON-B, customer 2026-11-14).
   A. every vector icon (svg with <use>) is the direct child of a box (span.icon-box); all boxes of ONE SET are the same size (every page, every width).
   B. box = height of the TALLEST icon of the set + gap, gap in [2,4] px (computed from the set, never typed): set A (.icon-box, icons 16), set B (.icon-box--lg, 24), set T (.icon-box--ink: icons beside text; one box per font size).
   Also reports: gap per set, every icon of a set shares one size, box is square.
   Usage: node tools/icon-box-gate.cjs [--url http://localhost:5173] [--widths 375,768,1024,1440,1920] [--pages all|a,b]
   Exit code != 0 on FAIL. Do not run together with other gates. */
const L = require('./icon-gate-lib.cjs');
const cfg = L.parse(process.argv.slice(2)); L.guardParallel();
function inpage() {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = { sets: {}, unboxed: [] };
  for (const s of document.querySelectorAll('svg')) {
    if (!s.querySelector('use') || !vis(s)) continue;
    const par = s.parentElement, nm = s.querySelector('use').getAttribute('href').split('#')[1];
    if (!par.classList.contains('icon-box')) { out.unboxed.push(nm + ' in ' + par.tagName.toLowerCase() + '.' + String(par.className).split(' ')[0]); continue; }
    const set = par.classList.contains('icon-box--ink') ? 'T' + (par.classList.contains('icon-box--desc') ? '+desc' : '') + '@' + parseFloat(getComputedStyle(par).fontSize) + 'px' : par.classList.contains('icon-box--lg') ? 'B' : 'A';
    const br = par.getBoundingClientRect(), sr = s.getBoundingClientRect(); const o = (out.sets[set] = out.sets[set] || { boxes: [], icons: [] });
    o.boxes.push([+br.width.toFixed(2), +br.height.toFixed(2), nm]); /* set T: the glyph is enlarged inside the box, so ICON-B compares the VISIBLE ink height (use bbox + half stroke) */
    let ih = Math.max(sr.width, sr.height); if (set[0] === 'T') { const uq = s.querySelector('use').getBoundingClientRect(); ih = uq.height + 1.5 / 24 * sr.height; }
    o.icons.push(+ih.toFixed(2));
  }
  return out;
}
(async () => {
  const res = await L.run(cfg, inpage, {}); const agg = {}; const unboxed = new Set(); let fails = 0; const notes = [];
  for (const r of res) {
    for (const u of r.unboxed) unboxed.add(`${r.page}: ${u}`);
    for (const k in r.sets) { const a = (agg[k] = agg[k] || { boxes: [], icons: [], n: 0 }); a.n += r.sets[k].boxes.length; a.boxes.push(...r.sets[k].boxes.map((b) => b.slice(0, 2))); a.icons.push(...r.sets[k].icons); }
  }
  console.log('set | boxes | icon sizes (min..max) | box w (min..max) | box h (min..max) | tallest icon | gap | ICON-A equal | ICON-B gap 2-4');
  for (const k of Object.keys(agg).sort()) {
    const a = agg[k], ws = a.boxes.map((b) => b[0]), hs = a.boxes.map((b) => b[1]), tall = Math.max(...a.icons), mn = (x) => Math.min(...x), mx = (x) => Math.max(...x);
    const eq = mx(ws) - mn(ws) <= 0.5 && mx(hs) - mn(hs) <= 0.5, gapW = mx(ws) - tall, gapH = mx(hs) - tall, okB = gapW >= 2 - 0.5 && gapW <= 4 + 0.5 && gapH >= 2 - 0.5 && gapH <= 4 + 0.5;
    const eqInk = k[0] !== 'T' || mx(a.icons) - mn(a.icons) <= 0.5; if (!eq || !okB || !eqInk) fails++;
    console.log([k, a.n, `${mn(a.icons)}..${tall}`, `${mn(ws)}..${mx(ws)}`, `${mn(hs)}..${mx(hs)}`, tall, `${gapW.toFixed(2)}/${gapH.toFixed(2)}`, eq ? 'PASS' : 'FAIL', okB ? 'PASS' : 'FAIL', k[0] === 'T' ? 'ink equal ±0.5: ' + (eqInk ? 'PASS' : 'FAIL') : ''].join(' | '));
  }
  if (unboxed.size) { fails++; console.log('\nFAIL ICON-A: icons without a box:'); for (const u of [...unboxed].slice(0, 30)) console.log('  ' + u); }
  const cov = `${cfg.PAGES.length} pages x ${cfg.WIDTHS.join('/')} px, ${res.length} loads, ${Object.values(agg).reduce((s, a) => s + a.n, 0)} boxed icons`;
  console.log(`\nicon-box: ${fails ? 'FAIL' : 'PASS'} (${cov})`);
  require('fs').writeFileSync(require('path').join(L.ROOT, 'tools/.last-icon-box-gate.json'), JSON.stringify({ at: new Date().toISOString(), cov, fails, agg: Object.fromEntries(Object.entries(agg).map(([k, a]) => [k, { n: a.n, icons: [Math.min(...a.icons), Math.max(...a.icons)] }])) }, null, 1));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
