#!/usr/bin/env node
/* OSTA style CENSUS (independent audit, read-only; content/audit/system-census-1.md).
   Walks EVERY built HTML page (EN + DE: root, de/, products/*, products/category/*, 404, legal) at several widths,
   in 3 states: REST (computed styles of every visible element), HOVER (real mouse hover of every interactive element,
   transitions read from document.getAnimations() + frame sampling of the settle time), FOCUS-VISIBLE (real Tab key walk).
   Aggregates "property -> value -> count -> selectors/pages" and classifies each value against src/styles/tokens.css
   (resolved per width in the page), the colour palette and the type/space/radius scales.

   Usage (from osta/):
     node tools/census.cjs                       # builds a snapshot (VITE_BASE=/) into a temp dir, serves it on 5197, all pages, all widths
     node tools/census.cjs --dist /path/to/dist  # use an already built dir (built with VITE_BASE=/)
     options: --widths 1728,1440,1200,1024,768,375  --hover-widths <same>  --pages <substr,substr|all>  --workers 3
              --port 5197  --out <dir> (default $TMPDIR/osta-census)  --frames <page substrs for frame sampling at 1440; default templates>
              --product-hover-widths 1440,375 (hover/focus on products/<slug> pages only at these widths)
              --no-hover  --no-focus  --webgl (keep WebGL on; default: --disable-3d-apis, posters stay)
              --resume (continue after a crash: jobs already in <out>/parts.jsonl are skipped)  --report <census.json> (only rebuild the tables)
   Run time: ~45 min for 62 pages x 6 widths with 2 workers. Do not run while hover-gate/style-gate run (CPU load). Read-only: never edits the project.
   Output: <out>/census.json (raw aggregate), <out>/census-tables.md (all tables), console summary.
   Does NOT touch the dev server (5173) or other gates' ports. Chrome: $CHROME or the macOS default. puppeteer-core: project node_modules or $PPTR. */
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
let puppeteer; try { puppeteer = require(process.env.PPTR || 'puppeteer-core'); } catch (e) { puppeteer = require(path.resolve(__dirname, '../node_modules/puppeteer-core')); }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const ROOT = process.env.OSTA_ROOT ? path.resolve(process.env.OSTA_ROOT) : path.resolve(__dirname, '..');
const WIDTHS = String(opt('widths', '1728,1440,1200,1024,768,375')).split(',').map(Number);
const HOVER_W = opt('no-hover', false) ? [] : String(opt('hover-widths', WIDTHS.join(','))).split(',').map(Number);
const FOCUS = !opt('no-focus', false);
const PROD_HOVER_W = String(opt('product-hover-widths', '1440,375')).split(',').map(Number); /* 43 product pages share one template: hover/focus there only at these widths (rest at all widths) */
const isProduct = (k) => /^(de\/)?products\/(?!category)/.test(k);
const WORKERS = Math.max(1, Number(opt('workers', 3)) || 3);
const PORT = Number(opt('port', 5197));
const OUT = path.resolve(String(opt('out', path.join(os.tmpdir(), 'osta-census'))));
const FRAMES = String(opt('frames', 'index,about,services,catalog,contact,faq,privacy,404,products/category/api,products/anastrozole,de/index,de/catalog')).split(',');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TOKENS_SRC = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
const TOKEN_NAMES = [...new Set([...TOKENS_SRC.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))];
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- static server for the snapshot ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream' };
function serve(dir, port) {
  return new Promise((res, rej) => {
    const srv = http.createServer((req, r) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]); let f = path.join(dir, p);
      if (!f.startsWith(dir)) { r.writeHead(403); return r.end(); }
      try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) { if (fs.existsSync(f + '.html')) f += '.html'; }
      fs.readFile(f, (err, buf) => {
        if (err) { const nf = path.join(dir, '404.html'); r.writeHead(404, { 'content-type': MIME['.html'] }); return r.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found'); }
        r.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); r.end(buf);
      });
    });
    srv.on('error', rej); srv.listen(port, 'localhost', () => res(srv));
  });
}
function discoverPages(dir) {
  const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'assets') walk(p); } else if (e.name.endsWith('.html')) out.push(p); } }; walk(dir);
  return out.map((f) => { const rel = path.relative(dir, f).split(path.sep).join('/'); const key = rel === 'index.html' ? 'index' : rel.replace(/\/index\.html$/, '').replace(/\.html$/, ''); return { key, url: rel.endsWith('index.html') ? '/' + rel.replace(/index\.html$/, '') : '/' + rel }; }).sort((a, b) => a.key.localeCompare(b.key));
}

/* ======================= in-page code (serialised) ======================= */
function inpageLib() {
  if (window.__C) return;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = (c) => { if (!c) return null; if (cache.has(c)) return cache.get(c); g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; let v = [d[0], d[1], d[2], +(d[3] / 255).toFixed(2)];
    /* canvas premultiplies: for alpha < 1 parse rgba() text when possible */
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\)/.exec(c); if (m) v = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), m[4] === undefined ? 1 : +(+m[4]).toFixed(2)];
    else { const s = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(c); if (s) v = [Math.round(s[1] * 255), Math.round(s[2] * 255), Math.round(s[3] * 255), s[4] === undefined ? 1 : +(+s[4]).toFixed(2)]; }
    cache.set(c, v); return v; };
  const ckey = (v) => v ? (v[3] === 1 ? 'rgb(' + v.slice(0, 3).join(',') + ')' : 'rgba(' + v.join(',') + ')') : 'none';
  const cls = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '').trim().split(/\s+/).filter((x) => x && !/^(is-|js-|lenis|word|photo-zoom)/.test(x));
  const sig0 = (el) => { const c = cls(el).slice(0, 3); return el.tagName.toLowerCase() + (c.length ? '.' + c.join('.') : ''); };
  const sig = (el) => { if (!el || !el.tagName) return '?'; const s = sig0(el); if (cls(el).length) return s; const p = el.parentElement; if (!p || p === document.body) return s; const pc = cls(p).length ? sig0(p) : (p.parentElement && cls(p.parentElement).length ? sig0(p.parentElement) + ' ' + sig0(p) : sig0(p)); return pc + ' > ' + s; };
  const vis = (el) => { try { if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) return false; } catch (e) {} const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const ownText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const px = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const r1 = (n) => Math.round(n * 10) / 10;
  /* tokens resolved for THIS width */
  const resolveTokens = (names) => {
    const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1000px;height:1000px;visibility:hidden;color:rgb(1,2,3)';
    const p = document.createElement('div'); host.appendChild(p); document.body.appendChild(host);
    const root = getComputedStyle(document.documentElement); const T = {};
    for (const n of names) {
      const raw = root.getPropertyValue(n).trim(); if (!raw) continue; const t = { raw };
      p.style.cssText = 'color: var(' + n + ')'; const c = getComputedStyle(p).color; if (c !== 'rgb(1, 2, 3)') t.color = rgba(c);
      p.style.cssText = 'position:absolute;width: var(' + n + ')'; const w = getComputedStyle(p).width; p.style.cssText = 'position:absolute;width:7.77px'; const w0 = getComputedStyle(p).width;
      p.style.cssText = 'position:absolute;width: var(' + n + ')'; if (/px|calc|%|em|rem|vw/.test(raw) || /^-?\d/.test(raw)) { const ww = getComputedStyle(p).width; if (ww !== '7.77px' && ww !== 'auto' && /px$/.test(ww)) t.px = px(ww); }
      p.style.cssText = 'transition-duration: var(' + n + ')'; const d = getComputedStyle(p).transitionDuration; if (/ms|s$/.test(raw) && d !== '0s') t.ms = Math.round(parseFloat(d) * 1000);
      p.style.cssText = 'transition-timing-function: var(' + n + ')'; const e = getComputedStyle(p).transitionTimingFunction; if (/cubic|ease|linear|steps/.test(raw)) t.ease = e;
      if (/^-?[\d.]+em$/.test(raw)) t.em = parseFloat(raw);
      if (/^[\d.]+%$/.test(raw)) t.pct = raw;
      if (/^\d{3}$/.test(raw)) t.num = +raw;
      T[n] = t; void w0; void w;
    }
    host.remove(); return T;
  };
  window.__C = { rgba, ckey, cls, sig0, sig, vis, ownText, px, r1, resolveTokens };
}

