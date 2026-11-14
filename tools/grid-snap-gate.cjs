#!/usr/bin/env node
/* Grid-snap gate (rule L7 / G2, customer 2026-11-14): the text container of text pages (.legal: Terms, Privacy, Data processing, Impressum, FAQ)
   must be EXACTLY the 6 central columns of the 12-col grid (cols 4-9, edges on the column lines) from 1200 px; below 1200 it is the full grid
   (all 8 / 4 columns). No text block inside (h1, h2, p, ul/ol/li, links, long words/URLs, text ink) may exceed it, at any width.
   Column lines are computed like the dev grid overlay (G key): container box + --gutter padding, --grid-cols, --grid-gap read from the page.
   Other pages: INFO only (column span of the direct children of every main .container).
   Usage: node tools/grid-snap-gate.cjs [--url http://localhost:5173] [--widths 375,768,1024,1280,1440,1920] [--pages all|a,b] [--tol 0.5]
   Chrome: $CHROME or the macOS default. Do not run together with other gates. Exit code != 0 on FAIL. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve(__dirname, '..');
const URL = opt('url', 'http://localhost:5173').replace(/\/$/, '');
const WIDTHS = String(opt('widths', '375,768,1024,1280,1440,1920')).split(',').map(Number);
const TOL = Number(opt('tol', 0.5));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !['design-system.html'].includes(f)).map((f) => f.replace(/\.html$/, '')).sort();
const sel = String(opt('pages', 'all'));
const PAGES = sel === 'all' ? all : sel.split(',');

function inpage(cfg) {
  const { TOL } = cfg; const cs = getComputedStyle(document.documentElement);
  const num = (n) => parseFloat(cs.getPropertyValue(n));
  const cols = Math.round(num('--grid-cols')), gap = num('--grid-gap');
  const root = document.querySelector('main .container') || document.querySelector('.container');
  const r = root.getBoundingClientRect(), pcs = getComputedStyle(root);
  const L = r.left + parseFloat(pcs.paddingLeft), W = r.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
  const cw = (W - (cols - 1) * gap) / cols;
  const colL = (k) => L + (k - 1) * (cw + gap), colR = (k) => colL(k) + cw;     /* k = 1..cols */
  const nearest = (x) => { let b = 1, d = 1e9; for (let k = 1; k <= cols; k++) for (const v of [colL(k), colR(k)]) { const dd = Math.abs(v - x); if (dd < d) { d = dd; b = k; } } return b; };
  const doc = document.documentElement;
  const out = { cols, gap, hscroll: doc.scrollWidth > doc.clientWidth, legal: null, info: [] };
  const hero = document.querySelector('.legal__hero'), body = document.querySelector('.legal__body');
  if (hero && body) {
    const desktop = cols === 12;
    const a = desktop ? 4 : 1, b = desktop ? 9 : cols;
    const eL = colL(a), eR = colR(b);
    const blocks = [...document.querySelectorAll('.legal__title, .legal__updated, .legal__body')];
    const edges = blocks.map((el) => { const q = el.getBoundingClientRect(); return { cls: el.className.split(' ').pop(), l: q.left, r: q.right }; });
    const bad = []; let maxRight = -1e9, minLeft = 1e9;
    for (const e of edges) { if (Math.abs(e.l - eL) > TOL || Math.abs(e.r - eR) > TOL) bad.push(`${e.cls} edges ${e.l.toFixed(1)}..${e.r.toFixed(1)} != ${eL.toFixed(1)}..${eR.toFixed(1)}`); }
    const kids = [...document.querySelectorAll('.legal__hero *, .legal__body *')];
    for (const el of kids) {
      let q = el.getBoundingClientRect(); if (!q.width && !q.height) continue;
      if (el.tagName === 'A') { const c = getComputedStyle(el); const pl = parseFloat(c.paddingLeft) || 0, pr = parseFloat(c.paddingRight) || 0; if (pl || pr) q = { left: q.left + pl, right: q.right - pr, width: q.width }; }   /* links/pills carry a hover/hit padding compensated by a negative margin: the CONTENT box (text) must be inside; the invisible padding may bleed */
      if (q.right > maxRight) maxRight = q.right; if (q.left < minLeft) minLeft = q.left;
      if (q.right > eR + TOL || q.left < eL - TOL) bad.push(`<${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}> ${q.left.toFixed(1)}..${q.right.toFixed(1)}`);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') bad.push(`<${el.tagName.toLowerCase()}> scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    }
    /* text ink: every text node's range rects */
    const wk = document.createTreeWalker(document.querySelector('.legal'), NodeFilter.SHOW_TEXT); let n;
    while ((n = wk.nextNode())) { if (!n.textContent.trim() || !n.parentElement.closest('.legal__hero, .legal__body')) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) { if (q.right > maxRight) maxRight = q.right; if (q.right > eR + TOL || q.left < eL - TOL) bad.push(`text "${n.textContent.trim().slice(0, 24)}" ${q.left.toFixed(1)}..${q.right.toFixed(1)}`); } }
    const bl = blocks.map((el) => el.getBoundingClientRect());
    out.legal = { a, b, eL, eR, cL: Math.min(...bl.map((q) => q.left)), cR: Math.max(...bl.map((q) => q.right)), maxRight, bad: [...new Set(bad)].slice(0, 6) };
  } else {
    const spans = new Set();
    for (const c of document.querySelectorAll('main .container')) for (const el of c.children) { const q = el.getBoundingClientRect(); if (q.width < 40) continue; spans.add(`${nearest(q.left)}-${nearest(q.right)}`); }
    out.info = [...spans];
  }
  return out;
}

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const rows = []; let fails = 0;
  for (const p of PAGES) for (const w of WIDTHS) {
    const pg = await br.newPage(); await pg.setViewport({ width: w, height: 900 });
    await pg.goto(`${URL}/${p === 'index' ? '' : p + '.html'}`, { waitUntil: 'networkidle2' });
    await pg.evaluate(async () => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); await document.fonts.ready; });
    const o = await pg.evaluate(inpage, { TOL }); await pg.close();
    if (o.legal) {
      const l = o.legal, st = (Math.abs(l.cL - l.eL) <= TOL && Math.abs(l.cR - l.eR) <= TOL && !l.bad.length) ? 'PASS' : 'FAIL'; if (st === 'FAIL') fails++;
      rows.push([p, w, st, `cols ${l.a}-${l.b}`, `${l.cL.toFixed(1)}..${l.cR.toFixed(1)}`, `${l.eL.toFixed(1)}..${l.eR.toFixed(1)}`, l.maxRight.toFixed(1), l.bad.join('; ')]);
    } else rows.push([p, w, 'INFO', `spans ${o.info.join(' ')}`, '', '', '', o.hscroll ? 'h-scroll' : '']);
  }
  await br.close();
  console.log(['page', 'w', 'status', 'columns', 'container L..R', 'column lines L..R', 'text maxRight', 'notes'].join(' | '));
  for (const r of rows) console.log(r.join(' | '));
  console.log(`\ngrid-snap: ${rows.filter((r) => r[2] === 'PASS').length} PASS, ${fails} FAIL, ${rows.filter((r) => r[2] === 'INFO').length} INFO`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
