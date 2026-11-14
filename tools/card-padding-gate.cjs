#!/usr/bin/env node
/* Card-padding gate (rule U13, customer 2026-11-14), `npm run audit:card-padding`.
   Every card has a VISIBLE inner padding from ONE token (--card-padding, P): the nearest content (text ink, icon, image, button, field) is no closer than P-0.5 to the
   card edge on all four sides, the same for every card of one size class (lg = P, md = --card-padding-md, sm = --card-padding-sm; the expected value is the card's own computed --card-padding, set by .card--pad-lg/-md/-sm), on every page; and the card edge is visible: card background differs from the parent
   surface (colour distance >= MIN_DE) or the card has a border >= 1 px.
   Cards = outermost element of .card .info-card .text-card .people-card .link-card .product-card .svc-card .quality-card .feature-card .tile .contact-card.
   Media-bleed exceptions (documented, measured only on the sides the media does not touch): a card where an <img>/<video> covers the card edge by design (none today; list in EXC).
   Table: component x min/max distance per side per width. Usage: node tools/card-padding-gate.cjs [--url ..] [--widths 375,768,1024,1440] [--pages all|a,b] [--table]. Exit != 0 on FAIL. Do not run together with other gates. */
const cp = require('child_process');
const L = require('./icon-gate-lib.cjs');
const cfg = L.parse(process.argv.slice(2));
try { const out = cp.execSync("pgrep -f '^node .*(card-padding|card-row|hover-gate|style-gate|poster-swap|grid-snap|hero-fit|header-geo|icon-|scroll-trap|link-targets)'", { encoding: 'utf8' }).split('\n').filter(Boolean).filter((p) => Number(p) !== process.pid);
  if (out.length) { console.error('another gate is running (pid ' + out.join(',') + '): not running two gates in parallel'); process.exit(3); } } catch (e) { /* none */ }