/* REST: computed styles of every visible element in scope */
function restCollect(cfg) {
  const { rgba, ckey, cls, sig, vis, ownText, px, r1 } = window.__C;
  const scope = cfg.scope ? document.querySelector(cfg.scope) : document.body; if (!scope) return { entries: [], comps: [], n: 0 };
  const E = new Map(); const add = (prop, val, s) => { const k = prop + '\u0001' + val + '\u0001' + s; E.set(k, (E.get(k) || 0) + 1); };
  const COMP = []; let n = 0;
  const ROLE = /(^|\s)(btn|round-btn|nav-pill|lang-switch|lang-menu__option|chip|tag|filter-item|icon-ring|contact-line|card|product-card|link-card|svc-card|text-card|info-card|quality-card|people-card|feature-card|service-card|tile|input|select|textarea|field|search|hero-search__bar|section-head|eyebrow|t-eyebrow|breadcrumbs|pagination|catalog__filters-toggle|header__burger|footer__contact)(\s|$|--|__)/;
  const trans = (cs) => { const P = cs.transitionProperty.split(/\s*,\s*/), D = cs.transitionDuration.split(/\s*,\s*/), DL = cs.transitionDelay.split(/\s*,\s*/), TF = cs.transitionTimingFunction.split(/,(?![^(]*\))\s*/); const out = []; for (let i = 0; i < P.length; i++) { const d = D[i % D.length], dl = DL[i % DL.length], tf = TF[i % TF.length]; if (parseFloat(d) === 0 && parseFloat(dl) === 0) continue; out.push(P[i] + ' ' + Math.round(parseFloat(d) * 1000) + 'ms' + (parseFloat(dl) ? ' +' + Math.round(parseFloat(dl) * 1000) + 'ms' : '') + ' ' + tf); } return out; };
  for (const el of scope.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|meta|link|template|noscript|br|source|title|head|wbr)$/.test(tag)) continue;
    if (el.closest('svg') && tag !== 'svg') continue;
    if (cfg.skipScope && el.closest(cfg.skipScope)) continue;
    if (!vis(el)) continue;
    n++;
    const cs = getComputedStyle(el); const s = sig(el); const txt = ownText(el); const r = el.getBoundingClientRect();
    if (txt || tag === 'svg' || tag === 'input' || tag === 'textarea' || tag === 'select') {
      add('color', ckey(rgba(cs.color)), s);
      if (txt || tag !== 'svg') {
        add('font-size', cs.fontSize, s); add('font-weight', cs.fontWeight, s); add('line-height', cs.lineHeight, s);
        const fs_ = parseFloat(cs.fontSize); const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing); add('letter-spacing', (Math.round(ls / fs_ * 1000) / 1000) + 'em', s);
        add('font-family', cs.fontFamily.split(',')[0].replace(/["']/g, ''), s);
        const deco = cs.textDecorationLine; if (deco && deco !== 'none') { const prose = tag === 'a' && !cls(el).length && !!el.parentElement.closest('p,li,dd,td'); add('text-decoration', deco + (prose ? ' [inline-prose a]' : ' [NOT inline prose]'), s + ' @' + (el.closest('footer') ? 'footer' : el.closest('header') ? 'header' : 'main')); }
      }
    }
    if (tag === 'a' && el.parentElement && el.parentElement.closest('p,li,dd,td') && !el.closest('nav,header,footer')) add('a-in-text', (cs.textDecorationLine === 'none' ? 'no-underline' : cs.textDecorationLine) + ' / ' + ckey(rgba(cs.color)) + (cls(el).length ? ' [classed]' : ' [bare a]'), s);
    const bg = rgba(cs.backgroundColor); if (bg && bg[3] > 0) add('background-color', ckey(bg), s);
    if (/gradient/.test(cs.backgroundImage)) add('background-image', cs.backgroundImage.slice(0, 160), s);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) { const w = parseFloat(cs['border' + side + 'Width']); if (w > 0 && cs['border' + side + 'Style'] !== 'none') { const c = rgba(cs['border' + side + 'Color']); if (c && c[3] > 0) { add('border-color', ckey(c), s); add('border-width', w + 'px ' + cs['border' + side + 'Style'], s); } } }
    if (cs.borderRadius && cs.borderRadius !== '0px') add('border-radius', cs.borderRadius, s);
    if (cs.boxShadow && cs.boxShadow !== 'none') add('box-shadow', cs.boxShadow.slice(0, 120), s);
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) add('outline(rest)', cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + ckey(rgba(cs.outlineColor)), s);
    const pads = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]; if (pads.some((v) => px(v) !== 0)) { add('padding', pads.map((v) => px(v) + 'px').join(' '), s); for (const v of new Set(pads)) if (px(v)) add('padding-side', px(v) + 'px', s); }
    const disp = cs.display;
    if (/flex|grid/.test(disp)) { const rg = cs.rowGap, cg = cs.columnGap; if (rg !== 'normal' && px(rg)) add('row-gap', px(rg) + 'px', s + (/grid/.test(disp) ? ' [grid]' : ' [flex ' + cs.flexDirection + ']')); if (cg !== 'normal' && px(cg)) add('column-gap', px(cg) + 'px', s + (/grid/.test(disp) ? ' [grid]' : ' [flex ' + cs.flexDirection + ']')); }
    const mg = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft]; for (const v of mg) if (px(v) && cs.position !== 'absolute' && cs.position !== 'fixed') add('margin-side', px(v) + 'px', s);
    /* real distance between consecutive in-flow block siblings (vertical rhythm) */
    if (/^(block|flow-root|list-item)$/.test(disp) && el.children.length > 1) {
      let prev = null;
      for (const ch of el.children) { const cc = getComputedStyle(ch); if (cc.position === 'absolute' || cc.position === 'fixed' || cc.display === 'none' || /^inline/.test(cc.display) || cc.float !== 'none' || !vis(ch)) continue; const rr = ch.getBoundingClientRect(); if (prev) { const d = r1(rr.top - prev.bottom); if (d > 0.5) add('sibling-gap(block)', Math.round(d) + 'px', s + ' > ' + sig(ch)); } prev = rr; }
    }
    if (/flex|grid/.test(disp) && el.children.length > 1 && cs.flexDirection !== 'row' && !/grid/.test(disp)) {
      let prev = null;
      for (const ch of el.children) { const cc = getComputedStyle(ch); if (cc.position === 'absolute' || cc.position === 'fixed' || !vis(ch)) continue; const rr = ch.getBoundingClientRect(); if (prev) { const d = r1(rr.top - prev.bottom); if (d > 0.5) add('sibling-gap(flex-col)', Math.round(d) + 'px', s + ' > ' + sig(ch)); } prev = rr; }
    }
    const tr = trans(cs); if (tr.length) add('transition', tr.join(' | '), s);
    if (cs.animationName && cs.animationName !== 'none') add('animation', cs.animationName + ' ' + cs.animationDuration + ' ' + cs.animationTimingFunction, s);
    for (const pe of ['::before', '::after']) { const ps = getComputedStyle(el, pe); if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue; if (ps.display === 'none') continue; const t2 = trans(ps); if (t2.length) add('transition' + pe, t2.join(' | '), s); const b2 = rgba(ps.backgroundColor); if (b2 && b2[3] > 0) add('background-color', ckey(b2), s + pe); if (ps.borderRadius && ps.borderRadius !== '0px') add('border-radius', ps.borderRadius, s + pe); for (const side of ['Top', 'Bottom']) { const w = parseFloat(ps['border' + side + 'Width']); if (w > 0 && ps['border' + side + 'Style'] !== 'none') { const c = rgba(ps['border' + side + 'Color']); if (c && c[3] > 0) add('border-color', ckey(c), s + pe); } } if (ps.boxShadow && ps.boxShadow !== 'none') add('box-shadow', ps.boxShadow.slice(0, 120), s + pe); }
    /* component metrics */
    const cl = cls(el).join(' ');
    if (ROLE.test(cl) || tag === 'button' || (tag === 'a' && (bg && bg[3] > 0 || parseFloat(cs.borderTopWidth) > 0))) {
      COMP.push([sig(el), 'h=' + Math.round(r.height) + (/btn|pill|chip|tag|switch|option|filter|round|input|select|search|burger|toggle|ring/.test(cl) || tag === 'button' ? '' : '*') + ' pad=' + pads.map((v) => px(v)).join('/') + ' fs=' + cs.fontSize + ' fw=' + cs.fontWeight + ' lh=' + cs.lineHeight + ' r=' + cs.borderTopLeftRadius + (/flex|grid/.test(disp) ? ' gap=' + (cs.rowGap === 'normal' ? 0 : px(cs.rowGap)) + '/' + (cs.columnGap === 'normal' ? 0 : px(cs.columnGap)) : '') + ' bg=' + ckey(bg) + ' bd=' + (parseFloat(cs.borderTopWidth) ? cs.borderTopWidth + ' ' + ckey(rgba(cs.borderTopColor)) : '0')]);
    }
  }
  return { entries: [...E].map(([k, c]) => { const [p, v, s] = k.split('\u0001'); return [p, v, s, c]; }), comps: COMP, n };
}

