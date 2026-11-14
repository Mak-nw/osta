#!/usr/bin/env node
/* Card-row gate (rule CARD-ROW, customer 2026-11-14): cards that stand side by side in one row
   (1) have EQUAL height (+-1 px), (2) the TOP group starts at the card's padding-top (+-0.5) in every card of the row,
   (3) the BOTTOM group (last text line / CTA = the lowest in-flow box) ends exactly padding-bottom above the card bottom (+-0.5), in every card of the row.
   Stacked cards (mobile) form no row; there the gate only checks that the page has no horizontal overflow.
   Cards = outermost element of .card .info-card .text-card .people-card .link-card .product-card .svc-card .quality-card .feature-card .tile .contact-card
   (cards with their own multi-column layout: .people-card / .contact-split__content are measured on height only).
   Usage: node tools/card-row-gate.cjs [--url http://localhost:5173] [--widths 375,768,1024,1440] [--pages all|a,b]. Exit != 0 on FAIL. Do not run together with other gates. */
const cp = require('child_process');
const L = require('./icon-gate-lib.cjs');
const cfg = L.parse(process.argv.slice(2));
try { const out = cp.execSync("pgrep -f '^node .*(card-row|hover-gate|style-gate|poster-swap|grid-snap|hero-fit|header-geo|icon-)'", { encoding: 'utf8' }).split('\n').filter(Boolean).filter((p) => Number(p) !== process.pid);
  if (out.length) { console.error('another gate is running (pid ' + out.join(',') + '): not running two gates in parallel'); process.exit(3); } } catch (e) { /* none */ }
const widths = String(cfg.opt('widths', '375,768,1024,1440'));
cfg.WIDTHS = widths.split(',').map(Number);
cfg.PAGES = cfg.PAGES.filter((p) => p !== 'design-system'); /* specimen page of the design system, not a product page */
function inpage(c) {
  const SEL = '.card,.info-card,.text-card,.people-card,.link-card,.product-card,.svc-card,.quality-card,.feature-card,.tile,.contact-card';
  const cs = [...document.querySelectorAll(SEL)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 80 && r.height > 40 && !e.closest('header,footer,[hidden],.mobile-menu') && getComputedStyle(e).visibility !== 'hidden'; });
  const top = cs.filter((e) => !cs.some((o) => o !== e && o.contains(e)));
  const rows = [];
  for (const e of top) { const r = e.getBoundingClientRect(), y = r.top + scrollY;
    let row = rows.find((x) => Math.abs(x.y - y) <= 1 && x.els.every((o) => Math.abs(o.getBoundingClientRect().left - r.left) > 2)); if (!row) { row = { y, els: [] }; rows.push(row); } row.els.push(e); }
  const lowest = (e) => { let lb = -1e9, ft = 1e9; for (const d of e.querySelectorAll('*')) {
      if (d.closest('svg,canvas') || d.tagName === 'use') continue; const s = getComputedStyle(d); if (s.position === 'absolute' || s.position === 'fixed' || s.display === 'none') continue;
      const q = d.getBoundingClientRect(); if (q.width === 0 || q.height === 0) continue; lb = Math.max(lb, q.bottom); ft = Math.min(ft, q.top); } return { lb, ft }; };
  const out = [];
  for (const row of rows) { if (row.els.length < 2) continue;
    out.push(row.els.map((e) => { const r = e.getBoundingClientRect(), cst = getComputedStyle(e), m = lowest(e);
      return { cls: String(e.className).split(' ').filter(Boolean).slice(0, 3).join('.'), h: +r.height.toFixed(2), pt: parseFloat(cst.paddingTop), pb: parseFloat(cst.paddingBottom), top: +(m.ft - r.top).toFixed(2), bot: +(r.bottom - m.lb).toFixed(2),
        multi: e.matches('.people-card,.contact-split__content') }; })); }
  return { rows: out, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}
(async () => {
  const res = await L.run(cfg, inpage, {}); let fails = 0, nrows = 0, ncards = 0;
  for (const r of res) {
    const f = [];
    if (r.overflow) f.push('horizontal overflow');
    for (const row of r.rows) { nrows++; ncards += row.length;
      const hs = row.map((x) => x.h); if (Math.max(...hs) - Math.min(...hs) > 1) f.push('height differs ' + row.map((x) => x.cls + ':' + x.h).join(' | '));
      const m = row.filter((x) => !x.multi); if (m.length < 2) continue;
      const tops = m.map((x) => x.top), bots = m.map((x) => x.bot);
      if (m.some((x) => Math.abs(x.top - x.pt) > 0.5) || Math.max(...tops) - Math.min(...tops) > 0.5) f.push('top group offset != padding-top: ' + m.map((x) => x.cls + ':' + x.top + '/' + x.pt).join(' | '));
      if (m.some((x) => Math.abs(x.bot - x.pb) > 0.5) || Math.max(...bots) - Math.min(...bots) > 0.5) f.push('bottom group offset != padding-bottom: ' + m.map((x) => x.cls + ':' + x.bot + '/' + x.pb).join(' | ')); }
    if (f.length) { fails++; console.log(`FAIL ${r.page} @${r.w}: ${f.join('; ')}`); }
  }
  console.log(`card-row: ${res.length} page x width, ${nrows} rows, ${ncards} cards; ${fails ? fails + ' FAIL' : 'PASS'}`);
  process.exit(fails ? 1 : 0);
})();
