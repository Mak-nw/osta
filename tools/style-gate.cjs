#!/usr/bin/env node
/* Style gate (customer: "мені потрібен гейт"; spec: content/audit/trust-audit.md, section B).
   Machine check of design-system rules on EVERY page at 1440 and 375 (headless Chrome via puppeteer-core, <= 3 workers):
   A1.3 icon-ring / contact rows, A2.1 component registry (tools/component-registry.json), A2.2 role duplicates (site level),
   A3.1 spacing, A3.2 raw px in CSS (source), A4 typography, A5.1 colours vs tokens, A5.2 gradient/shadow/border>1/dashed,
   B card surface (no border, surface token by parent), A6 illustrations (WebGL contexts, slots, source scan), A7 card rows,
   A8 motion (media opacity), A9 skip-link / horizontal scroll / hit target / contrast, H headings, E0 exceptions file.
   Exceptions ONLY via tools/style-gate.exceptions.json (entry without selector,rule,reason,approvedBy,approvedAt,quote,source = FAIL).
   Output: PASS/FAIL/WARN/EXEMPT table + tools/.last-style-gate.json. Exit code != 0 on any FAIL.
   Usage: node tools/style-gate.cjs [--dist <dir built with VITE_BASE=/>] [--url http://localhost:5173] [--pages all|a,b] [--widths 1440,375] [--workers 3] [--verbose] [--json file] [--force]
   Default: builds a snapshot into a temp dir (VITE_BASE=/) and serves it on 5193 with a tiny static server (so HMR edits of others never disturb it).
   Do NOT run together with hover-gate (CPU throttling of transitions): the script refuses unless --force. Chrome: $CHROME or the macOS default. */
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const ROOT = path.resolve(__dirname, '..');
const WIDTHS = String(opt('widths', '1440,375')).split(',').map(Number);
const WORKERS = Math.min(3, Math.max(1, Number(opt('workers', 3)) || 3));
const VERBOSE = !!opt('verbose', false);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const REG = readJSON(path.join(__dirname, 'component-registry.json'));
const EXC_RAW = readJSON(path.join(__dirname, 'style-gate.exceptions.json')).entries || [];
const RULES = { 'A1.3': 'icon-ring / contact', 'A2.1': 'registry', 'A2.2': 'role duplicates', 'A3.1': 'spacing', 'A3.2': 'raw px (src)', 'A4': 'typography', 'A5.1': 'colours', 'A5.2': 'lines/shadow/gradient', 'U1': 'light hero gradient', 'B': 'card surface', 'A6': 'illustrations', 'A7': 'card rows', 'A8': 'motion', 'A9.1': 'skip-link', 'A9.2': 'h-scroll', 'A9.3': 'hit-target', 'A9.4': 'contrast', 'H': 'headings', 'E0': 'exceptions' , 'A9.5': 'underlined CTA link'};
const RUNTIME_RULES = ['A1.3', 'A2.1', 'A3.1', 'A4', 'A5.1', 'A5.2', 'U1', 'B', 'A6', 'A7', 'A8', 'A9.1', 'A9.2', 'A9.3', 'A9.4', 'A9.5', 'H'];

/* ---------- exceptions: only fully signed entries count ---------- */
const REQ = ['selector', 'rule', 'reason', 'approvedBy', 'approvedAt', 'quote', 'source'];
const EXC = [], EXC_BAD = [];
for (const e of EXC_RAW) { const miss = REQ.filter((k) => !e[k] || !String(e[k]).trim()); if (!miss.length && !/^(customer|замовник)$/i.test(String(e.approvedBy).trim())) miss.push('approvedBy!=customer'); (miss.length ? EXC_BAD : EXC).push(miss.length ? { entry: e, missing: miss } : e); }

/* ---------- registry -> flat structures for the page ---------- */
function flattenRegistry() {
  const roots = {}, kinds = { button: [], card: [], chrome: [], link: [] };
  for (const [role, r] of Object.entries(REG.roles)) for (const [cls, c] of Object.entries(r.classes || {})) { roots[cls] = { role, kind: r.kind, modifiers: c.modifiers || [] }; (kinds[r.kind] = kinds[r.kind] || []).push(cls); }
  const art = (REG.roles['art-slot'] || {}).artClasses || [];
  return { roots, kinds, art, removed: (REG.removedClasses || {}).classes || [], deprecated: (REG.deprecatedClasses || {}).classes || [], ignore: (REG.ignoreCardLike || {}).selectors || [],
    mustAlso: (REG.roles['heading-group'] || {}).mustAlsoMatch || [], containers: REG.cardContainers || ['link-cards'], pending: Object.fromEntries(Object.entries(REG.roles).filter(([, r]) => r.pendingMerge).map(([k, r]) => [k, r.pendingMerge])),
    decorInLink: ((REG.roles['icon-ring'] || {}).decorInLink || {}).pendingDecision || [], animated: REG.animatedColorStates || [], sp: REG.spacing };
}

/* ---------- tokens.css: custom property names ---------- */
const TOKEN_NAMES = [...new Set([...fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))];