/* list of interactive candidates (marks them with data-cz) */
function listInteractive(cfg) {
  const { cls, sig, vis } = window.__C;
  const SEL = 'a[href],button,summary,[role=button],[role=option],[role=tab],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),.nav-pill,.lang-switch,.lang-menu__option,.filter-item,.round-btn,.chip,.icon-ring--action,.contact-line,[class*="card"]';
  const scope = cfg.scope ? document.querySelector(cfg.scope) : document; const out = [];
  let i = window.__czN || 0;
  for (const el of scope.querySelectorAll(SEL)) {
    if (el.hasAttribute('data-cz') && !cfg.rescan) continue;
    if (el.hasAttribute('data-cz')) continue;
    if (el.matches('[class*="card"]') && !cls(el).some((c) => /card$/.test(c)) ) continue; /* only card roots */
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (el.closest('.visually-hidden,.sr-only')) continue;
    el.setAttribute('data-cz', String(++i));
    const c = cls(el).join(' '); const cs = getComputedStyle(el);
    const isField = /^(input|select|textarea)$/i.test(el.tagName);
    const isCard = cls(el).some((x) => /card$/.test(x)) || /contact-line/.test(c);
    const fill = window.__C.rgba(cs.backgroundColor)[3] > 0.02 || parseFloat(cs.borderTopWidth) > 0;
    const isBtn = /(^|\s)(btn|round-btn|nav-pill|lang-switch|lang-menu__option|filter-item|chip|icon-ring--action|header__burger|catalog__filters-toggle)/.test(c) || el.tagName === 'BUTTON' || (fill && !isCard);
    out.push({ id: i, sig: sig(el), kind: isField ? 'field' : isCard ? 'card' : isBtn ? 'button' : el.tagName === 'A' ? 'link' : 'other' });
  }
  window.__czN = i; return out;
}

/* hover: prepare (scroll + point + rest snapshot) */
function hoverPrepare(id) {
  const el = document.querySelector('[data-cz="' + id + '"]'); if (!el) return { skip: 'gone' };
  for (const a of document.getAnimations()) { try { const e = a.effect.getComputedTiming().endTime; if (isFinite(e) && a.playState === 'running') a.finish(); } catch (x) {} }
  let r = el.getBoundingClientRect(); const vh = innerHeight;
  if (r.top < 90 || r.bottom > vh - 10) { window.scrollTo(0, window.scrollY + r.top - vh / 2 + r.height / 2); r = el.getBoundingClientRect(); }
  if (!window.__C.vis(el)) return { skip: 'hidden' };
  const pts = [[0.5, 0.5], [0.5, 0.25], [0.5, 0.75], [0.2, 0.5], [0.8, 0.5]];
  for (const [fx, fy] of pts) { const x = r.left + r.width * fx, y = r.top + r.height * fy; if (x < 0 || y < 0 || x > innerWidth || y > vh) continue; const hit = document.elementFromPoint(x, y); if (hit && (hit === el || el.contains(hit))) return { x, y }; }
  return { skip: 'occluded' };
}
const SNAP_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'textDecorationLine', 'textDecorationColor', 'opacity', 'transform', 'scale', 'translate', 'boxShadow', 'outlineStyle', 'filter'];
function hoverMeasure(cfg) {
  const requestAnimationFrame = (f) => { let d = false; const g = () => { if (!d) { d = true; f(performance.now()); } }; window.requestAnimationFrame(g); setTimeout(g, 50); };
  const { id, frames, PROPS } = cfg; const el = document.querySelector('[data-cz="' + id + '"]'); const { sig, rgba, ckey } = window.__C;
  const fam = (t) => t && (t === el || el.contains(t) || t.contains(el));
  const kids = [...el.querySelectorAll('.icon,.round-btn,.icon-ring,svg')].slice(0, 3);
  const snap = () => { const o = {}; const grab = (k, s) => { for (const p of PROPS) o[k + '.' + p] = s[p]; }; grab('el', getComputedStyle(el)); grab('::before', getComputedStyle(el, '::before')); grab('::after', getComputedStyle(el, '::after')); kids.forEach((k, i) => grab('kid' + i, getComputedStyle(k))); kids.forEach((k, i) => grab('kid' + i + '::before', getComputedStyle(k, '::before'))); return o; };
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const anims = document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; return fam(t); });
    const A = anims.map((a) => { const t = a.effect.getTiming(); return { t: t && a.effect.target === el ? 'self' : sig(a.effect.target), pe: a.effect.pseudoElement || '', p: a.transitionProperty || a.animationName || 'waapi', d: Math.round(Number(t.duration) || 0), dl: Math.round(t.delay || 0), e: t.easing, kind: a.constructor.name }; });
    const finishAll = () => { for (const a of document.getAnimations()) { try { const e = a.effect.getComputedTiming().endTime; if (isFinite(e) && a.playState === 'running' && fam(a.effect.target)) a.finish(); } catch (x) {} } };
    const done = (settle) => { finishAll(); requestAnimationFrame(() => { const end = snap(); resolve({ A, end, settle }); }); };
    if (!frames) return done(null);
    /* frame sampling: real time until the last visual change (max 2500 ms) */
    const t0 = performance.now(); let last = snap(), lastChange = 0, firstChange = null, nf = 0;
    const tick = () => { nf++; const s = snap(); const now = performance.now() - t0; let ch = false; for (const k in s) if (s[k] !== last[k]) { ch = true; break; } if (ch) { lastChange = now; if (firstChange === null) firstChange = now; } last = s; if (now - lastChange > 350 && now > 400 || now > 2500) return done({ firstMs: firstChange === null ? null : Math.round(firstChange), settleMs: Math.round(lastChange), frames: nf }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })));
}
function restSnap(cfg) { const el = document.querySelector('[data-cz="' + cfg.id + '"]'); if (!el) return null; const o = {}; const kids = [...el.querySelectorAll('.icon,.round-btn,.icon-ring,svg')].slice(0, 3); const grab = (k, s) => { for (const p of cfg.PROPS) o[k + '.' + p] = s[p]; }; grab('el', getComputedStyle(el)); grab('::before', getComputedStyle(el, '::before')); grab('::after', getComputedStyle(el, '::after')); kids.forEach((k, i) => grab('kid' + i, getComputedStyle(k))); kids.forEach((k, i) => grab('kid' + i + '::before', getComputedStyle(k, '::before'))); return o; }
function settleAll() { const requestAnimationFrame = (f) => { let d = false; const g = () => { if (!d) { d = true; f(); } }; window.requestAnimationFrame(g); setTimeout(g, 50); }; return new Promise((res) => requestAnimationFrame(() => { for (const a of document.getAnimations()) { try { const e = a.effect.getComputedTiming().endTime; if (isFinite(e) && a.playState === 'running') a.finish(); } catch (x) {} } requestAnimationFrame(() => res(true)); })); }
function focusInfo() {
  const el = document.activeElement; if (!el || el === document.body) return null; const { sig, rgba, ckey } = window.__C; const cs = getComputedStyle(el);
  let fv = false; try { fv = el.matches(':focus-visible'); } catch (e) {}
  const b = getComputedStyle(el, '::before');
  return { id: el.getAttribute('data-cz') || '', sig: sig(el), fv, outline: cs.outlineStyle === 'none' ? 'none' : cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + ckey(rgba(cs.outlineColor)) + ' off ' + cs.outlineOffset, shadow: cs.boxShadow, bg: ckey(rgba(cs.backgroundColor)), color: ckey(rgba(cs.color)), beforeScale: b.scale, deco: cs.textDecorationLine, vis: window.__C.vis(el) };
}

