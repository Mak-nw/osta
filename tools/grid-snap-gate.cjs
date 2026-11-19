#!/usr/bin/env node
/* Grid-snap gate (rule L7 / G2, customer 2026-11-14): the text container of text pages (.legal: Terms, Privacy, Data processing, Impressum, FAQ)
   must be EXACTLY the 6 central columns at EVERY width (edges on the column lines): 4-9 of 12 from 1200 px, 2-7 of 8 on tablet 768-1199 (fixed 2026-11-19: it used to
   expect cols 1-8, which contradicted the customer rule), mobile (4 cols) = full width. No text block inside (h1, h2, p, ul/ol/li, links, long words/URLs, text ink) may exceed it, at any width.
   Column lines are computed like the dev grid overlay (G key): container box + --gutter padding, --grid-cols, --grid-gap read from the page.
   Rule L10 (every section/block on the 12-col grid): for EVERY page the gate lists each section / container / block / card / media with its column span and the
   deviation of its edges from the nearest column lines. FAIL only for blocks in L10_ENFORCED (below); everything else is INFO (coverage). --md <file> writes
   the inventory table (page x block x columns x edges x deviation) for the widths measured. Add a block to L10_ENFORCED once its column span is fixed.
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
const MD = opt('md', '');
/* L10_ENFORCED: blocks whose edges MUST lie on page column lines (FAIL). Legal pages are enforced separately (L7 branch below).
   edges 'both' = left edge on a column-left line AND right edge on a column-right line.
   pair = { first, second }: when the two are side by side (second.left > first.left) second.left must be on a column-left line and first.right on a column-right line
   (the inner padding stays: the first column starts at the card padding); when stacked (mobile / 1200-1439 contacts) the check is skipped. */
const L10_ENFORCED = [
  { page: 'contact', name: 'card (.contact-split__content)', sel: '.contact-split__content', edges: 'both' },
  { page: 'contact', name: 'columns Phone | Fax', pair: { first: '.contact-rows > .contact-row:nth-child(2)', second: '.contact-rows > .contact-row:nth-child(3)' } },
  { page: 'contact', name: 'columns Andrew | John Silver', pair: { first: '.contact-people:not(.contact-rows) > .contact-person:nth-child(1)', second: '.contact-people:not(.contact-rows) > .contact-person:nth-child(2)' } },
  { page: 'contact', name: 'form row First | Last name', pair: { first: '.contact-form__row > .field:nth-child(1)', second: '.contact-form__row > .field:nth-child(2)' } },
];
const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !['design-system.html'].includes(f)).map((f) => f.replace(/\.html$/, '')).sort().concat(['src/templates/hub', 'src/templates/product']);  /* + the product / hub templates (dev-served) for L10 coverage */
const sel = String(opt('pages', 'all'));
/* L10 CENTRE (customer 2026-11-14 "ця секція не вирівняна по центровій лінії"): blocks that are CENTRED by design must sit on the vertical page axis x = width/2 (|centre - axis| <= 1px at EVERY width). Box centre (text blocks with text-align:center: the ink of the text lines). Enforced list = fixed/verified blocks; everything else (art inside cards, closing scene on the right) is intentionally off-axis and not listed. Hero search group (.hero__find / .hero-search__bar / .hero-cats) is left-aligned by design <= 1199 and is enforced only >= 1200. */
const CENTRED = [
  { page: 'about', sel: '.hero__media', name: 'hero illustration' }, { page: 'about', sel: '.hero__aside', name: 'hero text+CTA group' }, { page: 'about', sel: '.hero__aside .hero__sub', name: 'hero sub text (ink)' },
  { page: 'services', sel: '.hero__media', name: 'hero illustration' }, { page: 'services', sel: '.hero__aside', name: 'hero text+CTA group' }, { page: 'services', sel: '.hero__aside .hero__sub', name: 'hero sub text (ink)' },
  { page: 'services', sel: '.process-scroll__art', name: 'Process 3D art box' }, { page: 'services', sel: '.svc-services__head', name: 'Services row heading group' },
  { page: 'index', sel: '.hero__scene3d', name: 'hero 3D scene' }, { page: 'index', sel: '.hero__find', name: 'hero search group', min: 1200 }, { page: 'index', sel: '.hero-search__bar', name: 'hero search bar', min: 1200 }, { page: 'index', sel: '.hero-cats', name: 'hero categories', min: 1200 },
  { page: '404', sel: '.section-head--center', name: '404 content group' },
];
function centreInPage(list) {
  const W = document.documentElement.clientWidth, out = [];
  for (const c of list) {
    const e = document.querySelector(c.sel); if (!e) { out.push({ name: c.name, st: 'FAIL', note: 'not found' }); continue; }
    const q = e.getBoundingClientRect(); let l = q.left, r = q.right;
    if (getComputedStyle(e).textAlign === 'center' && /^(H\d|P|SPAN)$/.test(e.tagName)) { const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects()].filter((x) => x.width > 0); if (rs.length) { l = Math.min(...rs.map((x) => x.left)); r = Math.max(...rs.map((x) => x.right)); } }
    const dx = (l + r) / 2 - W / 2; out.push({ name: c.name, st: Math.abs(dx) <= 1 ? 'PASS' : 'FAIL', note: `centre ${((l + r) / 2).toFixed(1)} vs axis ${(W / 2).toFixed(1)} (dx ${dx.toFixed(1)})` });
  }
  return out;
}
const PAGES = sel === 'all' ? all : sel.split(',');