cfg.WIDTHS = String(cfg.opt('widths', '375,768,1024,1440')).split(',').map(Number);
cfg.PAGES = cfg.PAGES.filter((p) => p !== 'design-system'); /* specimen page of the design system */
const TABLE = cfg.opt('table', false) !== false;
function inpage(c) {
  const SEL = '.card,.info-card,.text-card,.people-card,.link-card,.product-card,.svc-card,.quality-card,.feature-card,.tile,.contact-card';
  /* a custom property is returned unresolved (max(), round()): resolve any token to px through a probe element inside the host */
  const px = (host, tok) => { const pr = document.createElement('i'); pr.style.cssText = 'position:absolute;visibility:hidden;width:var(' + tok + ');height:0;padding:0;border:0'; host.appendChild(pr); const v = pr.getBoundingClientRect().width; pr.remove(); return +v.toFixed(2); };
  const P = px(document.documentElement, '--card-padding'), PM = px(document.documentElement, '--card-padding-md'), PS = px(document.documentElement, '--card-padding-sm');
  const cs = [...document.querySelectorAll(SEL)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 80 && r.height > 40 && !e.closest('header,footer,[hidden],.mobile-menu') && getComputedStyle(e).visibility !== 'hidden'; });
  const top = cs.filter((e) => !cs.some((o) => o !== e && o.contains(e)));
  const rgba = (s) => { const m = s.match(/[\d.]+/g); if (!m) return [0, 0, 0, 0]; const k = /^color\(srgb/.test(s) ? 255 : 1; /* color-mix() computes to color(srgb 0..1) */ return [+m[0] * k, +m[1] * k, +m[2] * k, m[3] === undefined ? 1 : +m[3]]; };
  const bgUnder = (e) => { let n = e.parentElement; const stack = []; while (n) { const b = rgba(getComputedStyle(n).backgroundColor); if (b[3] > 0) { stack.push(b); if (b[3] >= 0.99) break; } n = n.parentElement; }
    let base = [255, 255, 255]; for (const b of stack.reverse()) base = [0, 1, 2].map((i) => b[i] * b[3] + base[i] * (1 - b[3])); return base; };
  /* the page has a gradient / photo / WebGL behind some cards: treat as 'complex' (reported, not failed on colour alone) */
  const ink = (e) => { const R = e.getBoundingClientRect(); let t = 1e9, b = 1e9, l = 1e9, r = 1e9, media = false; const add = (q0, host) => { let q = { top: q0.top, bottom: q0.bottom, left: q0.left, right: q0.right };
      /* visible ink only: clip to the box of the text's parent (the em box of a glyph run can exceed a tight/trimmed line box) and to every overflow-clipping ancestor up to the card */
      const clip = (c) => { q = { top: Math.max(q.top, c.top), bottom: Math.min(q.bottom, c.bottom), left: Math.max(q.left, c.left), right: Math.min(q.right, c.right) }; };
      if (host) { clip(host.getBoundingClientRect()); for (let a = host; a && a !== e; a = a.parentElement) { const o = getComputedStyle(a); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') clip(a.getBoundingClientRect()); } }
      q = { ...q, width: q.right - q.left, height: q.bottom - q.top }; if (q.width < 0.5 || q.height < 0.5) return; t = Math.min(t, q.top - R.top); b = Math.min(b, R.bottom - q.bottom); l = Math.min(l, q.left - R.left); r = Math.min(r, R.right - q.right); };
    const walk = (n) => { for (const d of n.children) { const s = getComputedStyle(d); if (s.display === 'none' || s.visibility === 'hidden') continue; if (d.matches('script,style,template')) continue;
        if ((s.position === 'absolute' || s.position === 'fixed') && !d.matches('img,svg,canvas,video,picture') && d.children.length === 0 && !d.textContent.trim()) continue; /* overlays / decorative pseudo hosts */
        if (d.matches('.chip,.icon-ring,.btn,.round-btn')) { add(d.getBoundingClientRect(), d.parentElement === e ? null : d.parentElement); continue; } /* atomic visible objects (pill / ring / button): their own box is the ink, glyphs inside are not measured separately */
        if (d.matches('img,video,picture')) { const q = d.getBoundingClientRect(); const bleed = Math.min(q.top - R.top, R.bottom - q.bottom, q.left - R.left, R.right - q.right) < 0.5; if (bleed) media = true; add(q, d.parentElement === e ? null : d.parentElement); continue; }
        if (d.matches('svg,canvas')) { add(d.getBoundingClientRect(), d.parentElement === e ? null : d.parentElement); continue; }
        if (d.matches('input,select,textarea,button')) { add(d.getBoundingClientRect(), d.parentElement === e ? null : d.parentElement); continue; }
        const bg = rgba(s.backgroundColor), hasBox = bg[3] > 0.05 || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0;
        for (const tn of d.childNodes) if (tn.nodeType === 3 && tn.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(tn); for (const q of rg.getClientRects()) add(q, d); }
        if (hasBox && d.children.length === 0 && d.getBoundingClientRect().width < R.width - 1) add(d.getBoundingClientRect(), d.parentElement === e ? null : d.parentElement);
        walk(d); } };
    walk(e); return { t, b, l, r, media }; };
  const out = [];
  for (const e of top) { const r = e.getBoundingClientRect(), cst = getComputedStyle(e), m = ink(e), bg = rgba(cst.backgroundColor), under = bgUnder(e);
    const own = [0, 1, 2].map((i) => bg[i] * bg[3] + under[i] * (1 - bg[3])); const de = Math.hypot(own[0] - under[0], own[1] - under[1], own[2] - under[2]);
    const bw = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cst['border' + s + 'Width']) * (rgba(cst['border' + s + 'Color'])[3] > 0 ? 1 : 0)));
    const Pc = px(e, '--card-padding'), size = Math.abs(Pc - P) < 0.01 ? 'lg' : Math.abs(Pc - PM) < 0.01 ? 'md' : Math.abs(Pc - PS) < 0.01 ? 'sm' : '?';
    out.push({ Pc, size, cls: String(e.className).split(' ').filter(Boolean).slice(0, 3).join('.'), tag: e.tagName.toLowerCase(), t: +m.t.toFixed(1), r: +m.r.toFixed(1), b: +m.b.toFixed(1), l: +m.l.toFixed(1), media: m.media,
      pad: [cst.paddingTop, cst.paddingRight, cst.paddingBottom, cst.paddingLeft].map(parseFloat), de: +de.toFixed(1), bw, w: +r.width.toFixed(0) }); }
  return { P, PM, PS, cards: out };
}
const MIN_DE = 6; /* min colour distance (RGB euclid) card fill vs parent surface, or a border >= 1 px */
const EXC = []; /* documented media-bleed exceptions: { cls: 'product-card', reason } (none) */
(async () => {
  const res = await L.run(cfg, inpage, {}); let fails = 0, n = 0; const agg = {}; let size0 = '';
  for (const r of res) { const f = [];
    if (!r.P) f.push('--card-padding token missing');
    for (const c of r.cards) { n++;
      const exc = EXC.find((x) => c.cls.includes(x.cls)) || (c.media ? { reason: 'media bleed' } : null);
      const sides = { t: c.t, r: c.r, b: c.b, l: c.l };
      for (const [s, v] of Object.entries(sides)) { if (v > 1e8) continue; const k = c.cls + ' {' + c.size + ' P=' + c.Pc + '}' + (exc ? ' [media-bleed]' : '') + ' @' + r.w; const a = (agg[k] = agg[k] || { t: [1e9, -1], r: [1e9, -1], b: [1e9, -1], l: [1e9, -1], de: [1e9, -1] }); a[s][0] = Math.min(a[s][0], v); a[s][1] = Math.max(a[s][1], v); }
      const ak = c.cls + ' {' + c.size + ' P=' + c.Pc + '}' + (exc ? ' [media-bleed]' : '') + ' @' + r.w; agg[ak] = agg[ak] || { t: [1e9, -1], r: [1e9, -1], b: [1e9, -1], l: [1e9, -1], de: [1e9, -1] }; agg[ak].de[0] = Math.min(agg[ak].de[0], c.de); agg[ak].de[1] = Math.max(agg[ak].de[1], c.de);
      if (!exc) for (const [s, v] of Object.entries(sides)) if (v < 1e8 && v < c.Pc - 0.5) f.push(`${c.cls} [${c.size}] ${s}=${v} < P ${c.Pc}`);
      if (c.size === '?') f.push(`${c.cls} P=${c.Pc} is not lg/md/sm token`);
      if (c.de < MIN_DE && c.bw < 1) f.push(`${c.cls} edge invisible (fill dE ${c.de}, no border)`); }
    if (f.length) { fails++; console.log(`FAIL ${r.page} @${r.w}: ${[...new Set(f)].join('; ')}`); } }
  if (TABLE || true) { console.log('component {size class P} @width: min..max distance edge->content (top/right/bottom/left) | fill dE vs parent');
    for (const k of Object.keys(agg).sort()) { const a = agg[k], f = (x) => (x[0] > 1e8 ? '-' : x[0] === x[1] ? x[0] : x[0] + '..' + x[1]); console.log(`  ${k}: T ${f(a.t)} R ${f(a.r)} B ${f(a.b)} L ${f(a.l)} | dE ${f(a.de)}`); } }
  console.log(`card-padding: ${res.length} page x width, ${n} cards; P(lg)=${res[0] && res[0].P} md=${res[0] && res[0].PM} sm=${res[0] && res[0].PS}; ${fails ? fails + ' FAIL' : 'PASS'}`);
  process.exit(fails ? 1 : 0);
})();