/* ======================= runner ======================= */
(async () => {
  if (opt('report', null)) { const R = JSON.parse(fs.readFileSync(String(opt('report')), 'utf8')); report(R, OUT); console.log('tables -> ' + path.join(OUT, 'census-tables.md')); return; }
  const t0 = Date.now(); let base, stop = () => {}, distDir;
  if (opt('url', null)) { base = String(opt('url')).replace(/\/$/, ''); distDir = path.join(ROOT, 'dist'); }
  else {
    distDir = opt('dist', null) ? path.resolve(String(opt('dist'))) : path.join(os.tmpdir(), 'osta-census-' + process.pid);
    if (!opt('dist', null)) { process.stderr.write('building snapshot (VITE_BASE=/) into ' + distDir + ' ... '); cp.execSync('npx vite build --outDir ' + JSON.stringify(distDir) + ' --emptyOutDir', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_BASE: '/' } }); process.stderr.write('done\n'); }
    const srv = await serve(distDir, PORT); base = 'http://localhost:' + PORT; stop = () => { srv.close(); if (!opt('dist', null)) try { fs.rmSync(distDir, { recursive: true, force: true }); } catch (e) {} };
  }
  let pages = discoverPages(distDir).filter((p) => !/^(product|design-system)$/.test(p.key));
  const sel = opt('pages', 'all'); if (sel !== 'all' && sel !== true) { const ss = String(sel).split(','); pages = pages.filter((p) => ss.some((s) => p.key === s || p.key.includes(s))); }
  /* ONE browser per worker (one foreground tab each): background tabs throttle rAF/transitions */
  const launch0 = () => puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 60000, args: ['--no-sandbox', '--hide-scrollbars', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', ...(opt('webgl', false) ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--disable-3d-apis'])] });
  const launch = async () => { for (let i = 0; ; i++) { try { return await launch0(); } catch (e) { if (i >= 4) throw e; process.stderr.write('launch retry ' + (i + 1) + ': ' + e.message.slice(0, 80) + '\n'); await new Promise((r) => setTimeout(r, 5000)); } } };
  const browsers = [];
  const PARTS = path.join(OUT, 'parts.jsonl'); if (!opt('resume', false) && fs.existsSync(PARTS)) fs.unlinkSync(PARTS);
  const doneKeys = new Set(fs.existsSync(PARTS) ? fs.readFileSync(PARTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
  const jobs = []; for (const p of pages) for (const w of WIDTHS) if (!doneKeys.has(p.key + '@' + w)) jobs.push({ p, w });
  const RES = { meta: { started: new Date(t0).toISOString(), base, pages: pages.map((p) => p.key), widths: WIDTHS, hoverWidths: HOVER_W, productHoverWidths: PROD_HOVER_W, focus: FOCUS, webgl: !!opt('webgl', false), tokenNames: TOKEN_NAMES.length }, tokens: {}, rest: [], comps: [], hover: [], focus: [], skips: [], errors: [], elements: 0, perJob: [] };
  let done = 0;
  const run = async (job, browser) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const page = await browser.newPage(); const jt = Date.now(); const J = { key: job.p.key + '@' + job.w, tokens: null, elements: 0, rest: [], comps: [], skips: [], hover: [], focus: [], perJob: [] };
      try {
        const killer = setTimeout(() => { page.close().catch(() => {}); }, 420000);
        await page.setViewport({ width: job.w, height: 900, deviceScaleFactor: 1 });
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await page.goto(base + job.p.url, { waitUntil: 'load', timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < h + 900; y += 600) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await new Promise((r) => setTimeout(r, 70)); }
        await new Promise((r) => setTimeout(r, 700));
        await page.addStyleTag({ content: 'html.js [data-reveal]:not(.is-revealed){opacity:1!important;transform:none!important} html.js :is(h1,h2,h3).t-display:not(.is-split){opacity:1!important} .t-display .word__inner{opacity:1!important;transform:none!important}' });
        await page.evaluate(() => window.scrollTo(0, 0)); await page.evaluate(settleAll); await new Promise((r) => setTimeout(r, 150)); await page.evaluate(settleAll);
        await page.evaluate(inpageLib);
        const T = await page.evaluate((n) => window.__C.resolveTokens(n), TOKEN_NAMES); J.tokens = T;
        const rest = await page.evaluate(restCollect, {}); J.elements += rest.n;
        for (const [p, v, s, c] of rest.entries) J.rest.push([p, v, s, c, job.p.key, job.w, 'rest']);
        for (const [s, v] of rest.comps) J.comps.push([s, v, job.p.key, job.w, 'rest']);
        let hovN = 0, focN = 0;
        const doHover = async (list, scene) => {
          for (const it of list.slice(0, 450)) {
            const prep = await page.evaluate(hoverPrepare, it.id); if (prep.skip) { J.skips.push([job.p.key, job.w, it.sig, prep.skip, scene]); continue; }
            const restS = await page.evaluate(restSnap, { id: it.id, PROPS: SNAP_PROPS });
            const wantFrames = job.w === 1440 && FRAMES.some((f) => job.p.key === f) && !run.seenSig.has(job.p.key + '|' + it.sig);
            if (wantFrames) run.seenSig.add(job.p.key + '|' + it.sig);
            await page.mouse.move(prep.x, prep.y);
            const m = await page.evaluate(hoverMeasure, { id: it.id, frames: wantFrames, PROPS: SNAP_PROPS });
            const changed = []; if (restS) for (const k in m.end) if (m.end[k] !== restS[k]) changed.push(k + ': ' + String(restS[k]).slice(0, 40) + ' -> ' + String(m.end[k]).slice(0, 40));
            J.hover.push({ page: job.p.key, w: job.w, scene, id: it.id, sig: it.sig, kind: it.kind, anims: m.A, changed, settle: m.settle });
            await page.mouse.move(1, 1); await page.evaluate(settleAll); hovN++;
          }
        };
        run.seenSig = run.seenSig || new Set();
        if (HOVER_W.includes(job.w) && (!isProduct(job.p.key) || PROD_HOVER_W.includes(job.w))) {
          const list = await page.evaluate(listInteractive, {}); await doHover(list, 'page');
          /* extra scenes: burger (<=1199) or language menu (>=1200) */
          const scene = await page.evaluate(() => { const b = document.querySelector('.header__burger'); if (b && window.__C.vis(b)) { b.click(); return 'burger'; } const l = [...document.querySelectorAll('[data-lang-switch]')].find((x) => window.__C.vis(x)); if (l) { l.click(); return 'lang-menu'; } return null; });
          if (scene) {
            await new Promise((r) => setTimeout(r, 450)); await page.evaluate(settleAll);
            const sr = await page.evaluate(restCollect, { scope: scene === 'burger' ? '.header__panel' : '[data-lang-menu]' });
            for (const [p, v, s, c] of sr.entries) J.rest.push([p, v, s, c, job.p.key, job.w, scene]);
            for (const [s, v] of sr.comps) J.comps.push([s, v, job.p.key, job.w, scene]);
            const l2 = await page.evaluate(listInteractive, { scope: scene === 'burger' ? '.header__panel' : '[data-lang-menu]' });
            await doHover(l2, scene);
            await page.keyboard.press('Escape'); await page.evaluate(() => { const b = document.querySelector('.header__burger[aria-expanded="true"]'); if (b) b.click(); const l = document.querySelector('.lang-menu.is-open [data-lang-switch]'); if (l) l.click(); });
            await new Promise((r) => setTimeout(r, 300)); await page.evaluate(settleAll);
          }
          if (FOCUS) {
            await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); });
            await page.mouse.move(1, 1); let first = null;
            for (let k = 0; k < 400; k++) {
              await page.keyboard.press('Tab'); await page.evaluate(settleAll);
              const fi = await page.evaluate(focusInfo);
              if (!fi) { if (k > 3) break; continue; }
              const key = fi.id + fi.sig; if (first === key && k > 2) break; if (first === null) first = key;
              J.focus.push({ page: job.p.key, w: job.w, ...fi }); focN++;
            }
          }
        }
        clearTimeout(killer);
        J.perJob.push({ page: job.p.key, w: job.w, elements: rest.n, hover: hovN, focus: focN, ms: Date.now() - jt });
        fs.appendFileSync(PARTS, JSON.stringify(J) + '\n');
        await page.close(); done++; process.stderr.write(new Date().toTimeString().slice(0, 8) + ' [' + done + '/' + jobs.length + '] ' + job.p.key + '@' + job.w + ' el ' + rest.n + ' hov ' + hovN + ' foc ' + focN + ' ' + Math.round((Date.now() - jt) / 1000) + 's\n'); return;
      } catch (e) { try { await page.close(); } catch (x) {} process.stderr.write('attempt ' + attempt + ' failed ' + job.p.key + '@' + job.w + ': ' + String(e.message).slice(0, 120) + '\n'); if (attempt === 1) { RES.errors.push({ page: job.p.key, w: job.w, error: String(e.message || e).slice(0, 300) }); process.stderr.write('ERROR ' + job.p.key + '@' + job.w + ': ' + e.message + '\n'); } }
    }
  };
  const queue = [...jobs]; await Promise.all(Array.from({ length: WORKERS }, async () => { let b = await launch(); browsers.push(b); let k = 0; while (queue.length) { const jb = queue.shift(); try { await run(jb, b); } catch (e) { process.stderr.write('worker error ' + jb.p.key + '@' + jb.w + ': ' + e.message.slice(0, 100) + ' (requeued, relaunch)\n'); if (!jb.retried) { jb.retried = 1; queue.push(jb); } k = 24; } if (++k % 25 === 0) { try { await b.close(); } catch (e) {} b = await launch(); browsers.push(b); } } try { await b.close(); } catch (e) {} }));
  stop();
  for (const l of fs.readFileSync(PARTS, 'utf8').split('\n').filter(Boolean)) { const J = JSON.parse(l); const w = +J.key.split('@').pop(); if (J.tokens) RES.tokens[w] = RES.tokens[w] || J.tokens; RES.elements += J.elements; for (const k of ['rest', 'comps', 'skips', 'hover', 'focus', 'perJob']) for (const x of J[k]) RES[k].push(x); }
  RES.meta.seconds = Math.round((Date.now() - t0) / 1000); RES.meta.jobsDone = RES.perJob.length; RES.meta.jobsTotal = pages.length * WIDTHS.length;
  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(RES));
  console.log('census: ' + pages.length + ' pages x ' + WIDTHS.length + ' widths, ' + RES.elements + ' element-visits, ' + RES.hover.length + ' hovers, ' + RES.focus.length + ' focus stops, ' + RES.errors.length + ' errors, ' + RES.meta.seconds + ' s -> ' + path.join(OUT, 'census.json'));
  try { report(RES, OUT); console.log('tables -> ' + path.join(OUT, 'census-tables.md')); } catch (e) { console.log('(report step skipped: ' + e.message + ')'); }
})().catch((e) => { console.error(e); process.exit(2); });