function inpage(cfg) {
  const { TOL, ENF } = cfg; const cs = getComputedStyle(document.documentElement);
  const num = (n) => parseFloat(cs.getPropertyValue(n));
  const cols = Math.round(num('--grid-cols')), gap = num('--grid-gap');
  const root = document.querySelector('main .container') || document.querySelector('.container');
  const r = root.getBoundingClientRect(), pcs = getComputedStyle(root);
  const L = r.left + parseFloat(pcs.paddingLeft), W = r.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
  const cw = (W - (cols - 1) * gap) / cols;
  const colL = (k) => L + (k - 1) * (cw + gap), colR = (k) => colL(k) + cw;     /* k = 1..cols */
  const nearest = (x) => { let b = 1, d = 1e9; for (let k = 1; k <= cols; k++) for (const v of [colL(k), colR(k)]) { const dd = Math.abs(v - x); if (dd < d) { d = dd; b = k; } } return b; };
  const doc = document.documentElement;
  const out = { cols, gap, hscroll: doc.scrollWidth > doc.clientWidth, legal: null, info: [], blocks: [], enf: [] };
  /* L10 inventory: every section / container / block / card / media of the page vs the column lines (viewport-based, = the G overlay) */
  {
    const vw = doc.clientWidth, Wp = Math.min(num('--container'), vw - 2 * num('--gutter')), Lp = (vw - Wp) / 2, cwp = (Wp - (cols - 1) * gap) / cols;
    const cl = (k) => Lp + (k - 1) * (cwp + gap), cr = (k) => cl(k) + cwp;
    const snap = (x, fn) => { let b = 1, d = 1e9; for (let k = 1; k <= cols; k++) { const dd = Math.abs(fn(k) - x); if (dd < d) { d = dd; b = k; } } return { k: b, d: x - fn(b) }; };
    const lab = (el) => { const c = (el.className && el.className.baseVal === undefined ? el.className : '').toString().trim().split(/\s+/)[0]; return el.tagName.toLowerCase() + (c ? '.' + c : ''); };
    const vis = (el, q) => q.width >= 40 && q.height >= 8 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const seen = new Map(); const add = (kind, el) => {
      const q = el.getBoundingClientRect(); if (!vis(el, q)) return;
      const key = kind + ' ' + lab(el), bleed = q.left <= 1 && q.right >= vw - 1;
      const a = snap(q.left, cl), b = snap(q.right, cr), dev = bleed ? 0 : Math.max(Math.abs(a.d), Math.abs(b.d));
      const rec = { kind, label: lab(el), span: bleed ? 'bleed' : a.k + '-' + b.k, l: +q.left.toFixed(1), r: +q.right.toFixed(1), dl: +a.d.toFixed(1), dr: +b.d.toFixed(1), dev: +dev.toFixed(1), n: 1 };
      const o = seen.get(key); if (!o) seen.set(key, rec); else { o.n++; if (rec.dev > o.dev) Object.assign(o, rec, { n: o.n }); }
    };
    const main = document.querySelector('main') || document.body;
    for (const el of main.children) add('section', el);
    for (const c of main.querySelectorAll('.container')) { add('container', c); for (const el of c.children) add('block', el); }
    for (const el of main.querySelectorAll('[class]')) if ([...el.classList].some((t) => t === 'card' || /-card$/.test(t))) add('card', el);
    for (const el of main.querySelectorAll('img, video, canvas, picture')) add('media', el);
    out.blocks = [...seen.values()];
    const pos = (el) => { const q = el.getBoundingClientRect(); return { l: q.left, r: q.right, w: q.width }; };
    for (const e of ENF) {
      if (e.edges === 'both') {
        const el = document.querySelector(e.sel); if (!el) { out.enf.push({ name: e.name, st: 'FAIL', note: 'not found' }); continue; }
        const q = pos(el), a = snap(q.l, cl), b = snap(q.r, cr), dev = Math.max(Math.abs(a.d), Math.abs(b.d));
        out.enf.push({ name: e.name, st: dev <= TOL ? 'PASS' : 'FAIL', note: `cols ${a.k}-${b.k} L ${q.l.toFixed(1)} (${a.d.toFixed(1)}) R ${q.r.toFixed(1)} (${b.d.toFixed(1)})` });
      } else if (e.pair) {
        const f = document.querySelector(e.pair.first), s2 = document.querySelector(e.pair.second); if (!f || !s2) { out.enf.push({ name: e.name, st: 'FAIL', note: 'not found' }); continue; }
        const p1 = pos(f), p2 = pos(s2);
        if (p2.l <= p1.l + 1) { out.enf.push({ name: e.name, st: 'SKIP', note: 'stacked (one column)' }); continue; }
        const a = snap(p2.l, cl), b = snap(p1.r, cr), dev = Math.max(Math.abs(a.d), Math.abs(b.d));
        out.enf.push({ name: e.name, st: dev <= TOL ? 'PASS' : 'FAIL', note: `2nd col L ${p2.l.toFixed(1)} = line ${a.k} (${a.d.toFixed(1)}); 1st col R ${p1.r.toFixed(1)} = line ${b.k} (${b.d.toFixed(1)})` });
      }
    }
  }
  const hero = document.querySelector('.legal__hero'), body = document.querySelector('.legal__body');
  if (hero && body) {
    const desktop = cols === 12;
    const a = desktop ? 4 : (cols === 8 ? 2 : 1), b = desktop ? 9 : (cols === 8 ? 7 : cols); /* L7: 6 central columns at every width: 4-9 of 12, 2-7 of 8 (tablet), mobile 4 cols = full width (1-4) */
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
  const rows = [], inv = [], enfRows = []; let fails = 0;
  for (const p of PAGES) for (const w of WIDTHS) {
    const pg = await br.newPage(); await pg.setViewport({ width: w, height: 900 });
    await pg.goto(`${URL}/${p === 'index' ? '' : p + '.html'}`, { waitUntil: 'networkidle2' });
    await pg.evaluate(async () => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); await document.fonts.ready; });
    const o = await pg.evaluate(inpage, { TOL, ENF: L10_ENFORCED.filter((e) => e.page === p) });
    const cen = await pg.evaluate(centreInPage, CENTRED.filter((c) => c.page === p && (!c.min || w >= c.min))); await pg.close();
    for (const e of cen) { enfRows.push([p, w, e.st, 'L10_CENTRE', 'centre: ' + e.name, e.note]); if (e.st === 'FAIL') fails++; }
    inv.push({ p, w, blocks: o.blocks, hscroll: o.hscroll });
    for (const e of o.enf) { enfRows.push([p, w, e.st, 'L10_ENFORCED', e.name, e.note]); if (e.st === 'FAIL') fails++; }
    if (o.legal) {
      const l = o.legal, st = (Math.abs(l.cL - l.eL) <= TOL && Math.abs(l.cR - l.eR) <= TOL && !l.bad.length) ? 'PASS' : 'FAIL'; if (st === 'FAIL') fails++;
      rows.push([p, w, st, `cols ${l.a}-${l.b}`, `${l.cL.toFixed(1)}..${l.cR.toFixed(1)}`, `${l.eL.toFixed(1)}..${l.eR.toFixed(1)}`, l.maxRight.toFixed(1), l.bad.join('; ')]);
    } else rows.push([p, w, 'INFO', `spans ${o.info.join(' ')}`, '', '', '', o.hscroll ? 'h-scroll' : '']);
  }
  await br.close();
  console.log(['page', 'w', 'status', 'columns', 'container L..R', 'column lines L..R', 'text maxRight', 'notes'].join(' | '));
  for (const r of rows) console.log(r.join(' | '));
  console.log('\nL10_ENFORCED | page | w | status | block | measured');
  for (const r of enfRows) console.log(['L10', r[0], r[1], r[2], r[4], r[5]].join(' | '));
  /* coverage: every block measured; INFO = deviation > tol of blocks outside L10_ENFORCED */
  let nb = 0, nd = 0; const off = [];
  for (const it of inv) for (const b of it.blocks) { nb++; if (b.span !== 'bleed' && b.dev > TOL) { nd++; if (it.w === 1440) off.push(`${it.p}: ${b.kind} ${b.label} ${b.span} dev ${b.dev}`); } }
  if (off.length) { console.log('\nINFO (L10, not enforced, 1440, dev > tol):'); for (const o of [...new Set(off)]) console.log('  ' + o); }
  console.log(`\nL10 coverage: ${nb} block measurements (${new Set(inv.map((i) => i.p)).size} pages x ${WIDTHS.length} widths), ${nd} with deviation > ${TOL}px (INFO), ${enfRows.filter((r) => r[2] !== 'SKIP').length} enforced checks (${enfRows.filter((r) => r[2] === 'PASS').length} PASS, ${enfRows.filter((r) => r[2] === 'SKIP').length} skipped-stacked) + legal pages (L7)`);
  if (MD) {
    const L = ['# L10: grid alignment inventory (generated by tools/grid-snap-gate.cjs --md)', '', `Widths: ${WIDTHS.join(', ')}. Column lines = page grid (12 / 8 / 4 cols, --gutter, --grid-gap), same as the G overlay. dev = max(|left - nearest column-left line|, |right - nearest column-right line|), px. FLAG = dev > ${TOL}px. span = declared columns by nearest lines (a-b); bleed = full-window background. Ink of text may be narrower than its box.`, ''];
    const w1 = WIDTHS.includes(1440) ? 1440 : WIDTHS[0], others = WIDTHS.filter((w) => w !== w1);
    for (const p of PAGES) {
      L.push(`## ${p}`, '', `| block | kind | span @${w1} | L..R @${w1} | dev L / R @${w1} | dev | ${others.map((w) => `span/dev @${w}`).join(' | ')} | flag |`, `|---|---|---|---|---|---|${others.map(() => '---|').join('')}---|`);
      const base = inv.find((i) => i.p === p && i.w === w1); if (!base) continue;
      const keys = new Set(); for (const it of inv.filter((i) => i.p === p)) for (const b of it.blocks) keys.add(b.kind + ' ' + b.label);
      for (const k of keys) {
        const f = (w) => { const it = inv.find((i) => i.p === p && i.w === w); return it && it.blocks.find((b) => b.kind + ' ' + b.label === k); };
        const b = f(w1), oc = others.map((w) => { const x = f(w); return x ? `${x.span} / ${x.dev}` : '-'; });
        const flag = [b, ...others.map(f)].some((x) => x && x.span !== 'bleed' && x.dev > TOL) ? 'FLAG' : '';
        const [kind, ...lab] = k.split(' ');
        L.push(b ? `| ${lab.join(' ')}${b.n > 1 ? ' x' + b.n : ''} | ${kind} | ${b.span} | ${b.l}..${b.r} | ${b.dl} / ${b.dr} | ${b.dev} | ${oc.join(' | ')} | ${flag} |` : `| ${lab.join(' ')} | ${kind} | - | - | - | - | ${oc.join(' | ')} | ${flag} |`);
      }
      L.push('');
    }
    fs.writeFileSync(MD, L.join('\n')); console.log('inventory written: ' + MD);
  }
  console.log(`\ngrid-snap: ${rows.filter((r) => r[2] === 'PASS').length} PASS, ${fails} FAIL, ${rows.filter((r) => r[2] === 'INFO').length} INFO`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
