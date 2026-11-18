#!/usr/bin/env node
/* Colour-token gate (customer rule C3, 2026-11-18), `npm run audit:colour-token`.
   Every text node on a BLUE background (surface-accent, surface-card-on-accent, blue slide panels...):
     - headings (h1-h6, .t-display/.t-h*, *__title, *__headline)       -> computed colour = white (--text-on-accent);
     - descriptive text (p, .t-lead, .t-body, li, dd, figcaption)     -> computed colour = color-mix(white 80%, the LOCAL blue background) (--text-on-accent-soft);
     - every text node (also labels, links, buttons)                  -> contrast against the blue background >= 4.5 (large text >= 3).
   Backgrounds: nearest ancestor with an opaque background-colour; ancestors with background-image / canvas / video (photo, gradient) are skipped (text on photos is not "blue background" text).
   Usage: node tools/colour-token-gate.cjs [--url http://localhost:5173] [--widths 1440,375] [--pages all|a,b] [--inventory] [--verbose]. Exit != 0 on FAIL. */
const L = require('./icon-gate-lib.cjs');
const argv = process.argv.slice(2);
const cfg = L.parse(argv.includes('--widths') ? argv : argv.concat(['--widths', '1440,375']));
L.guardParallel();
const INV = argv.includes('--inventory'), VERBOSE = argv.includes('--verbose');

function inpage({ FREEZE }) {
  const st = document.createElement('style'); st.textContent = FREEZE; document.head.append(st);
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) { const c = s.match(/color\(srgb ([^)]+)\)/); if (c) { const p = c[1].split(/[ /]+/).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] === undefined ? 1 : p[3]]; } return null; } const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const isBlue = ([r, g, b]) => b > r + 40 && b > g + 15 && lum([r, g, b]) < 0.2;
  const sig = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '');
  const bgOf = (el) => {                       /* nearest opaque background-colour; null = image / unknown surface */
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/^(CANVAS|VIDEO|IMG|PICTURE)$/.test(a.tagName)) return null;
      const c = parse(cs.backgroundColor);
      if (cs.backgroundImage !== 'none' && (!c || c[3] < 1)) return null;
      if (c && c[3] >= 0.99) return { c, el: a };
    }
    return null;
  };
  const HEAD = 'h1,h2,h3,h4,h5,h6,.t-display,.t-h1,.t-h2,.t-h3,[class*="__title"],[class*="__headline"],[class*="-title"]';
  const DESC = 'p,.t-lead,.t-body,li,dd,figcaption,[class*="__text"],[class*="__desc"],[class*="__lead"]';
  const SKIP = 'script,style,noscript,svg,canvas,input,textarea,select,option,[aria-hidden="true"]';
  const rows = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const seen = new Set();
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (!t.textContent.trim()) continue; const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest(SKIP)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1 || +cs.opacity === 0) continue;
    const bg = bgOf(el); if (!bg || !isBlue(bg.c)) continue;
    let fg = parse(cs.color); if (!fg) continue;
    if (fg[3] < 1) fg = [0, 1, 2].map((i) => fg[i] * fg[3] + bg.c[i] * (1 - fg[3])).concat(1);
    const block = el.closest(HEAD + ',' + DESC) || el;
    const role = block.matches(HEAD) || el.matches(HEAD) ? 'heading' : (block.matches(DESC) || el.matches(DESC) ? 'desc' : 'other');
    const inCtl = !!el.closest('a,button,.btn,[role=button],label,.chip,.lang-switch,.nav-pill,.process-steps__item');
    const fs = parseFloat(cs.fontSize), large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
    const exp = role === 'desc' && !inCtl ? [0, 1, 2].map((i) => Math.round(255 * 0.8 + bg.c[i] * 0.2)) : null;
    rows.push({ sel: sig(el) + (block !== el ? ' < ' + sig(block) : ''), txt: el.textContent.trim().slice(0, 28), role: inCtl && role === 'desc' ? 'control' : role, fg: fg.slice(0, 3).map(Math.round), bg: bg.c.slice(0, 3).map(Math.round), bgEl: sig(bg.el), cr: +cr(fg, bg.c).toFixed(2), large, exp });
  }
  return { rows };
}
const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important}';
const rgb = (a) => 'rgb(' + a.join(',') + ')';
(async () => {
  const res = await L.run(cfg, inpage, { FREEZE });
  let fails = 0, n = 0, minCr = 99, minAt = ''; const seenRow = new Set(); const fl = [];
  const stat = { heading: 0, desc: 0, control: 0, other: 0 };
  for (const r of res) for (const x of r.rows) {
    n++; stat[x.role]++;
    const need = x.large ? 3 : 4.5; if (x.cr < minCr) { minCr = x.cr; minAt = `${r.page}@${r.w} ${x.sel} "${x.txt}"`; }
    let why = '';
    if (x.cr < need) why = `contrast ${x.cr} < ${need}`;
    else if (x.role === 'heading' && !x.fg.every((v) => v === 255)) why = `heading ${rgb(x.fg)} != white`;
    else if (x.exp && x.fg.some((v, i) => Math.abs(v - x.exp[i]) > 1)) why = `desc ${rgb(x.fg)} != soft ${rgb(x.exp)} (white 80% over ${rgb(x.bg)})`;
    const line = `${r.page}@${r.w} | ${x.role} | ${x.sel} "${x.txt}" | fg ${rgb(x.fg)} on ${rgb(x.bg)} (${x.bgEl}) | CR ${x.cr}${x.exp ? ' | want ' + rgb(x.exp) : ''}`;
    if (INV && x.role !== 'other' && !seenRow.has(line)) { seenRow.add(line); console.log(line); }
    if (why) { fails++; if (fl.length < 60 || VERBOSE) fl.push(`FAIL ${line} | ${why}`); }
  }
  if (!INV) for (const f of fl) console.log(f);
  console.log(`colour-token: ${n} text nodes on blue over ${res.length} loads (heading ${stat.heading}, descriptive ${stat.desc}, control ${stat.control}, other ${stat.other}); min contrast ${minCr} at ${minAt}`);
  console.log(`colour-token: ${fails ? 'FAIL ' + fails : 'PASS'}`);
  process.exit(INV ? 0 : fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