/* ======================= aggregation + markdown tables ======================= */
function report(RES, OUT) {
  const W = RES.meta.widths;
  /* ---- token value sets per width ---- */
  const TS = {};
  for (const w of Object.keys(RES.tokens)) {
    const T = RES.tokens[w]; const s = { color: [], px: new Map(), space: new Set(), ms: new Map(), ease: new Map(), typeSize: new Set(), typeLh: new Set(), typeLs: new Set(), radius: new Set(), names: T };
    for (const [n, t] of Object.entries(T)) {
      if (t.color) s.color.push([n, t.color]);
      if (t.px !== undefined && !t.color) { const k = Math.round(t.px * 10) / 10; if (!s.px.has(k)) s.px.set(k, []); s.px.get(k).push(n); }
      if (/^--space-\d+$/.test(n) && t.px !== undefined) s.space.add(t.px);
      if (t.ms !== undefined) { if (!s.ms.has(t.ms)) s.ms.set(t.ms, []); s.ms.get(t.ms).push(n); }
      if (t.ease) { if (!s.ease.has(t.ease)) s.ease.set(t.ease, []); s.ease.get(t.ease).push(n); }
      if (/^--type-.*-size$/.test(n) && t.px !== undefined) s.typeSize.add(t.px);
      if (/^--type-.*-lh$/.test(n) && t.px !== undefined) s.typeLh.add(t.px);
      if (/^--type-.*-ls$/.test(n)) s.typeLs.add(t.em !== undefined ? t.em : 0);
      if (/^--radius-/.test(n)) s.radius.add(t.px !== undefined ? t.px + 'px' : t.raw);
    }
    TS[w] = s;
  }
  const parseC = (k) => { const m = /rgba?\(([^)]*)\)/.exec(k); if (!m) return null; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
  const near = (a, b) => Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2 && Math.abs(a[3] - b[3]) <= 0.02;
  const colorClass = (k, w) => { const c = parseC(k); if (!c) return 'n/a'; const tok = TS[w].color.filter(([n, t]) => near(t, c)).map(([n]) => n); const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    if (tok.length) return 'token ' + tok.slice(0, 3).join(' ') + (tok.length > 3 ? ' +' + (tok.length - 3) : '');
    if (c[0] <= 40 && c[1] <= 40 && c[2] <= 40) return 'BLACK (off palette)';
    if (mx >= 41 && mx <= 215 && mx - mn <= 16) return 'GREY (off palette)';
    if (c[3] < 1) return 'OFF PALETTE (alpha ' + c[3] + ')';
    return 'OFF PALETTE'; };
  const lenClass = (v, w, prop) => { const n = Math.abs(Math.round(parseFloat(v) * 10) / 10); if (!n) return 'zero'; const s = TS[w]; if (s.space.has(n)) return 'space'; const tk = s.px.get(n); if (tk) return 'token (non-space) ' + tk.slice(0, 3).join(' '); if (s.space.has(n + 1) || s.space.has(n - 1) || s.px.has(n + 1)) return 'derived (token -/+ 1px border)'; if (Math.abs(n) >= 100) return 'layout-derived (auto/centering/calc)'; return 'NO TOKEN'; };
  const classify = (prop, v, w) => {
    const s = TS[w];
    if (/^(color|background-color|border-color)$/.test(prop)) return colorClass(v, w);
    if (prop === 'font-size') return s.typeSize.has(parseFloat(v)) ? 'scale' : 'OFF SCALE';
    if (prop === 'line-height') return v === 'normal' ? 'OFF SCALE (normal)' : s.typeLh.has(parseFloat(v)) ? 'scale' : 'OFF SCALE';
    if (prop === 'letter-spacing') { const e = parseFloat(v); return [...s.typeLs].some((x) => Math.abs(x - e) < 0.003) ? 'scale' : 'OFF SCALE'; }
    if (prop === 'font-weight') return /^(400|500)$/.test(v) ? 'ok' : 'OFF (400/500 only)';
    if (prop === 'font-family') return /Asta Sans/.test(v) ? 'ok' : 'OFF (not Asta Sans)';
    if (prop === 'border-radius') { const parts = v.split(/\s+/); if (parts.every((p) => s.radius.has(p))) return parts.length > 1 && new Set(parts).size > 1 ? 'mixed tokens' : 'token'; if (v === '50%') return 'token'; return 'NO TOKEN'; }
    if (/^(padding-side|row-gap|column-gap|margin-side|sibling-gap)/.test(prop)) return lenClass(v, w, prop);
    if (prop === 'border-width') return /^1px (solid)$/.test(v) ? 'ok' : 'CHECK (>1px or not solid)';
    if (prop === 'box-shadow') return 'SHADOW (system has none)';
    if (prop === 'text-decoration') return /underline/.test(v) && !/inline-prose/.test(v) ? 'UNDERLINE OUTSIDE PROSE' : 'ok';
    if (prop === 'background-image') return 'GRADIENT';
    if (/^transition/.test(prop)) { const bad = []; for (const part of v.split(' | ')) { const m = /^(\S+) (\d+)ms(?: \+(\d+)ms)? (.+)$/.exec(part); if (!m) continue; if (!s.ms.has(+m[2])) bad.push('dur ' + m[2] + 'ms'); if (m[3] && !s.ms.has(+m[3])) bad.push('delay ' + m[3]); if (!s.ease.has(m[4]) && !/^(ease|linear)$/.test(m[4])) bad.push('ease ' + m[4]); else if (/^(ease|linear)$/.test(m[4])) bad.push('ease ' + m[4] + ' (keyword)'); } return bad.length ? 'NO TOKEN: ' + [...new Set(bad)].join(', ') : 'token'; }
    return '';
  };
  /* ---- aggregate rest entries: prop -> value -> {count, sigs:Map, pages:Set, widths:Set, cls:Set} ---- */
  const AG = new Map();
  const NOISE = (p, s, v) => (/(t-display|hero__title-part)[^>]*(span )?> span|span > span$/.test(s) && /^(margin-side|padding-side|transition)$/.test(p)) || (p === 'margin-side' && /header__panel|home-closing__body/.test(s) && parseFloat(v) > 100);
  RES.rest = RES.rest.filter(([p, v, s]) => !NOISE(p, s, v));
  for (const [p, v, s, c, page, w, scene] of RES.rest) {
    if (!AG.has(p)) AG.set(p, new Map()); const m = AG.get(p);
    if (!m.has(v)) m.set(v, { count: 0, sigs: new Map(), pages: new Set(), widths: new Set(), cls: new Map() }); const e = m.get(v);
    e.count += c; e.sigs.set(s, (e.sigs.get(s) || 0) + c); e.pages.add(page); e.widths.add(w); const k = classify(p, v, w); e.cls.set(k, (e.cls.get(k) || 0) + c);
  }
  const L = []; const out = (s) => L.push(s);
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const flag = (cl) => /NO TOKEN|OFF|GREY|BLACK|SHADOW|UNDERLINE OUTSIDE|GRADIENT|CHECK|mixed/.test(cl);
  const pagesShort = (set) => { const a = [...set]; const prod = a.filter((x) => /^products\/(?!category)/.test(x)); const rest = a.filter((x) => !prod.includes(x)); return (rest.length > 6 ? rest.slice(0, 6).join(', ') + ' +' + (rest.length - 6) : rest.join(', ')) + (prod.length ? (rest.length ? ', ' : '') + prod.length + ' product pages' : ''); };
  const summary = {};
  out('# Census tables (generated ' + new Date().toISOString() + ')\n');
  out('Pages: ' + RES.meta.pages.length + ' | widths: ' + W.join(', ') + ' | hover widths: ' + RES.meta.hoverWidths.join(', ') + ' | element visits (rest): ' + RES.elements + ' | hovers: ' + RES.hover.length + ' | focus stops: ' + RES.focus.length + ' | skipped hovers: ' + RES.skips.length + ' | errors: ' + RES.errors.length + ' | WebGL: ' + (RES.meta.webgl ? 'on' : 'off (--disable-3d-apis; posters)') + ' | run ' + RES.meta.seconds + ' s\n');
  if (RES.errors.length) { out('## Errors'); for (const e of RES.errors) out('- ' + e.page + '@' + e.w + ': ' + esc(e.error)); out(''); }
  const ORDER = ['color', 'background-color', 'border-color', 'border-width', 'outline(rest)', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'border-radius', 'padding-side', 'padding', 'row-gap', 'column-gap', 'margin-side', 'sibling-gap(block)', 'sibling-gap(flex-col)', 'box-shadow', 'background-image', 'text-decoration', 'a-in-text', 'transition', 'transition::before', 'transition::after', 'animation'];
  out('## 1. Unique values per property (rest + opened menus)\n');
  out('| property | unique values | element-count | flagged values | flagged element-count |'); out('|---|---|---|---|---|');
  for (const p of ORDER) { const m = AG.get(p); if (!m) continue; let fv = 0, fc = 0, tc = 0; for (const [v, e] of m) { tc += e.count; const f = [...e.cls.keys()].some(flag); if (f) { fv++; fc += [...e.cls.entries()].filter(([k]) => flag(k)).reduce((a, [, n]) => a + n, 0); } } summary[p] = { unique: m.size, count: tc, flaggedValues: fv, flaggedCount: fc }; out('| ' + p + ' | ' + m.size + ' | ' + tc + ' | ' + fv + ' | ' + fc + ' |'); }
  out('');
  for (const p of ORDER) {
    const m = AG.get(p); if (!m) continue;
    out('### ' + p + '\n'); out('| value | count | pages | widths | class | top selectors (count) |'); out('|---|---|---|---|---|---|');
    const rows = [...m.entries()].sort((a, b) => (flag([...b[1].cls.keys()].join()) - flag([...a[1].cls.keys()].join())) || b[1].count - a[1].count);
    const lim = p === 'padding' ? 60 : 400; let i = 0;
    for (const [v, e] of rows) { if (i++ >= lim) { out('| … ' + (rows.length - lim) + ' more | | | | | |'); break; } const sg = [...e.sigs.entries()].sort((a, b) => b[1] - a[1]); out('| `' + esc(v) + '` | ' + e.count + ' | ' + e.pages.size + ' | ' + [...e.widths].sort((a, b) => b - a).join('/') + ' | ' + esc([...e.cls.keys()].join('; ')) + ' | ' + esc(sg.slice(0, 6).map(([s, n]) => s + ' (' + n + ')').join('; ') + (sg.length > 6 ? '; +' + (sg.length - 6) + ' more' : '')) + ' |'); }
    out('');
  }
  /* ---- flagged detail: every flagged (prop, value, selector) with pages ---- */
  const FL = new Map();
  for (const [p, v, s, c, page, w, scene] of RES.rest) { const cl = classify(p, v, w); if (!flag(cl)) continue; const k = p + '\u0001' + v + '\u0001' + s; if (!FL.has(k)) FL.set(k, { p, v, s, cl, count: 0, pages: new Set(), widths: new Set() }); const e = FL.get(k); e.count += c; e.pages.add(page); e.widths.add(w); }
  out('## 2. Every flagged (property, value, selector)\n'); out('| property | value | selector | class | count | widths | pages |'); out('|---|---|---|---|---|---|---|');
  for (const e of [...FL.values()].sort((a, b) => a.p.localeCompare(b.p) || b.count - a.count)) out('| ' + e.p + ' | `' + esc(e.v) + '` | `' + esc(e.s) + '` | ' + esc(e.cl) + ' | ' + e.count + ' | ' + [...e.widths].sort((a, b) => b - a).join('/') + ' | ' + esc(pagesShort(e.pages)) + ' |');
  out('');
  /* ---- HOVER ---- */
  const tsig = (a) => a.p + ' ' + a.d + 'ms' + (a.dl ? ' +' + a.dl : '') + ' ' + a.e;
  const mainAnims = (h) => h.anims.filter((a) => a.t === 'self');
  out('## 3. Hover (real mouse, getAnimations)\n');
  const byKind = {}; for (const h of RES.hover) { const k = h.kind; byKind[k] = byKind[k] || new Map(); const ds = [...new Set(mainAnims(h).map((a) => a.d + 'ms ' + a.e + (a.dl ? ' +' + a.dl : '')))].sort().join(' & ') || '(no own animation)'; if (!byKind[k].has(ds)) byKind[k].set(ds, { n: 0, sigs: new Map(), pages: new Set() }); const e = byKind[k].get(ds); e.n++; e.sigs.set(h.sig, (e.sigs.get(h.sig) || 0) + 1); e.pages.add(h.page); }
  out('### 3a. Durations/easing of the element\'s OWN transitions (self + ::before/::after) by kind\n'); out('| kind | timing set | hovers | pages | selectors |'); out('|---|---|---|---|---|');
  for (const k of Object.keys(byKind)) for (const [ds, e] of [...byKind[k].entries()].sort((a, b) => b[1].n - a[1].n)) out('| ' + k + ' | ' + esc(ds) + ' | ' + e.n + ' | ' + e.pages.size + ' | ' + esc([...e.sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => s + ' (' + n + ')').join('; ')) + ' |');
  out('');
  /* all distinct timings over all animations triggered by hover */
  const allT = new Map(); for (const h of RES.hover) for (const a of h.anims) { const k = a.d + 'ms' + (a.dl ? ' +' + a.dl + 'ms' : '') + ' ' + a.e; if (!allT.has(k)) allT.set(k, { n: 0, props: new Map(), sigs: new Set() }); const e = allT.get(k); e.n++; e.props.set(a.p + (a.pe || ''), (e.props.get(a.p + (a.pe || '')) || 0) + 1); e.sigs.add(a.t === 'self' ? h.sig : a.t); }
  out('### 3b. Every distinct timing (duration +delay easing) of ANY animation started by a hover\n'); out('| timing | animations | properties | targets |'); out('|---|---|---|---|');
  for (const [k, e] of [...allT.entries()].sort((a, b) => b[1].n - a[1].n)) out('| ' + esc(k) + ' | ' + e.n + ' | ' + esc([...e.props.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => p + ' ' + n).join(', ')) + ' | ' + esc([...e.sigs].slice(0, 10).join('; ') + (e.sigs.size > 10 ? ' +' + (e.sigs.size - 10) : '')) + ' |');
  out('');
  /* mixed timings inside ONE hover (e.g. disc 800 + bg 250) */
  const mixed = new Map(); for (const h of RES.hover) { const ds = [...new Set(h.anims.filter((a) => !/transform|visibility|opacity/.test(a.p)).map((a) => a.d))]; if (ds.length > 1) { const k = h.sig + ' | ' + h.anims.filter((a) => !/transform|visibility|opacity/.test(a.p)).map((a) => (a.t === 'self' ? '' : a.t + ' ') + a.p + (a.pe || '') + ' ' + a.d).filter((x, i, arr) => arr.indexOf(x) === i).sort().join(', '); if (!mixed.has(k)) mixed.set(k, new Set()); mixed.get(k).add(h.page + '@' + h.w); } }
  out('### 3c. Hovers that run DIFFERENT durations on colour/fill/disc at once (desync)\n'); out('| element | animations | pages@widths |'); out('|---|---|---|');
  for (const [k, s] of mixed) { const [sg, an] = k.split(' | '); out('| `' + esc(sg) + '` | ' + esc(an) + ' | ' + s.size + ': ' + esc([...s].slice(0, 5).join(', ')) + ' |'); }
  out('');
  /* same selector, different timing on different pages/widths */
  const bySig = new Map(); for (const h of RES.hover) { const ds = h.anims.map(tsig).filter((x, i, a) => a.indexOf(x) === i).sort().join(', ') || '(none)'; if (!bySig.has(h.sig)) bySig.set(h.sig, new Map()); const m = bySig.get(h.sig); if (!m.has(ds)) m.set(ds, new Set()); m.get(ds).add(h.page + '@' + h.w + (h.scene !== 'page' ? '[' + h.scene + ']' : '')); }
  out('### 3d. Same selector, DIFFERENT hover timing set depending on page/width/scene\n'); out('| selector | variant | pages@widths |'); out('|---|---|---|');
  for (const [sg, m] of bySig) if (m.size > 1) for (const [ds, s] of m) out('| `' + esc(sg) + '` | ' + esc(ds.slice(0, 300)) + ' | ' + s.size + ': ' + esc([...s].slice(0, 6).join(', ')) + (s.size > 6 ? ' …' : '') + ' |');
  out('');
  /* no visible change on hover */
  const none = new Map(); for (const h of RES.hover) if (!h.changed.length && h.kind !== 'field') { if (!none.has(h.sig + '|' + h.kind)) none.set(h.sig + '|' + h.kind, new Set()); none.get(h.sig + '|' + h.kind).add(h.page + '@' + h.w); }
  out('### 3e. Interactive elements with NO computed change on hover (element, ::before/::after, first icon/round-btn)\n'); out('| selector | kind | pages@widths |'); out('|---|---|---|');
  for (const [k, s] of none) { const [sg, kd] = k.split('|'); out('| `' + esc(sg) + '` | ' + kd + ' | ' + s.size + ': ' + esc([...s].slice(0, 5).join(', ')) + ' |'); }
  out('');
  /* hover changes: underline / colour end states per selector */
  const ch = new Map(); for (const h of RES.hover) { const deco = h.changed.filter((c) => /textDecorationLine|backgroundColor|el\.color|scale/.test(c)).map((c) => c.replace(/^(el|::before|::after|kid\d(::before)?)\./, '$1 ')).join('; '); const k = h.sig + ' | ' + (deco || '-'); if (!ch.has(k)) ch.set(k, new Set()); ch.get(k).add(h.page + '@' + h.w); }
  out('### 3f. What changes on hover (decoration / fill / colour / disc) per selector\n'); out('| selector | changes | pages@widths |'); out('|---|---|---|');
  for (const [k, s] of [...ch.entries()].sort()) { const i = k.indexOf(' | '); out('| `' + esc(k.slice(0, i)) + '` | ' + esc(k.slice(i + 3).slice(0, 400)) + ' | ' + s.size + ' |'); }
  out('');
  /* frame-measured settle */
  const st = new Map(); for (const h of RES.hover) if (h.settle) { const k = h.sig; if (!st.has(k)) st.set(k, []); st.get(k).push([h.page, h.settle.settleMs, h.settle.firstMs, Math.max(0, ...h.anims.map((a) => a.d + a.dl))]); }
  out('### 3g. Frame-sampled real settle time at 1440 (time from pointer-over to last visual change; declared max = longest animation)\n'); out('| selector | page: settle ms (declared ms) |'); out('|---|---|');
  for (const [k, a] of st) out('| `' + esc(k) + '` | ' + a.map(([p, s, f, d]) => p + ': ' + s + ' (' + d + ')').join('; ') + ' |');
  out('');
  /* skips */
  const sk = new Map(); for (const [pg, w, s, why, sc] of RES.skips) { const k = s + ' | ' + why; sk.set(k, (sk.get(k) || 0) + 1); }
  out('### 3h. Hover candidates not measured (occluded / hidden / gone)\n'); out('| selector | reason | count |'); out('|---|---|---|'); for (const [k, n] of [...sk.entries()].sort((a, b) => b[1] - a[1])) { const [s, why] = k.split(' | '); out('| `' + esc(s) + '` | ' + why + ' | ' + n + ' |'); } out('');
  /* ---- FOCUS ---- */
  out('## 4. Focus-visible (real Tab walk)\n');
  const fo = new Map(); for (const f of RES.focus) { const k = f.outline + (f.fv ? '' : ' [NOT :focus-visible]') + (f.beforeScale === '1' ? ' + disc' : ''); if (!fo.has(k)) fo.set(k, { n: 0, sigs: new Map(), pages: new Set() }); const e = fo.get(k); e.n++; e.sigs.set(f.sig, (e.sigs.get(f.sig) || 0) + 1); e.pages.add(f.page); }
  out('| focus style | stops | pages | selectors |'); out('|---|---|---|---|');
  for (const [k, e] of [...fo.entries()].sort((a, b) => b[1].n - a[1].n)) out('| ' + esc(k) + ' | ' + e.n + ' | ' + e.pages.size + ' | ' + esc([...e.sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, n]) => s + ' (' + n + ')').join('; ')) + ' |');
  out('');
  const hid = RES.focus.filter((f) => !f.vis); if (hid.length) { out('Focus landed on INVISIBLE elements: ' + hid.length + ' stops: ' + [...new Set(hid.map((f) => f.sig))].slice(0, 15).join('; ') + '\n'); }
  /* ---- COMPONENT metrics ---- */
  out('## 5. Component metrics: same selector, different metrics at the SAME width (h* = content-driven height, informational)\n');
  const cm = new Map(); for (const [s, v, page, w, scene] of RES.comps) { const k = s + '|' + w; if (!cm.has(k)) cm.set(k, new Map()); const m = cm.get(k); const vv = v.replace(/ h=\d+\*/, ' h=*'); if (!m.has(vv)) m.set(vv, new Set()); m.get(vv).add(page); }
  out('| selector | width | variants (pages) |'); out('|---|---|---|');
  const compVar = []; for (const [k, m] of cm) if (m.size > 1) { const [s, w] = k.split('|'); compVar.push([s, w, m]); }
  compVar.sort((a, b) => a[0].localeCompare(b[0]) || b[1] - a[1]);
  for (const [s, w, m] of compVar) out('| `' + esc(s) + '` | ' + w + ' | ' + esc([...m.entries()].map(([v, p]) => v + ' [' + pagesShort(p) + ']').join(' ‖ ').slice(0, 1200)) + ' |');
  out('');
  /* ---- tokens resolved ---- */
  out('## 6. Token sets used for classification (resolved in the page)\n');
  for (const w of Object.keys(TS)) { const s = TS[w]; out('- **' + w + '**: space ' + [...s.space].sort((a, b) => a - b).join('/') + '; type sizes ' + [...s.typeSize].sort((a, b) => a - b).join('/') + '; lh ' + [...s.typeLh].sort((a, b) => a - b).join('/') + '; ls ' + [...s.typeLs].join('/') + 'em; radius ' + [...s.radius].join('/') + '; durations ' + [...s.ms.keys()].sort((a, b) => a - b).join('/') + 'ms; easings ' + [...s.ease.keys()].join(' / ') + '; colour tokens ' + s.color.length); }
  fs.writeFileSync(path.join(OUT, 'census-tables.md'), L.join('\n'));
  const agg = { summary, flagged: [...FL.values()].map((e) => ({ ...e, pages: [...e.pages], widths: [...e.widths] })), hoverKinds: Object.fromEntries(Object.entries(byKind).map(([k, m]) => [k, [...m.entries()].map(([ds, e]) => ({ ds, n: e.n, pages: e.pages.size, sigs: [...e.sigs.keys()] }))])), hoverTimings: [...allT.entries()].map(([k, e]) => ({ k, n: e.n, props: [...e.props.entries()], sigs: [...e.sigs] })), mixed: [...mixed.entries()].map(([k, s]) => ({ k, n: s.size, at: [...s] })), sigVariants: [...bySig.entries()].filter(([, m]) => m.size > 1).map(([sg, m]) => ({ sg, v: [...m.entries()].map(([d, s]) => ({ d, at: [...s] })) })), noChange: [...none.entries()].map(([k, s]) => ({ k, at: [...s] })), focus: [...fo.entries()].map(([k, e]) => ({ k, n: e.n, sigs: [...e.sigs.entries()] })), compVar: compVar.map(([s, w, m]) => ({ s, w, v: [...m.entries()].map(([v, p]) => ({ v, pages: [...p] })) })), settle: [...st.entries()] };
  fs.writeFileSync(path.join(OUT, 'census-agg.json'), JSON.stringify(agg, null, 1));
  return agg;
}