/* ---------- in-page checks (serialised; no closures over Node scope) ---------- */
function inpage(cfg) {
  const { C, EX, W } = cfg; const F = []; const seen = new Set();
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
  const cc = new Map();
  const rgba = (c) => { if (cc.has(c)) return cc.get(c); g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; const v = [d[0], d[1], d[2], +(d[3] / 255).toFixed(3)]; cc.set(c, v); return v; };
  const near = (a, b) => Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2 && Math.abs(a[3] - b[3]) <= 0.02;
  /* token colours (resolved by a probe: invalid var() inherits the sentinel colour) */
  const par = document.createElement('div'); par.style.color = 'rgb(1, 2, 3)'; const pr = document.createElement('span'); par.appendChild(pr); document.body.appendChild(par);
  const T = {}; for (const n of cfg.tokens) { pr.style.color = ''; pr.style.color = 'var(' + n + ')'; const v = getComputedStyle(pr).color; if (v !== 'rgb(1, 2, 3)') T[n] = rgba(v); }
  par.remove(); const TV = Object.values(T); TV.push([0, 0, 0, 0]);
  const isBlack = (c) => c[3] > 0.02 && c[0] <= 40 && c[1] <= 40 && c[2] <= 40;   /* A5.1: the site has NO black (customer 2026-11-13): deep navy --c-blue-950 instead */
  const isGrey = (c) => { if (c[3] <= 0.02) return false; const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]); return mx >= 41 && mx <= 215 && mx - mn <= 16; };   /* A5.1: the site has NO grey either (customer 2026-11-13: --text-muted / --c-grey-* removed): text/background must be blue (accent tones) or white; light mist surfaces (max > 215) are allowed */
  const isTok = (c) => TV.some((t) => near(t, c));
  const px = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const cls = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '').trim().split(/\s+/).filter(Boolean);
  const sig = (el) => { if (!el) return '?'; const c = cls(el).filter((x) => !/^is-/.test(x)).slice(0, 3); const s = el.tagName.toLowerCase() + (c.length ? '.' + c.join('.') : ''); if (c.length) return s; const p = el.parentElement; return (p ? sig0(p) + ' > ' : '') + s; };
  const sig0 = (el) => { const c = cls(el).filter((x) => !/^is-/.test(x)).slice(0, 2); return el.tagName.toLowerCase() + (c.length ? '.' + c.join('.') : ''); };
  const vis = (el) => { try { return el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }); } catch (e) { return true; } };
  const report = (rule, level, msg, el, value) => {
    const k = rule + '|' + level + '|' + sig(el) + '|' + msg; if (seen.has(k)) return; seen.add(k);
    let ex = null; for (const e of EX) { if (e.rule !== rule) continue; if (el && e.selector && (() => { try { return el.matches(e.selector); } catch (x) { return false; } })() && (e.value === undefined || (value !== undefined && Math.abs(value - e.value) <= 1))) { ex = e.selector; break; } }
    F.push({ rule, level: ex ? 'EXEMPT' : level, sel: sig(el), msg, ex });
  };
  const rootOf = (c) => { let best = null; for (const r in C.roots) if ((c === r || c.startsWith(r + '__') || c.startsWith(r + '--')) && (!best || r.length > best.length)) best = r; return best; };
  const hasKind = (el, kinds) => cls(el).some((c) => { const r = rootOf(c); return r && kinds.includes(C.roots[r].kind); });
  const CLICK = 'a[href],button,[role=button],[role=option],[role=tab],summary,input[type=submit]';
  const rectOf = (el) => el.getBoundingClientRect();
  const alpha4 = (cs, side) => parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none' && rgba(cs['border' + side + 'Color'])[3] > 0.02;
  const border4 = (cs) => ['Top', 'Right', 'Bottom', 'Left'].every((s) => alpha4(cs, s));
  const borderAny = (cs) => ['Top', 'Right', 'Bottom', 'Left'].some((s) => alpha4(cs, s));
  const hasContent = (el) => !!el.querySelector('img,picture,h1,h2,h3,h4,p,video,canvas');
  const LIGHT_HERO_EL = (el) => el.matches('.hero:not(.hero--home), .legal__hero, .product-hero:not(.product-hero--bg)');
  const LIGHT_GRAD = (() => { const t = document.createElement('div'); t.style.backgroundImage = 'var(--hero-light-gradient)'; document.body.append(t); const v = getComputedStyle(t).backgroundImage; t.remove(); return v; })(); /* computed token value; must be linear-gradient(white 0%, --surface 100%) */
  const LIGHT_GRAD_OK = /^linear-gradient\((to bottom, |180deg, )?rgb\(255, 255, 255\)( 0%)?, rgb\([^)]*\)( 100%)?\)$/.test(LIGHT_GRAD) && (LIGHT_GRAD.match(/rgb\(([^)]*)\)/g) || [])[1] === 'rgb(' + (T['--surface'] || [0, 0, 0]).slice(0, 3).join(', ') + ')';
  const memo = new Map();
  const effBg = (el) => { /* composite opaque background behind el's content; null = photo/unknown */
    if (!el || el === document.documentElement) { const b = rgba(getComputedStyle(document.body).backgroundColor); return b[3] > 0.5 ? b : (T['--surface'] || [232, 238, 238, 1]); }
    if (memo.has(el)) return memo.get(el);
    const cs = getComputedStyle(el); let res;
    if (cs.backgroundImage !== 'none') { if (/gradient/.test(cs.backgroundImage) && el.closest('.hero--home')) res = T['--surface-accent'] || [10, 55, 130, 1]; else if (cs.backgroundImage === LIGHT_GRAD && LIGHT_HERO_EL(el)) res = T['--surface'] || [232, 238, 238, 1]; else res = null; }
    else if ([...el.children].some((c) => c.tagName === 'IMG' && getComputedStyle(c).position === 'absolute')) res = null;
    else { const b = rgba(cs.backgroundColor); if (b[3] >= 0.98) res = b; else if (b[3] <= 0.01) res = effBg(el.parentElement); else { const u = effBg(el.parentElement); res = u ? [0, 1, 2].map((i) => Math.round(b[i] * b[3] + u[i] * (1 - b[3]))).concat([1]) : null; } }
    memo.set(el, res); return res;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
  const root = document.documentElement; const rcs = getComputedStyle(root);
  const typeSizes = new Set(['--type-display-size', '--type-h1-size', '--type-h2-size', '--type-h3-size', '--type-lead-size', '--type-body-size', '--type-label-size'].map((n) => px(rcs.getPropertyValue(n))).filter(Boolean));
  const typeLH = new Set(['display', 'h1', 'h2', 'h3', 'lead', 'body', 'label'].map((n) => px(rcs.getPropertyValue('--type-' + n + '-lh'))).filter(Boolean));
  const els = [...document.body.querySelectorAll('*')].filter((e) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(e.tagName));
  const inSvg = (el) => !!el.closest('svg') && el.tagName.toLowerCase() !== 'svg';
  const stats = { elements: els.length, tokens: Object.keys(T).length };
  const present = {};

  /* ===== per-element loop ===== */
  const cardEls = [];
  const rootSel = Object.keys(C.roots).filter((r) => C.roots[r].kind === 'card' && !C.containers.includes(r)).map((r) => '.' + r).join(',');
  for (const el of els) {
    const cs = getComputedStyle(el); const isSvgChild = inSvg(el);
    if (cs.display === 'none') continue;
    const cl = cls(el);
    /* --- A2.1 registry: removed / deprecated / modifiers / unknown candidate classes --- */
    for (const c of cl) {
      if (C.removed.includes(c)) report('A2.1', 'FAIL', 'removed class .' + c + ' is back', el);
      if (C.deprecated.includes(c) && !el.closest('.ds-page')) report('A2.1', 'WARN', 'deprecated class .' + c + ' (no longer used by the design system)', el);
      const r = rootOf(c); if (r) { for (const grp in C.pending) if (C.pending[grp].includes(c) || C.pending[grp].includes(r)) { (present[grp] = present[grp] || new Set()).add(C.pending[grp].includes(c) ? c : r); } }
      if (c.includes('--') && !c.includes('__') && r && r !== c && c.startsWith(r + '--') && !C.roots[r].modifiers.includes(c)) report('A2.1', 'FAIL', 'unregistered modifier .' + c + ' (allowed for .' + r + ': ' + (C.roots[r].modifiers.join(', ') || 'none') + ')', el);
      if (/(^|-)(card|btn)(__|--|$)/.test(c) && !/^(is-|ds-)/.test(c) && !rootOf(c) && !el.closest('.ds-page')) report('A2.1', 'FAIL', 'class .' + c + ' looks like a card/button component but is NOT in component-registry.json (role already covered? one role = one class)', el);
      if (/__art$/.test(c) && !C.art.includes(c)) report('A2.1', 'FAIL', 'new illustration slot class .' + c + ' (registry has ' + C.art.length + ' art slots, one expected)', el);
    }
    for (const m of C.mustAlso) { try { if (el.matches(m.selector) && !el.matches(m.requires) && el.querySelector('h1,h2,h3,h4')) report('A2.1', 'FAIL', 'local wrapper ' + sig0(el) + ' without ' + m.requires + ': ' + m.note, el); } catch (e) {} }
    if (isSvgChild) { /* svg parts: colours + dash only */
      if (!vis(el.closest('svg'))) continue;
      const tag = el.tagName.toLowerCase();
      if (/^(path|circle|rect|line|polyline|polygon|ellipse|text|use)$/.test(tag)) {
        if (cs.strokeDasharray && cs.strokeDasharray !== 'none' && cs.stroke !== 'none') report('A5.2', 'FAIL', 'stroke-dasharray ' + cs.strokeDasharray + ' (dashed illustration lines are forbidden)', el);
        for (const p of ['fill', 'stroke']) { const v = cs[p]; if (!v || v === 'none' || /url\(/.test(v)) continue; const c = rgba(v); if (c[3] > 0.02 && !isTok(c)) report('A5.1', 'FAIL', p + ' ' + v + ' is not a token colour', el); }
      }
      continue;
    }
    if (!vis(el) && el.tagName !== 'BODY') continue;
    let r = rectOf(el);
    /* --- A5.1 colours --- */
    if (directText(el) && isBlack(rgba(cs.color))) report('A5.1', 'FAIL', 'black text ' + cs.color + ' (use --text = deep navy)', el);
    if (directText(el) && isGrey(rgba(cs.color))) report('A5.1', 'FAIL', 'grey text ' + cs.color + ' (labels/subtitles = --text #061f52; headings/names = --text-accent #0a3782; descriptions = --text)', el);
    if (isGrey(rgba(cs.backgroundColor))) report('A5.1', 'FAIL', 'grey background ' + cs.backgroundColor, el);
    if (isBlack(rgba(cs.backgroundColor))) report('A5.1', 'FAIL', 'black background ' + cs.backgroundColor, el);
    if (directText(el)) { const c = rgba(cs.color); if (c[3] > 0.02 && !isTok(c) && !(C.animated.some((q) => { try { return el.matches(q); } catch (e) { return false; } }) && ['--c-white', '--text-on-accent', '--accent-contrast'].some((n) => T[n] && [0, 1, 2].every((i) => Math.abs(T[n][i] - c[i]) <= 2)))) report('A5.1', 'FAIL', 'text colour ' + cs.color + ' is not a token colour', el); }
    const bg = rgba(cs.backgroundColor); if (bg[3] > 0.02 && !isTok(bg)) report('A5.1', 'FAIL', 'background ' + cs.backgroundColor + ' is not a token colour', el);
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (alpha4(cs, s)) { const c = rgba(cs['border' + s + 'Color']); if (!isTok(c)) report('A5.1', 'FAIL', 'border-' + s.toLowerCase() + ' colour ' + cs['border' + s + 'Color'] + ' is not a token colour', el); }
    /* --- U1 light hero: vertical gradient, top pure white (--surface-white), bottom = --surface; on the hero element or its ::before (rule U1) --- */
    if (LIGHT_HERO_EL(el)) { const host = [cs, getComputedStyle(el, '::before')]; if (!LIGHT_GRAD_OK || !host.some((h) => h.backgroundImage === LIGHT_GRAD)) report('U1', 'FAIL', 'light hero has no --hero-light-gradient (white top > --surface bottom): ' + cs.backgroundImage, el); }
    /* --- A5.2 gradient / shadow / thick / dashed (element + pseudos) --- */
    const targets = [[el, cs, '']]; for (const ps of ['::before', '::after']) { const pc = getComputedStyle(el, ps); if (pc.content !== 'none' && pc.content !== 'normal') targets.push([el, pc, ps]); }
    for (const [, s, ps] of targets) {
      if (/gradient/.test(s.backgroundImage) && !(LIGHT_HERO_EL(el) && s.backgroundImage === LIGHT_GRAD)) report('A5.2', 'FAIL', 'gradient background' + ps + ' (only .hero--home and the light-hero token --hero-light-gradient may have one)', el);
      if (s.boxShadow && s.boxShadow !== 'none') report('A5.2', 'FAIL', 'box-shadow' + ps + ' (shadows are forbidden)', el);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) { const w = parseFloat(s['border' + side + 'Width']), st = s['border' + side + 'Style']; if (w > 0 && st !== 'none') { if (w > 1.01) report('A5.2', 'FAIL', 'border-' + side.toLowerCase() + ' ' + w + 'px' + ps + ' (> 1px)', el); if (st === 'dashed' || st === 'dotted') report('A5.2', 'FAIL', 'border-' + side.toLowerCase() + ' ' + st + ps, el); } }
    }
    /* --- A4 typography --- */
    if (directText(el) && !el.closest('.ds-page')) {
      const fs = px(cs.fontSize), fw = +cs.fontWeight, lh = cs.lineHeight === 'normal' ? 0 : px(cs.lineHeight);
      if (!typeSizes.has(fs)) report('A4', 'FAIL', 'font-size ' + fs + 'px is not on the scale (' + [...typeSizes].sort((a, b) => a - b).join('/') + ' at this width)', el);
      if (fw !== 400 && fw !== 500) report('A4', 'WARN', 'font-weight ' + fw + ' (allowed 400/500)', el);
      if (lh && !typeLH.has(lh) && Math.abs(lh - fs) > 0.5) report('A4', 'WARN', 'line-height ' + lh + 'px is not a token pair (' + [...typeLH].sort((a, b) => a - b).join('/') + ')', el);
    }
    /* --- A9.4 contrast (text on solid backgrounds only) --- */
    if (directText(el) && !el.closest('.ds-page') && !el.matches(':disabled,[disabled],.is-disabled,[aria-disabled=true]')) {
      let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op = Math.min(op, +getComputedStyle(n).opacity);
      if (op >= 0.99) { const fg = rgba(cs.color), back = effBg(el); if (back && fg[3] > 0.05) { const f = [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + back[i] * (1 - fg[3]))); const big = px(cs.fontSize) >= 24 || (px(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700); const need = big ? 3 : 4.5; const cr = contrast(f, back); if (cr < need) report('A9.4', 'FAIL', 'text contrast ' + cr.toFixed(2) + ':1 < ' + need + ':1 (' + cs.color + ' on rgb(' + back.slice(0, 3).join(',') + '))', el); } }
    }
    /* --- A9.3 hit target --- */
    if (el.matches(CLICK + ',input:not([type=hidden]),select,textarea') && r.width > 0) {
      const inline = cs.display === 'inline' && el.closest('p,li,span,dd,td'); const sr = /sr-only|visually-hidden|skip/.test(cl.join(' '));
      if (!inline && !sr && !el.closest('.ds-page')) { let ew = r.width, eh = r.height; for (const ps of ['::after', '::before']) { const pc = getComputedStyle(el, ps); if (pc.content !== 'none' && pc.position === 'absolute') { const t = px(pc.top), b = px(pc.bottom), l = px(pc.left), rr = px(pc.right); if (t < 0 || b < 0) eh += Math.max(0, -t) + Math.max(0, -b); if (l < 0 || rr < 0) ew += Math.max(0, -l) + Math.max(0, -rr); } } r = { width: ew, height: eh }; const m = Math.min(r.width, r.height);
        if (m < 24) report('A9.3', el.closest('footer,.footer') ? 'WARN' : 'FAIL', 'hit target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' < 24x24 (WCAG 2.5.8)', el);
        else if (W <= 767 && (r.width < 43.5 || r.height < 43.5)) report('A9.3', 'WARN', 'hit target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' < 44x44 (touch)', el); }
    }
    /* --- A2.1 appearance: card-like / button-like must carry a registry class of that kind --- */
    const ign = C.ignore.some((s) => { try { return el.matches(s); } catch (e) { return false; } });
    if (!ign && !/^(HTML|BODY|MAIN|SECTION|HEADER|FOOTER|NAV|INPUT|SELECT|TEXTAREA|IMG|VIDEO|CANVAS|SVG|TR|TD|TABLE|LI|UL|OL|FORM)$/i.test(el.tagName) && !el.closest('.ds-page')) {
      const filled = bg[3] > 0.05; const pseudoFilled = !filled && ['::before', '::after'].some((ps) => { const pc = getComputedStyle(el, ps); return pc.content !== 'none' && pc.position === 'absolute' && rgba(pc.backgroundColor)[3] > 0.05 && px(pc.width) + px(pc.height) > 0 && pc.inset !== 'auto'; });
      const rad = /%/.test(cs.borderTopLeftRadius) ? 0 : px(cs.borderTopLeftRadius);
      const clickable = el.matches(CLICK);
      if (clickable && !hasContent(el) && r.height >= 20) {
        const pill = rad >= r.height / 2 - 1 && (filled || borderAny(cs));
        if ((filled || border4(cs) || pill) && !hasKind(el, ['button', 'link', 'chrome']) && !el.closest('.footer__menu,.legal__toc')) report('A2.1', 'FAIL', 'button-like element has no registry button class (classes: ' + (cl.join(' ') || 'none') + ')', el);
      } else if (!clickable || hasContent(el)) {
        if (r.width >= 120 && r.height >= 72 && rad >= 4 && (filled || border4(cs) || pseudoFilled) && !hasKind(el, ['card', 'chrome'])) report('A2.1', 'FAIL', 'card-like surface (' + Math.round(r.width) + 'x' + Math.round(r.height) + ') has no registry card class (classes: ' + (cl.join(' ') || 'none') + ')', el);
      }
    }
    if (rootSel && el.matches(rootSel)) cardEls.push(el);
  }
  for (const grp in present) present[grp] = [...present[grp]];

  /* ===== B: card surface (no border, token by parent surface) ===== */
  const surfaceBelow = (el) => effBg(el.parentElement);
  const T_ = (n) => T[n] || [0, 0, 0, 0];
  for (const el of cardEls) {
    if (!vis(el)) continue; const r = rectOf(el); if (r.width < 60 || r.height < 40) continue; const cs = getComputedStyle(el);
    if (borderAny(cs)) report('B', 'FAIL', 'card has a border (' + ['Top', 'Right', 'Bottom', 'Left'].filter((s) => alpha4(cs, s)).map((s) => cs['border' + s + 'Width']).join('/') + '); design-system: border 0 everywhere', el);
    let own = rgba(cs.backgroundColor);
    if (own[3] < 0.02) for (const ps of ['::before', '::after']) { const pc = getComputedStyle(el, ps); if (pc.content !== 'none' && pc.position === 'absolute' && rgba(pc.backgroundColor)[3] > 0.02) { own = rgba(pc.backgroundColor); break; } }
    const under = surfaceBelow(el); if (!under) continue; /* photo below: n/a */
    const blue = near(under, T_('--surface-accent')) || near(under, T_('--surface-accent-deep')) || near(under, T_('--surface-card-on-accent')) || (under[2] - under[0] > 60 && lum(under) < 0.2);
    let exp, expN; if (blue) { exp = [T_('--surface-card-on-accent')]; expN = '--surface-card-on-accent'; } else if (near(under, T_('--surface-raised'))) { exp = [T_('--surface-white')]; expN = '--surface-white'; } else if (near(under, T_('--surface-white'))) { exp = [T_('--surface-white'), T_('--surface-raised')]; expN = '--surface-white/--surface-raised'; } else { exp = [T_('--surface-raised')]; expN = '--surface-raised'; }
    if (own[3] < 0.02) report('B', 'FAIL', 'card has no fill (transparent); expected ' + expN, el);
    else if (!exp.some((e) => near(e, own))) report('B', 'FAIL', 'card fill rgb(' + own.slice(0, 3).join(',') + ') != ' + expN + ' for parent surface rgb(' + under.slice(0, 3).join(',') + ')', el);
  }

  /* ===== A7: rows of same-class cards: height, title top, text bottom (+-1 px) ===== */
  { const groups = new Map(); for (const el of cardEls) { if (!vis(el)) continue; const r = rectOf(el); if (r.width < 60) continue; const k = (el.parentElement ? sig0(el.parentElement) : '') + '>' + cls(el).filter((x) => rootOf(x) === x)[0]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ el, r }); }
    for (const [k, arr] of groups) { if (arr.length < 2) continue; const rows = []; for (const a of arr) { const row = rows.find((x) => Math.abs(x[0].r.top - a.r.top) <= 2); row ? row.push(a) : rows.push([a]); }
      for (const row of rows) { if (row.length < 2) continue; const m = row.map((a) => { const t = a.el.querySelector('h2,h3,h4,.t-h2,.t-h3'); const art = a.el.querySelector(':scope [class*="__art"], :scope [class*="__media"], :scope [data-scene]'); let txt = null; if (t) { txt = t; while (txt.parentElement && txt.parentElement !== a.el) txt = txt.parentElement; } const ps = [...a.el.querySelectorAll('p')].filter(vis); const p = ps[ps.length - 1]; return { art: art && vis(art) ? rectOf(art).height : null, txt: txt && txt !== a.el ? rectOf(txt).height : null, b: p ? rectOf(p).bottom : null, gap: t && p ? rectOf(p).top - rectOf(t).bottom : null }; });
        const spread = (key) => { const v = m.map((x) => x[key]).filter((x) => x !== null); return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0; };
        const hasArt = m.every((x) => x.art !== null); if (!hasArt) continue; /* customer rule: only rows with an art slot (art div + text div) */
        const sa = spread('art'), sx = spread('txt');
        if (sa > 1.01) report('A7', 'FAIL', 'row of ' + row.length + ' (' + k + '): art zones differ in height by ' + sa.toFixed(1) + 'px', row[0].el, sa);
        if (sx > 1.01) report('A7', 'FAIL', 'row of ' + row.length + ' (' + k + '): text blocks differ in height by ' + sx.toFixed(1) + 'px', row[0].el, sx);
        /* customer 2026-11-19, questions/answers.json#4e0687 ('Опис під заголовком'): the description sits DIRECTLY under the title (NOT pinned to the bottom edge, so bottoms are not compared any more);
           A7 now requires the title -> description gap to be one value in the row, and for .svc-card = --svc-card-text-gap (22) */
        const sg = spread('gap'); if (sg > 1.01) report('A7', 'FAIL', 'row of ' + row.length + ' (' + k + '): title -> description gap differs by ' + sg.toFixed(1) + 'px; description must sit directly under the title (answers.json#4e0687)', row[0].el, sg);
        if (row[0].el.matches('.svc-card')) { const want = px(getComputedStyle(document.documentElement).getPropertyValue('--svc-card-text-gap')); for (const x of m) if (x.gap !== null && Math.abs(x.gap - want) > 1.01) { report('A7', 'FAIL', 'svc-card title -> description gap ' + x.gap.toFixed(1) + 'px != --svc-card-text-gap ' + want + ' (answers.json#4e0687)', row[0].el, x.gap); break; } } } } }

  /* ===== A3.1 spacing ===== */
  const gapsOf = (box) => { const kids = [...box.children].filter((k) => vis(k) && getComputedStyle(k).position !== 'absolute' && rectOf(k).height > 0); const out = []; for (let i = 1; i < kids.length; i++) out.push([kids[i - 1], kids[i], rectOf(kids[i]).top - rectOf(kids[i - 1]).bottom]); return out; };
  const tol = C.sp.tolerance + 0.01;
  for (const sh of document.querySelectorAll('.section-head')) { if (!vis(sh)) continue; if (/row/.test(getComputedStyle(sh).flexDirection) && getComputedStyle(sh).display === 'flex') continue;
    const lgCard = sh.closest('.card--pad-lg'); const shTok = px(getComputedStyle(document.documentElement).getPropertyValue('--section-head-gap')) || C.sp.sectionHeadGap; const shExp = lgCard ? Math.min(shTok, px(getComputedStyle(lgCard).paddingLeft) * 0.72) : shTok; /* inside a large card the heading-group gap is min(24, 0.72 x card padding) (customer 7ed12b 2026-11-14, same 0.72P rule as below) */
    const ctaGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-cta-gap')) || shExp; /* last text -> CTA = --text-cta-gap (45 / 32, customer 2026-11-14), not in cards */
    for (const [, b, gap] of gapsOf(sh)) { const exp = (!lgCard && b.matches('.btn, .home-closing__actions')) ? ctaGap : shExp; if (Math.abs(gap - exp) > tol && !(lgCard && gap < exp)) report('A3.1', 'FAIL', '.section-head gap ' + gap.toFixed(1) + 'px != ' + exp.toFixed(1) + ' (before ' + sig0(b) + ')', sh, gap); } }
  for (const b of document.querySelectorAll('.text-card__body')) { if (!vis(b)) continue; const sh = b.querySelector(':scope > .section-head');
    for (const [, n, gap] of gapsOf(b)) if (Math.abs(gap - C.sp.textCardGap) > tol) report('A3.1', 'FAIL', '.text-card__body gap ' + gap.toFixed(1) + 'px != ' + C.sp.textCardGap + ' (before ' + sig0(n) + ')', b, gap); }
  for (const f of document.querySelectorAll('.field, form label')) { const lab = f.matches('label') ? f : f.querySelector('label,.field__label'); const ctl = f.matches('label') ? f.parentElement.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea,.select-wrap') : f.querySelector('input:not([type=hidden]),select,textarea,.select-wrap'); if (!lab || !ctl || !vis(lab) || !vis(ctl)) continue; const a = rectOf(lab), b = rectOf(ctl); if (b.top < a.bottom - 1 || b.left > a.right) continue; const gap = b.top - a.bottom; if (Math.abs(gap - C.sp.labelToField) > tol) report('A3.1', 'FAIL', 'label -> field gap ' + gap.toFixed(1) + 'px != ' + C.sp.labelToField, f, gap); }
  /* A3.1 large card: every inner gap <= 0.72 x card padding (customer 2026-11-14: padding 45, max inner gap ~0.7 x padding) */
  for (const cd of document.querySelectorAll('.card--pad-lg')) { if (!vis(cd)) continue; const lim = px(getComputedStyle(cd).paddingLeft) * 0.72;
    for (const e of [cd, ...cd.querySelectorAll('*')]) { if (e !== cd && !vis(e)) continue; const cs = getComputedStyle(e); if (!/flex|grid/.test(cs.display)) continue; for (const g of [px(cs.rowGap), px(cs.columnGap)]) if (g > lim + 0.5) report('A3.1', 'FAIL', 'inner gap ' + g + 'px > 0.72 x card padding (' + lim.toFixed(1) + ')', e, g); }
    const kids = [...cd.children].filter(vis); for (let i = 1; i < kids.length; i++) { const d = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom; if (d > lim + 0.5) report('A3.1', 'FAIL', 'gap between blocks in the card ' + d.toFixed(1) + 'px > 0.72 x padding (' + lim.toFixed(1) + ')', kids[i], d); } }
  if (W <= 1199) { for (const gr of document.querySelectorAll('.footer__group')) { if (!vis(gr)) continue; const cs = getComputedStyle(gr); const rg = px(cs.rowGap); if (Math.abs(rg - C.sp.footerItems) > tol) report('A3.1', 'FAIL', 'footer group row-gap ' + rg + 'px != ' + C.sp.footerItems, gr, rg); const lab = gr.querySelector(':scope > .footer__label'); if (lab) { const tot = rg + px(getComputedStyle(lab).marginBottom); if (Math.abs(tot - C.sp.footerLabel) > tol) report('A3.1', 'FAIL', 'footer label -> first item ' + tot + 'px != ' + C.sp.footerLabel, lab, tot); } } }

  /* A3.1 grid/card gaps: ONE token each (customer 2026-11-13: column gap 12 = --grid-gap, art<->text 12 = --card-inner-gap) */
  { const rs = getComputedStyle(document.documentElement); const gg = px(rs.getPropertyValue('--grid-gap')), cg = px(rs.getPropertyValue('--card-inner-gap'));
    if (Math.abs(gg - 12) > tol) report('A3.1', 'FAIL', '--grid-gap ' + gg + 'px != 12', document.documentElement, gg);
    if (Math.abs(cg - 12) > tol) report('A3.1', 'FAIL', '--card-inner-gap ' + cg + 'px != 12', document.documentElement, cg);
    for (const g of document.querySelectorAll('.grid, .grid-3, .grid-4, .layout-2col, .layout-split, .layout-catalog, .layout-info, .svc-cards, .how-split, .footer__grid, .people-card, .quality-cards, .feature-grid, .home-grid, .product-hero__inner, .product-info')) { if (!vis(g)) continue; const cs = getComputedStyle(g); if (cs.display !== 'grid') continue; const c = px(cs.columnGap); if (Math.abs(c - gg) > tol) report('A3.1', 'FAIL', 'grid column-gap ' + c + 'px != --grid-gap ' + gg, g, c); }
    for (const t of document.querySelectorAll('.svc-card__text')) { if (!vis(t)) continue; const p = px(getComputedStyle(t).paddingTop); if (Math.abs(p - cg) > tol) report('A3.1', 'FAIL', 'svc-card art<->text ' + p + 'px != --card-inner-gap ' + cg, t, p); }
    for (const t of document.querySelectorAll('.quality-card, .link-cards--3 .link-card')) { if (!vis(t)) continue; const r = px(getComputedStyle(t).rowGap); if (Math.abs(r - cg) > tol) report('A3.1', 'FAIL', 'card art<->text row-gap ' + r + 'px != --card-inner-gap ' + cg, t, r); } }

  /* ===== H headings ===== */
  { const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]; const h1 = hs.filter((h) => h.tagName === 'H1');
    if (h1.length !== 1) report('H', 'FAIL', h1.length + ' <h1> on the page (exactly one required)', h1[0] || document.body);
    let prev = 0; for (const h of hs) { const l = +h.tagName[1]; if (prev && l > prev + 1) report('H', 'FAIL', 'heading level skipped: h' + prev + ' -> h' + l + ' ("' + h.textContent.trim().slice(0, 30) + '")', h); if (!prev && l !== 1) report('H', 'WARN', 'first heading is h' + l + ', not h1', h); prev = l; }
    const o = h1[0]; if (o && !o.closest('.section-head,.hero__head,.hero__content,.hero,.hero-search,.legal__hero,.product-hero,.contact-split__title,.about-intro')) report('A2.1', 'WARN', 'h1 is not inside a .section-head heading group (' + sig(o.parentElement) + ')', o); }

  /* ===== A1.3 icon-ring ===== */
  for (const ring of document.querySelectorAll('.icon-ring')) { if (!vis(ring)) continue; const clk = ring.closest('a[href],button,[role=button]'); const act = ring.classList.contains('icon-ring--action');
    if (clk && !act) { if (C.decorInLink.some((s) => clk.matches(s))) report('A1.3', 'WARN', 'decor .icon-ring inside whole-card link ' + sig0(clk) + ': customer decision pending (trust-audit A.1)', ring); else report('A1.3', 'FAIL', 'clickable ancestor ' + sig0(clk) + ' but .icon-ring has no --action', ring); }
    if (!clk && act) report('A1.3', 'FAIL', '.icon-ring--action without a clickable ancestor', ring); }
  for (const row of document.querySelectorAll('.footer__contact,.contact-person__link,.contact-line')) { if (!vis(row)) continue; const ring = row.querySelector('.icon-ring'); const txt = (row.textContent + ' ' + (row.getAttribute('aria-label') || '')).toLowerCase();
    if (ring && !ring.classList.contains('icon-ring--action')) report('A1.3', 'FAIL', 'contact row icon is not the filled .icon-ring--action', row);
    if (/fax/.test(txt) && row.querySelector('use[href$="#phone"]')) report('A1.3', 'FAIL', 'fax row uses the PHONE icon' + (row.matches('a[href^="tel:"]') ? ' and a tel: link' : '') + ' (needs its own icon or a non-link row)', row); }

  /* ===== A9.1 skip-link ===== */
  { const foc = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].slice(0, 6); const ok = foc.some((a) => a.matches('a[href^="#"]') && a.getAttribute('href').length > 1 && document.querySelector(a.getAttribute('href'))); if (!ok) report('A9.1', 'FAIL', 'no skip-link (<a href="#main"> as one of the first focusable elements, target must exist)', document.body); }
  /* ===== A9.5 underlined text link (customer 2026-11-13: underlined links exist only inline in FAQ/legal prose and in the footer; every CTA = button component) ===== */
  for (const a of document.querySelectorAll('a')) { if (a.closest('footer, .footer') || !vis(a)) continue; if (!getComputedStyle(a).textDecorationLine.includes('underline')) continue; if (a.matches(':not([class])') && a.parentElement && a.parentElement.matches('p, li, dd, td')) continue; report('A9.5', 'FAIL', 'underlined CTA link; use the button component', a); }
  /* ===== A9.2 horizontal scroll ===== */
  { const de = document.documentElement; if (de.scrollWidth > de.clientWidth) { const off = els.filter((e) => { const r = rectOf(e); return r.width > 0 && r.right > de.clientWidth + 1 && vis(e); }).slice(0, 3).map(sig0).join(', '); report('A9.2', 'FAIL', 'horizontal scroll: scrollWidth ' + de.scrollWidth + ' > clientWidth ' + de.clientWidth + (off ? ' (overflowing: ' + off + ')' : ''), document.body); } }
  /* ===== A6 slots ===== */
  for (const s of document.querySelectorAll('[data-scene]')) { const r = rectOf(s); if (r.width < 2 || r.height < 2) { if (vis(s) || cfg.vh) report('A6', 'WARN', 'data-scene slot has zero size (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')', s); } else if (!s.matches('canvas') && !s.querySelector('canvas,svg,img')) report('A6', 'WARN', 'data-scene slot has no canvas/svg/img (scene did not start)', s); }
  return { findings: F, present, stats };
}

/* ---------- motion phase (before reveal is forced): media opacity along the ancestor chain ---------- */
function motionPhase() {
  const out = []; const sig = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  for (const m of document.querySelectorAll('img,video')) {
    const r = m.getBoundingClientRect(); if (r.width < 120 || r.height < 60) continue; const cs0 = getComputedStyle(m); if (cs0.display === 'none') continue;
    let op = 1, who = ''; for (let n = m; n && n.nodeType === 1; n = n.parentElement) { const o = +getComputedStyle(n).opacity; if (o < op) { op = o; who = sig(n); } }
    const rv = m.closest('[data-reveal]');
    if (op < 0.99) out.push({ msg: 'media opacity ' + op.toFixed(2) + ' (by ' + who + '): photos/media are never faded in', sel: sig(m) });
    else if (rv) out.push({ msg: 'media inside [data-reveal] (' + sig(rv) + '): no opacity/transform reveal on photos', sel: sig(m), level: 'WARN' });
  }
  return { motion: out, gl: window.__glCount ? window.__glCount() : 0 };
}

/* ---------- source scans (once per run) ---------- */
function sourceScan() {
  const rows = []; const src = path.join(ROOT, 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(src); const js = files.filter((f) => f.endsWith('.js'));
  /* reachable JS from html entries + main.js */
  const entries = new Set(); const htmls = [...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, f)), ...files.filter((f) => f.endsWith('.html'))];
  for (const h of htmls) for (const m of fs.readFileSync(h, 'utf8').matchAll(/<script[^>]+src="([^"]+)"/g)) { const p = path.join(ROOT, m[1].replace(/^\//, '')); if (fs.existsSync(p)) entries.add(p); }
  const reach = new Set(); const q = [...entries];
  while (q.length) { const f = q.pop(); if (reach.has(f) || !fs.existsSync(f)) continue; reach.add(f); const t = fs.readFileSync(f, 'utf8'); for (const m of t.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) { let s = m[1]; if (!/^[./]/.test(s)) continue; let p = s.startsWith('/') ? path.join(ROOT, s) : path.resolve(path.dirname(f), s); if (!/\.[a-z]+$/.test(p)) p += '.js'; if (p.endsWith('.js') && fs.existsSync(p)) q.push(p); } }
  const rel = (f) => path.relative(ROOT, f); const allowedR = REG.allowedStandaloneRenderers || [];
  const pat = [['A6', /dashed\s*[:=]\s*(true|!0)|LineDashedMaterial|dashSize|computeLineDistances|setLineDash|stroke-dasharray/, 'dashed illustration lines in scene/JS source'], ['A6', /LineSegments2|LineMaterial|\bLine2\b|examples\/jsm\/lines|\bfat\b/, 'fat lines (LineSegments2/LineMaterial): IL1 requires native 1 device px LineSegments']];
  for (const f of reach) { const t = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); for (const [rule, re, msg] of pat) { const m = t.match(re); if (m) rows.push({ rule, level: 'FAIL', sel: rel(f), msg: msg + ' (`' + m[0] + '`)' }); }
    if (!/utils\/il-scene\.js$/.test(f) && !allowedR.some((x) => rel(f) === x) && /new\s+WebGLRenderer|getContext\(\s*['"]webgl/.test(t)) rows.push({ rule: 'A6', level: 'FAIL', sel: rel(f), msg: 'NEW own WebGL renderer outside src/utils/il-scene.js and registry allowedStandaloneRenderers' }); }
  for (const f of js) if (!reach.has(f) && !/main\.js$/.test(f)) rows.push({ rule: 'A6', level: 'WARN', sel: rel(f), msg: 'dead JS module (not imported from any page)' });
  /* raw px in CSS (A3.2): outside tokens.css, @media, comments; not 0/1px; not in custom property definitions */
  for (const f of files.filter((x) => x.endsWith('.css') && !/tokens\.css$|design-system-page\.css$/.test(x))) {
    const t = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')); const st = []; const hits = []; let ln = 0;
    for (const l of t.split('\n')) { ln++; const isM = /@media|@supports|@container/.test(l); const opens = (l.match(/\{/g) || []).length, closes = (l.match(/\}/g) || []).length; const inMedia = isM || st.includes('m');
      for (let k = 0; k < opens; k++) st.push(isM && k === 0 ? 'm' : 'b');
      if (!inMedia) for (const d of l.matchAll(/(^|[;{\s])(?!--)([a-z-]+)\s*:\s*([^;{}]*)/g)) { if (/^(stroke-width)$/.test(d[2])) continue; const v = d[3].replace(/var\([^)]*\)/g, ''); for (const p of v.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)) { if (+p[1] <= 1) continue; hits.push(ln + ': ' + d[2] + ': ' + d[3].trim().slice(0, 50)); break; } }
      for (let k = 0; k < closes; k++) st.pop(); }
    if (hits.length) rows.push({ rule: 'A3.2', level: 'WARN', sel: rel(f), msg: hits.length + ' raw px declaration(s) outside tokens/@media: ' + hits.slice(0, 4).join(' | ') + (hits.length > 4 ? ' ...' : '') });
  }
  return rows;
}

/* ---------- static server (snapshot) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };
function serve(dir, port) {
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]); let p = path.join(dir, u);
    if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { const nf = path.join(dir, '404.html'); res.writeHead(404, { 'content-type': MIME['.html'] }); return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

function discoverPages(dir) {
  const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'assets') walk(p); } else if (e.name.endsWith('.html')) out.push(p); } }; walk(dir);
  return out.map((f) => { const rel = path.relative(dir, f).split(path.sep).join('/'); const key = rel === 'index.html' ? 'index' : rel.replace(/\/index\.html$/, '').replace(/\.html$/, ''); return { key, url: rel.endsWith('index.html') ? '/' + rel.replace(/index\.html$/, '') : '/' + rel }; }).sort((a, b) => a.key.localeCompare(b.key));
}

(async () => {
  const mine = String(process.pid); let others = ''; try { others = cp.execSync("pgrep -f '^node .*(hover-gate|style-gate)[.]cjs' || true", { encoding: 'utf8' }).split('\n').filter((x) => x && x !== mine && x !== String(process.ppid)).join(','); } catch (e) {}
  if (others && !opt('force', false)) { console.error('Another hover-gate/style-gate is running (pid ' + others + '). Gates must not run in parallel (CPU throttles transitions). Re-run later or pass --force.'); process.exit(2); }
  const t0 = Date.now(); let base, stop = () => {}, distDir = null;
  if (opt('url', null)) base = String(opt('url')).replace(/\/$/, '');
  else {
    distDir = opt('dist', null) ? path.resolve(String(opt('dist'))) : path.join(os.tmpdir(), 'osta-style-gate-' + process.pid);
    if (!opt('dist', null)) { process.stderr.write('building snapshot (VITE_BASE=/) ... '); cp.execSync('npx vite build --outDir ' + JSON.stringify(distDir) + ' --emptyOutDir', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_BASE: '/' } }); process.stderr.write('done\n'); }
    const srv = await serve(distDir, 5193); base = 'http://localhost:5193'; stop = () => { srv.close(); if (!opt('dist', null)) try { fs.rmSync(distDir, { recursive: true, force: true }); } catch (e) {} };
  }
  /* pages */
  let pages = distDir ? discoverPages(distDir) : discoverPages(path.join(ROOT, 'dist'));
  pages = pages.filter((p) => !/^(product|design-system)$/.test(p.key));
  const sel = opt('pages', null);
  if (sel === 'all') {} else if (sel && sel !== true) { const ss = String(sel).split(','); pages = pages.filter((p) => ss.some((s) => p.key === s || p.key.includes(s))); }
  else pages = pages.filter((p) => !/^(de\/)?products\/(?!category)/.test(p.key) || /products\/(anastrozole|copovidone-va64)$/.test(p.key));
  if (!pages.length) { console.error('no pages'); stop(); process.exit(2); }
  const C = flattenRegistry();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars'] });
  const jobs = []; for (const p of pages) for (const w of WIDTHS) jobs.push({ p, w }); const rows = []; const presentAll = {}; let done = 0;
  const run = async (job) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: job.w, height: 900, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument(() => { const gl = new Set(); const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/i.test(t)) gl.add(this); return o.call(this, t, ...a); }; window.__glCount = () => [...gl].filter((c) => c.isConnected || true).length; });
        let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
        await page.goto(base + job.p.url, { waitUntil: 'load', timeout: 45000 });
        await page.evaluate(() => document.fonts.ready);
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < h + 600; y += 500) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await new Promise((r) => setTimeout(r, 90)); }
        await new Promise((r) => setTimeout(r, 900));
        const mo = await page.evaluate(motionPhase);
        /* deterministic geometry/colour pass: reload under prefers-reduced-motion, wait for fonts, 2 rAF and finished CSS animations */
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.reload({ waitUntil: 'load', timeout: 45000 }); navs = 1;
        await page.evaluate(() => document.fonts.ready);
        for (let y = 0; y < h + 600; y += 500) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await new Promise((r) => setTimeout(r, 60)); }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => new Promise((res) => { const t0 = performance.now(); const tick = () => requestAnimationFrame(() => requestAnimationFrame(() => { const act = document.getAnimations().filter((a) => { try { const e = a.effect.getComputedTiming().endTime; return isFinite(e) && a.playState === 'running'; } catch (x) { return false; } }); if (!act.length || performance.now() - t0 > 3500) res(); else setTimeout(tick, 100); })); tick(); }));
        await page.addStyleTag({ content: '[data-reveal]{opacity:1!important;transform:none!important;transition:none!important}' });
        await new Promise((r) => setTimeout(r, 200));
        const ex = EXC.filter((e) => (!e.pages || e.pages.includes(job.p.key)) && (!e.widths || e.widths.includes(job.w)));
        const res = await page.evaluate(inpage, { C, EX: ex, W: job.w, tokens: TOKEN_NAMES, vh: 900 });
        if (navs > 1) throw new Error('page reloaded during measurement (HMR?)');
        const F = res.findings;
        for (const m of mo.motion) F.push({ rule: 'A8', level: m.level || 'FAIL', sel: m.sel, msg: m.msg });
        if (mo.gl > 4) F.push({ rule: 'A6', level: 'FAIL', sel: 'page', msg: mo.gl + ' WebGL contexts on the page (max 4)' });
        for (const g in res.present) (presentAll[g] = presentAll[g] || {})[job.p.key + '@' + job.w] = res.present[g];
        rows.push({ page: job.p.key, width: job.w, findings: F, gl: mo.gl, stats: res.stats });
        await page.close(); done++; if (VERBOSE) process.stderr.write('[' + done + '/' + jobs.length + '] ' + job.p.key + '@' + job.w + ' ' + F.length + ' findings\n'); return;
      } catch (e) { try { await page.close(); } catch (x) {} if (attempt === 2) { rows.push({ page: job.p.key, width: job.w, error: String(e.message || e).slice(0, 200), findings: [] }); process.stderr.write('ERROR ' + job.p.key + '@' + job.w + ': ' + e.message + '\n'); } }
    }
  };
  const queue = [...jobs]; await Promise.all(Array.from({ length: WORKERS }, async () => { while (queue.length) await run(queue.shift()); }));
  await browser.close(); stop();

  /* ---------- aggregate ---------- */
  rows.sort((a, b) => a.page.localeCompare(b.page) || b.width - a.width);
  const cells = {}; const cellOf = (pg, w, r) => (cells[pg] = cells[pg] || {})[w + '|' + r];
  const detail = []; /* {rule,level,page,width,sel,msg,ex} */
  for (const r of rows) for (const f of r.findings) detail.push({ ...f, page: r.page, width: r.width });
  const site = []; /* source + site-level + meta rows */
  for (const x of sourceScan()) site.push(x);
  for (const grp in presentAll) { const union = new Set(Object.values(presentAll[grp]).flat()); if (union.size > 1) site.push({ rule: 'A2.2', level: 'WARN', sel: grp, msg: 'role "' + grp + '" is implemented by ' + union.size + ' classes (' + [...union].join(', ') + '); registry target = ONE class (merge)' }); }
  for (const b of EXC_BAD) site.push({ rule: 'E0', level: 'FAIL', sel: b.entry.selector || '(no selector)', msg: 'exception entry for rule ' + (b.entry.rule || '?') + ' is NOT signed: missing ' + b.missing.join(', ') + ' (entry ignored)' });
  try { for (const e of readJSON(path.join(__dirname, 'hover-gate.allowlist.json')).entries || []) { const miss = ['approvedBy', 'approvedAt', 'quote', 'source'].filter((k) => !e[k]); if (miss.length) site.push({ rule: 'E0', level: 'FAIL', sel: e.selector, msg: 'hover-gate.allowlist.json entry unsigned (missing ' + miss.join(', ') + '); reason: "' + String(e.reason).slice(0, 80) + '" -> needs a customer answer (questions form)' }); } } catch (e) {}
  const status = (pg, w, rule) => { const fs_ = detail.filter((d) => d.page === pg && d.width === w && d.rule === rule); if (fs_.some((d) => d.level === 'FAIL')) return 'FAIL'; if (fs_.some((d) => d.level === 'WARN')) return 'WARN'; if (fs_.some((d) => d.level === 'EXEMPT')) return 'EXEMPT'; return 'PASS'; };
  const L = { PASS: 'P', FAIL: 'F', WARN: 'W', EXEMPT: 'E', ERR: 'X' };
  const errPages = new Set(rows.filter((r) => r.error).map((r) => r.page + '@' + r.width));
  /* table */
  const cols = RUNTIME_RULES; const pad = (s, n) => String(s).padEnd(n);
  const lines = []; lines.push('STYLE GATE  ' + new Date().toISOString() + '   pages ' + pages.length + ' x widths ' + WIDTHS.join('/') + '   (cell: one letter per width in this order ' + WIDTHS.join('/') + '; P=PASS F=FAIL W=WARN E=EXEMPT X=error)');
  lines.push(pad('page', 34) + cols.map((c) => pad(c, 5)).join(''));
  for (const p of pages) lines.push(pad(p.key, 34) + cols.map((r) => pad(WIDTHS.map((w) => errPages.has(p.key + '@' + w) ? L.ERR : L[status(p.key, w, r)]).join(''), 5)).join(''));
  const totals = {}; for (const p of pages) for (const w of WIDTHS) for (const r of cols) { const s = errPages.has(p.key + '@' + w) ? 'ERR' : status(p.key, w, r); totals[s] = (totals[s] || 0) + 1; }
  const siteFail = site.filter((s) => s.level === 'FAIL').length, siteWarn = site.filter((s) => s.level === 'WARN').length;
  lines.push(''); lines.push('cells: ' + Object.entries(totals).map(([k, v]) => k + ' ' + v).join(', ') + ' | source/site rows: FAIL ' + siteFail + ', WARN ' + siteWarn);
  console.log(lines.join('\n'));
  /* details grouped: rule -> (level, sel, msg) -> pages */
  const grp = new Map(); for (const d of [...detail.filter((d) => d.level !== 'EXEMPT'), ...site.map((s) => ({ ...s, page: '(site)', width: 0 }))]) { const k = d.rule + '|' + d.level + '|' + d.sel + '|' + (d.rule === 'A9.3' || d.rule === 'A7' ? d.msg.replace(/\d+(\.\d+)?/g, '#') : d.msg); if (!grp.has(k)) grp.set(k, { ...d, pages: new Set() }); grp.get(k).pages.add(d.page + (d.width ? '@' + d.width : '')); }
  const order = Object.keys(RULES); const list = [...grp.values()].sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule) || (a.level === 'FAIL' ? -1 : 1) - (b.level === 'FAIL' ? -1 : 1));
  console.log('\nFINDINGS (rule | level | element | what | pages):');
  const perRule = {}; for (const d of list) { perRule[d.rule + d.level] = (perRule[d.rule + d.level] || 0) + 1; if (!VERBOSE && perRule[d.rule + d.level] > (d.level === 'FAIL' ? 14 : 5)) continue; const ps = [...d.pages]; console.log(d.rule + ' | ' + d.level + ' | ' + d.sel + ' | ' + d.msg + ' | ' + (ps.length > 4 ? ps.slice(0, 4).join(', ') + ' (+' + (ps.length - 4) + ')' : ps.join(', '))); }
  for (const k in perRule) { const lim = k.endsWith('FAIL') ? 14 : 5; if (!VERBOSE && perRule[k] > lim) console.log('... ' + k + ': +' + (perRule[k] - lim) + ' more (see tools/.last-style-gate.json or --verbose)'); }
  const exAll = detail.filter((d) => d.level === 'EXEMPT'); const exUsed = new Map(); for (const d of exAll) exUsed.set(d.rule + ' ' + d.ex, (exUsed.get(d.rule + ' ' + d.ex) || 0) + 1);
  console.log('\nACTIVE EXCEPTIONS (' + EXC.length + ' signed, ' + EXC_BAD.length + ' invalid):'); for (const e of EXC) console.log('  ' + e.rule + ' ' + e.selector + ' (' + e.approvedBy + ' ' + e.approvedAt + ', ' + e.source + '): used on ' + (exUsed.get(e.rule + ' ' + e.selector) || 0) + ' element(s)');
  const nFail = list.filter((d) => d.level === 'FAIL').length + rows.filter((r) => r.error).length; const nWarn = list.filter((d) => d.level === 'WARN').length;
  const out = { generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), base, widths: WIDTHS, rules: RULES, summary: { cells: totals, distinctFail: nFail, distinctWarn: nWarn }, exceptions: { active: EXC, invalid: EXC_BAD }, errors: rows.filter((r) => r.error).map((r) => ({ page: r.page, width: r.width, error: r.error })), site, rows: rows.map((r) => ({ page: r.page, width: r.width, gl: r.gl, stats: r.stats, findings: r.findings })) };
  fs.writeFileSync(opt('json', null) && opt('json') !== true ? String(opt('json')) : path.join(__dirname, '.last-style-gate.json'), JSON.stringify(out, null, 1));
  console.log('\nRESULT: ' + (nFail ? 'FAIL' : 'PASS') + ' (' + nFail + ' distinct FAIL findings, ' + nWarn + ' WARN) in ' + out.seconds + ' s; report tools/.last-style-gate.json');
  process.exit(nFail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
