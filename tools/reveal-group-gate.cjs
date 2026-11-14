#!/usr/bin/env node
/* Reveal-group gate (rule U15, customer 2026-11-14): scroll-reveal is per SECTION, not per element.
   (1) all [data-reveal] elements of one row (same top) and of one section become revealed at the same scroll position (spread <= 1 scroll step = 100 px);
   (2) anything inside the initial viewport is fully visible (opacity >= .99, no pending reveal) 100 ms after load.
   Reveal scrollY of an element = first step (scrollY += 100) at which it has .is-revealed or computed opacity >= .99.
   Output: table page x width x section x elements x rows x scrollY spread (+ tools/.last-reveal-gate.json). Exit != 0 on FAIL.
   Usage: node tools/reveal-group-gate.cjs [--url http://localhost:5173] [--widths 1440,375] [--pages all|a,b] [--json file]. Do not run with other gates. */
const cp = require('child_process'), fs = require('fs'), path = require('path');
const L = require('./icon-gate-lib.cjs');
const puppeteer = require('puppeteer-core');
const cfg = L.parse(process.argv.slice(2));
try { const out = cp.execSync("pgrep -f '^node .*(reveal-group|hover-gate|style-gate|poster-swap|grid-snap|hero-fit|header-geo|icon-|card-row|card-padding|scroll-trap|link-targets|measure-standard)'", { encoding: 'utf8' }).split('\n').filter(Boolean).filter((p) => Number(p) !== process.pid);
  if (out.length) { console.error('another gate is running (pid ' + out.join(',') + '): not running two gates in parallel'); process.exit(3); } } catch (e) { /* none */ }
const WIDTHS = String(cfg.opt('widths', '1440,375')).split(',').map(Number);
const STEP = 100, SAMPLES = ['products/azithromycin/', 'products/category/api/'];
const pages = cfg.PAGES.filter((p) => p !== 'design-system' && p !== '404');
if (!pages.some((p) => p.includes('/')) && String(cfg.opt('pages', 'all')) === 'all') pages.push(...SAMPLES);

async function inpage({ STEP }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const secOf = (el) => { let s = el.closest('section'); while (s && s.parentElement && s.parentElement.closest('section')) s = s.parentElement.closest('section'); return s || el.closest('footer') || el.parentElement; };
  const label = (s) => (s.id ? '#' + s.id : '') + '.' + String(s.className).split(' ').filter(Boolean).slice(0, 2).join('.') + (s.tagName === 'SECTION' ? '' : '<' + s.tagName.toLowerCase() + '>');
  const els = [...document.querySelectorAll('[data-reveal],[data-reveal-load]')].filter((e) => !e.closest('header,[hidden]'));
  const vh = innerHeight;
  const initBad = els.filter((e) => { const r = e.getBoundingClientRect(); return r.top < vh && r.bottom > 0 && parseFloat(getComputedStyle(e).opacity) < 0.99; })
    .map((e) => (e.tagName.toLowerCase() + '.' + String(e.className).split(' ').filter(Boolean)[0]));
  const info = els.map((e, i) => { const r = e.getBoundingClientRect(); return { i, sec: secOf(e), top: Math.round(r.top + scrollY) , y: null }; });
  const done = (e) => e.classList.contains('is-revealed') || parseFloat(getComputedStyle(e).opacity) >= 0.99;
  let y = 0;
  for (;;) {
    scrollTo(0, y); await sleep(90);
    info.forEach((o) => { if (o.y === null && done(els[o.i])) o.y = Math.round(scrollY); });
    if (y + innerHeight >= document.documentElement.scrollHeight - 1 || y > 40000) break;
    y += STEP;
  }
  info.forEach((o) => { if (o.y === null && done(els[o.i])) o.y = Math.round(scrollY); });
  const secs = [...new Set(info.map((o) => o.sec))];
  const out = secs.map((s) => {
    const m = info.filter((o) => o.sec === s); const rows = [];
    m.forEach((o) => { let r = rows.find((x) => Math.abs(x.top - o.top) <= 8); if (!r) rows.push(r = { top: o.top, ys: [] }); r.ys.push(o.y); });
    const spread = (a) => (a.includes(null) ? 99999 : Math.max(...a) - Math.min(...a));
    return { sec: label(s), n: m.length, rows: rows.length, spread: spread(m.map((o) => o.y)), rowSpread: Math.max(...rows.map((r) => spread(r.ys))), ys: m.map((o) => o.y) };
  });
  return { initBad, secs: out, total: els.length };
}
(async () => {
  let own = null; const gen = pages.some((p) => p.includes('/'));
  if (gen) { const up = async () => { try { return (await fetch(cfg.PREVIEW + '/index.html')).ok; } catch (e) { return false; } };
    if (!(await up())) { const port = 4177; cfg.PREVIEW = `http://localhost:${port}/osta`; own = cp.spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: L.ROOT, stdio: 'ignore' }); for (let i = 0; i < 30 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500)); } }
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const rows = []; let fails = 0;
  for (const p of pages) for (const w of WIDTHS) {
    const pg = await br.newPage(); await pg.setViewport({ width: w, height: 900 });
    await pg.goto(p.includes('/') ? `${cfg.PREVIEW}/${p}` : `${cfg.URL}/${p === 'index' ? '' : p + '.html'}`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 100));
    const r = await pg.evaluate(inpage, { STEP }); await pg.close();
    const f = [];
    if (r.initBad.length) f.push('visible at load but opacity<1 (' + r.initBad.length + '): ' + [...new Set(r.initBad)].slice(0, 4).join(','));
    for (const s of r.secs) { if (s.rowSpread > STEP) f.push(`${s.sec} row spread ${s.rowSpread}`); else if (s.spread > STEP) f.push(`${s.sec} section spread ${s.spread}`); }
    rows.push({ page: p, w, total: r.total, secs: r.secs, fail: f }); if (f.length) fails++;
    console.log(`${f.length ? 'FAIL' : 'PASS'} ${p} @${w}: ${r.secs.length} sections, ${r.total} reveal elements, max spread ${Math.max(0, ...r.secs.map((s) => s.spread))} px${f.length ? '; ' + f.join('; ') : ''}`);
    if (process.argv.includes('--verbose')) r.secs.forEach((s) => console.log(`    ${s.sec} n=${s.n} rows=${s.rows} rowSpread=${s.rowSpread} spread=${s.spread}`));
  }
  await br.close(); if (own) own.kill();
  fs.writeFileSync(cfg.opt('json', path.join(L.ROOT, 'tools/.last-reveal-gate.json')), JSON.stringify(rows, null, 1));
  console.log(`reveal-group: ${rows.length} page x width; ${fails ? fails + ' FAIL' : 'PASS'}`);
  process.exit(fails ? 1 : 0);
})();
