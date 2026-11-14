#!/usr/bin/env node
/* Hover gate (customer rule 2026-11-13): EVERY button-like element must have the "disc from the centre" hover.
   Crawls all HTML pages at 1440 and 375 (desktop dropdown / burger menu opened as separate scenes), finds every clickable
   element, classifies it and checks it with a REAL mouse hover. Exit code != 0 on any FAIL.
   Usage: node tools/hover-gate.cjs [--url http://localhost:5173] [--pages index,about] [--widths 1440,375] [--inventory out.json] [--all] [--verbose]
   Without --url it builds a snapshot to a temp dir and serves it with `vite preview` on 5192 (stopped by PID, temp dir removed). Chrome: $CHROME or the standard macOS path. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const ROOT = path.resolve(__dirname, '..');
const PAGES = [['index', '/index.html'], ['about', '/about.html'], ['services', '/services.html'], ['catalog', '/catalog.html'],
  ['product', '/products/anastrozole/'], ['hub', '/products/category/api/'], ['contact', '/contact.html'], ['privacy', '/privacy.html'], ['terms', '/terms.html'],
  ['data-processing', '/data-processing.html'], ['faq', '/faq.html'], ['impressum', '/impressum.html'], ['404', '/404.html'], ['design-system', '/design-system.html']];
const WIDTHS = String(opt('widths', '1440,375')).split(',').map(Number);
const ONLY = opt('pages', null) && String(opt('pages')).split(',');
const DWELL = 950; // > --dur-hover-disc (800ms)
const allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'hover-gate.allowlist.json'), 'utf8')).entries;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* ---------- in-page helpers (serialized) ---------- */
function pageFns() {
  const toRGB = (c) => { const x = document.createElement('canvas'); x.width = x.height = 1; const g = x.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const BTN_CLASS = /(^|\s)(btn|btn--|round-btn|icon-ring--action|chip|nav-pill|lang-switch|lang-menu__option|filter-item|header__burger|pagination|page-btn|tab)[\w-]*/;
  const sig = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '');
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } return true; };
  const classify = (el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const bg = toRGB(s.backgroundColor); const bw = ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s['border' + k + 'Width']) > 0 && toRGB(s['border' + k + 'Color'])[3] > 0.02);
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)(is-hover|is-focus|is-pressed|is-disabled)(\s|$)/.test(typeof el.className === 'string' ? el.className : '') && el.closest('.ds-page')) return 'demo';
    if (el.matches(':disabled,[aria-disabled=true]')) return 'demo';
    if (el.querySelector('img,picture,h1,h2,h3,h4,p,video,canvas') || (r.width * r.height > 40000 && !/(^|\s)btn/.test(typeof el.className === 'string' ? el.className : ''))) return 'card';
    if (el.matches('[class*="btn"],[class*="round-btn"]') || BTN_CLASS.test(cls) || bg[3] > 0.02 || bw || el.querySelector('.round-btn,.icon-ring--action')) return 'button';
    return 'link';
  };
  /* duration/delay (ms) of one transitioned property from computed style (lists are comma separated, cycled by property index) */
  const timing = (s, prop) => { const ms = (v) => parseFloat(v) * (/ms\s*$/.test(v) ? 1 : 1000); const P = s.transitionProperty.split(',').map((x) => x.trim()), D = s.transitionDuration.split(','), L = s.transitionDelay.split(','); let i = P.indexOf(prop); if (i < 0) i = P.indexOf('all'); if (i < 0) return null; return { dur: Math.round(ms(D[i % D.length].trim())), delay: Math.round(ms(L[i % L.length].trim())), prop: P[i] }; };
  const tokens = () => { const cs = getComputedStyle(document.documentElement); const ms = (v) => { v = v.trim(); return Math.round(parseFloat(v) * (/ms$/.test(v) ? 1 : 1000)); }; return { cdur: ms(cs.getPropertyValue('--dur-hover-color')), cdelays: ['--delay-hover-color-in', '--delay-hover-color-round-in'].map((n) => ms(cs.getPropertyValue(n))), k: parseFloat(cs.getPropertyValue('--disc-overscan')) }; };
  const token = () => { const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-hover-disc').trim(); return Math.round(parseFloat(v) * (/ms$/.test(v) ? 1 : 1000)); };
  return { toRGB, sig, visible, classify, timing, token, tokens };
}
const fnSrc = pageFns.toString();

/* Default: a STATIC snapshot (vite build into a temp dir + vite preview), so HMR reloads caused by other people editing files never disturb the hover measurements. --url uses a running dev server instead. */
async function startServer() {
  const os = require('os'); const out = path.join(os.tmpdir(), 'osta-gate-dist-' + process.pid); const port = 5192;
  cp.execSync(`npx vite build --outDir ${JSON.stringify(out)} --emptyOutDir`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_BASE: '/' } }); // vite.config.js takes the production base from siteUrl unless VITE_BASE is set
  const p = cp.spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--outDir', out], { cwd: ROOT, stdio: 'ignore', detached: false, env: { ...process.env, VITE_BASE: '/' } });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:' + port + '/'); if (r.ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 500)); }
  return { url: 'http://localhost:' + port, stop: () => { try { process.kill(p.pid); } catch (e) {} try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) {} } };
}
const lab = (rgb) => { const f = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }; const [r, g, b] = rgb.map(f); const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883; const t = (v) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))]; };
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

/* LANG SEQUENCE (customer 2026-11-14): menu opens on the ACTIVE language WITHOUT a disc (opening gate), then hover on the other language = disc, then RETURN to the active one = the SAME disc (time to full cover within +-10% of the other option). FAIL if the return to the active option plays no disc. burger = the options are always visible (no opening step). */
async function testLangSequence(page, key, burger) {
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
  const sample = (sel) => page.evaluate((s) => { window.__s = []; const e = document.querySelector(s); const t0 = performance.now(); const f = () => { const c = getComputedStyle(e, '::before'); window.__s.push([performance.now() - t0, c.scale === 'none' ? 1 : parseFloat(c.scale)]); if (performance.now() - t0 < 1500) requestAnimationFrame(f); }; f(); }, sel);
  const reach = () => page.evaluate(() => { const a = window.__s; const t = a.find((v) => v[1] >= 0.99); const st = a.find((v) => v[1] > 0.02); return { full: t ? Math.round(t[0] - (st ? st[0] : 0)) : null, max: Math.max(...a.map((v) => v[1])) }; });
  const rest = '.header .lang-menu__option[aria-selected="true"]', other = '.header .lang-menu__option:not([aria-selected="true"])';
  const row = { page: key.page, w: key.w, scene: burger ? 'burger-menu' : 'lang-dropdown', el: '.lang-menu__option (active: open -> other -> return)', kind: 'button', text: 'seq', checks: {}, info: {} };
  try {
    await page.mouse.move(1, 1); await new Promise((r) => setTimeout(r, 600));
    if (!burger) { const t = await rect('.header [data-lang-switch]'); await page.mouse.move(t.x, t.y, { steps: 3 }); await new Promise((r) => setTimeout(r, 700)); }
    const open = await page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s), '::before'); return c.scale === 'none' ? 1 : parseFloat(c.scale); }, rest);
    row.checks.openNoDisc = open < 0.05; /* burger has no opening step, the pointer is still outside */
    const o = await rect(other), a = await rect(rest);
    await sample(other); await page.mouse.move(o.x, o.y, { steps: 2 }); await new Promise((r) => setTimeout(r, 1700)); const ro = await reach();
    await page.mouse.move(1, 1); /* leave and re-enter the menu to re-open it */
    if (!burger) { const t = await rect('.header [data-lang-switch]'); await page.mouse.move(t.x, t.y, { steps: 3 }); await new Promise((r) => setTimeout(r, 700)); await page.mouse.move(o.x, o.y, { steps: 2 }); await new Promise((r) => setTimeout(r, 900)); }
    else { await new Promise((r) => setTimeout(r, 900)); await page.mouse.move(o.x, o.y, { steps: 2 }); await new Promise((r) => setTimeout(r, 900)); }
    await sample(rest); await page.mouse.move(a.x, a.y, { steps: 2 }); await new Promise((r) => setTimeout(r, 1700)); const ra = await reach();
    row.checks.returnDisc = ra.max >= 0.99 && ra.full !== null; row.checks.sameTime = ro.full !== null && ra.full !== null && Math.abs(ra.full - ro.full) <= Math.max(ro.full * 0.1, 40);
    row.info = { open, otherMs: ro.full, activeMs: ra.full }; if (opt('verbose', false)) console.error('LANGSEQ ' + key.w + ' open=' + open + ' otherMs=' + ro.full + ' activeMs=' + ra.full);
  } catch (e) { row.checks.error = false; row.note = String(e.message).slice(0, 80); }
  row.status = Object.values(row.checks).every(Boolean) ? 'PASS' : 'FAIL'; return row;
}

/* collect clickable elements of a scope; returns descriptors (index into the matching list) */
const COLLECT = (scope) => `(() => { const F = (${fnSrc})(); const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; if (!root) return [];
  const els = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')];
  return els.map((el, i) => F.visible(el) ? { i, sig: F.sig(el), kind: F.classify(el), state: el.matches('.is-hover,.is-pressed,.is-focus:not(.lang-menu__option),.is-disabled,[disabled],[aria-disabled=true]'), text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40), parent: F.sig(el.parentElement), ctx: (el.closest('section,footer,header,main,.hero,[class*=closing]') || document.body).className } : null).filter(Boolean); })()`;

/* measure state of the i-th element: colours, pseudo scale, rect */
const MEASURE = (scope, i) => `(() => { const F = (${fnSrc})(); const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
  const els = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')]; const el = els[${i}];
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const cand = [el, ...el.querySelectorAll('.round-btn,.icon-ring--action,[class*="btn"]')];
  const sc = (n) => { const s = getComputedStyle(n, '::before'); if (s.content === 'none' || s.content === 'normal' || s.display === 'none') return null; const v = s.scale === 'none' ? 1 : parseFloat(s.scale); const m = /matrix\\(([^,]+)/.exec(s.transform); return { scale: v, tf: m ? parseFloat(m[1]) : 1, bg: F.toRGB(s.backgroundColor), dur: F.timing(s, 'scale'), own: F.timing(getComputedStyle(n), 'color'), D: parseFloat(s.width) || 0, ease: s.transitionTimingFunction, rad: parseFloat(getComputedStyle(n).borderTopLeftRadius) || 0, bw: parseFloat(getComputedStyle(n).borderTopWidth) || 0 }; };
  const r = (n) => { const cr = n.getClientRects(); const b = cr.length > 1 && getComputedStyle(n).display === 'inline' ? cr[0] : n.getBoundingClientRect(); /* wrapped inline link: hover its first line box, not the empty centre of the union box */ return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const s = getComputedStyle(el); const cs = getComputedStyle(el);
  return { rect: r(el), color: F.toRGB(s.color), bc: F.toRGB(s.borderTopColor), bw: parseFloat(s.borderTopWidth), frame: el.matches('.btn--secondary,.btn--ghost,.nav-pill,.lang-switch,.header__burger,.filter-item,.catalog__filters-toggle,.lang-menu__option'), bg: F.toRGB(s.backgroundColor), td: s.textDecorationLine, op: +s.opacity,
    cand: cand.map((n) => ({ idx: cand.indexOf(n), sel: n.matches('[aria-selected=true]'), sc: sc(n), rect: r(n), bg: F.toRGB(getComputedStyle(n).backgroundColor), color: F.toRGB(getComputedStyle(n).color) })),
    tl: (el.matches('.footer a, .breadcrumbs a, main :is(p, li, dd, td) > a:not([class])') && !el.matches('.btn, .footer__logo, .contact-line')) ? (() => { const ps = getComputedStyle(el, '::before'); const sd = (n) => { const q = getComputedStyle(n); return [q.backgroundColor, q.backgroundImage, ['Top', 'Right', 'Bottom', 'Left'].map((k) => q['border' + k + 'Width'] + q['border' + k + 'Style']).join(), q.outlineStyle, q.boxShadow, q.paddingLeft + q.paddingRight + q.marginLeft].join('|'); }; const cr = el.getClientRects()[0] || el.getBoundingClientRect(); const has = ps.content !== 'none' && ps.content !== 'normal' && ps.display !== 'none'; const sc = ps.scale === 'none' ? 1 : parseFloat(ps.scale); const w = parseFloat(ps.width) || 0, h = parseFloat(ps.height) || 0; const tys = (ps.translate || '').split(' ')[1] || '0'; const ty = /%$/.test(tys) ? parseFloat(tys) / 100 * h : parseFloat(tys) || 0; const textLeft = cr.x + (el.matches('.footer a, .breadcrumbs a') ? parseFloat(s.paddingLeft) : 0); const bx0 = el.matches('.footer a, .breadcrumbs a') ? cr.x : cr.x - (parseFloat(ps.width) || 0) - 1; /* prose: the inline dot hangs left of the first line box */ return { sig: sd(el), has, v: has ? sc : 0, dot: has ? { inline: !el.matches('.footer a, .breadcrumbs a'), w, h, bx: bx0, by: cr.y, bh: cr.height, bg: F.toRGB(ps.backgroundColor), textLeft, lineCy: cr.y + cr.height / 2, dur: F.timing(ps, 'scale'), rad: ps.borderTopLeftRadius } : null, dur: F.timing(s, 'color'), color: F.toRGB(s.color), vw: innerWidth }; })() : null, /* TEXT-LINK (U14): text-only link, hover = lighter text colour + dot left of the text */
    top: (() => { const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!t && (el.contains(t) || t.contains(el)); })() }; })()`;

/* wait until every short CSS transition (< 2 s) has finished (robust under CPU load, unlike a fixed sleep); min 150 ms so a transition has started */
const settle = async (page) => { await new Promise((r) => setTimeout(r, 150)); await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => { try { return a instanceof CSSTransition && a.effect.getComputedTiming().endTime < 2000; } catch (e) { return false; } }).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2500))])); await new Promise((r) => setTimeout(r, 100)); };
async function samplePx(page, rect, corner) { // colour of the pixel 6px (or 15%) inside the left edge, vertical middle
  const sc = await page.evaluate(() => [window.scrollX, window.scrollY]); // clip is in page coordinates
  const x = corner ? rect.x + 1 + sc[0] : rect.x + Math.min(6, rect.w * 0.15) + sc[0], y = corner ? rect.y + 1 + sc[1] : rect.y + rect.h / 2 + sc[1];
  const b64 = await page.screenshot({ clip: { x: Math.max(0, x), y: Math.max(0, y), width: 1, height: 1 }, encoding: 'base64', type: 'png' });
  return page.evaluate((d) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(im, 0, 0); res([...g.getImageData(0, 0, 1, 1).data].slice(0, 3)); }; im.src = 'data:image/png;base64,' + d; }), b64);
}
async function dotPx(page, x0, x1, y0, y1, col) { // centroid of the pixels in the box that match the hover colour (the dot), page coordinates -> viewport coordinates
  const sc = await page.evaluate(() => [window.scrollX, window.scrollY]); const X = Math.floor(Math.max(0, x0 + sc[0])), Y = Math.floor(Math.max(0, y0 + sc[1])), Wd = Math.max(1, Math.ceil(x1 - x0) + 1), Hd = Math.max(1, Math.ceil(y1 - y0) + 1);
  const b64 = await page.screenshot({ clip: { x: X, y: Y, width: Wd, height: Hd }, encoding: 'base64', type: 'png' });
  const px = await page.evaluate((d) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); res({ w: im.width, h: im.height, d: [...g.getImageData(0, 0, im.width, im.height).data] }); }; im.src = 'data:image/png;base64,' + d; }), b64);
  let sw = 0, sx = 0, sy = 0; for (let j = 0; j < px.h; j++) for (let i = 0; i < px.w; i++) { const k = (j * px.w + i) * 4; const w = Math.max(0, 1 - dE([px.d[k], px.d[k + 1], px.d[k + 2]], col) / 8); if (w > 0.3) { sw += w; sx += w * (i + 0.5); sy += w * (j + 0.5); } }
  return sw ? { cx: X - sc[0] + sx / sw, cy: Y - sc[1] + sy / sw, n: sw } : null;
}
const allowFor = async (page, desc, idx, scope, key) => { /* allowlist match by selector evaluated in page */
  for (const a of allow) { if (a.pages && !a.pages.includes(key.page)) continue; if (a.widths && !a.widths.includes(key.w)) continue;
    const ok = await page.evaluate((sel, i, scope) => { const root = scope ? document.querySelector(scope) : document; const el = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')][i]; return el.matches(sel); }, a.selector, idx, scope);
    if (ok) return a; } return null; };

async function testElement(page, d, scope, key) {
  if (d.kind === 'demo') return { status: 'N/A', kind: 'demo', note: 'forced-state demo in design-system (.is-hover/.is-focus/.is-pressed/.is-disabled) or disabled control: not interactive' };
  if (d.state) return { status: 'N/A', kind: d.kind, note: 'forced-state specimen (.is-hover/.is-pressed/.is-focus/.is-disabled, design-system page) or disabled: no real hover to test' };
  /* LOGO (rule U11, customer 2026-11-14): hover = no plate. Real hover: background, border, outline, box-shadow, text-decoration, opacity, bbox of the link and of the image are unchanged; no ::before/::after box; U12: the logo's own fill (img background-color under the alpha mask) MUST differ rest vs hover; only colour/fill may differ. */
  if (/(^|\.)(header__logo|footer__logo)(\.|$)/.test(d.sig)) {
    const LG = (i) => page.evaluate((scope, i) => { const root = scope ? document.querySelector(scope) : document; const el = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')][i]; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const s = getComputedStyle(el); const b = el.getBoundingClientRect(), ib = (el.querySelector('img,svg') || el).getBoundingClientRect(); const pe = (p) => { const c = getComputedStyle(el, p); return c.content !== 'none' && c.content !== 'normal' ? c.content + '|' + c.backgroundColor + '|' + c.width : null; };
      return { bg: s.backgroundColor, bgImg: s.backgroundImage, border: ['Top', 'Right', 'Bottom', 'Left'].map((k) => s['border' + k + 'Width'] + s['border' + k + 'Style'] + s['border' + k + 'Color']).join(), outline: s.outlineStyle + s.outlineWidth + s.outlineColor, shadow: s.boxShadow, td: s.textDecorationLine, op: s.opacity, filter: s.filter, cursor: s.cursor, before: pe('::before'), after: pe('::after'), rect: [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(2)).join(), img: [ib.x, ib.y, ib.width, ib.height].map((v) => +v.toFixed(2)).join(), color: s.color, fill: getComputedStyle(el.querySelector('img,svg') || el).backgroundColor, hit: [b.width, b.height] }; }, scope, i);
    const a0 = await LG(d.i); await page.mouse.move(a0.rect.split(',')[0] * 1 + a0.hit[0] / 2, a0.rect.split(',')[1] * 1 + a0.hit[1] / 2); await settle(page); await new Promise((r) => setTimeout(r, 900));
    const a1 = await LG(d.i); const hovered = await page.evaluate((scope, i) => { const root = scope ? document.querySelector(scope) : document; return [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')][i].matches(':hover'); }, scope, d.i);
    await page.mouse.move(1, 1); await new Promise((r) => setTimeout(r, 120));
    const same = (k) => a0[k] === a1[k];
    const res = { kind: 'logo', checks: { hovered, noBackground: same('bg') && same('bgImg'), noBorder: same('border'), noOutline: same('outline'), noShadow: same('shadow'), noDecoration: same('td'), noFade: same('op') && same('filter'), noPseudoBox: !a1.before && !a1.after, fillChanges: a0.fill !== a1.fill, noShift: same('rect') && same('img'), pointer: a1.cursor === 'pointer', hit44: a1.hit[0] >= 44 && a1.hit[1] >= 44 }, info: { rest: a0, hover: a1 } };
    res.status = Object.values(res.checks).every(Boolean) ? 'PASS' : 'FAIL'; return res;
  }
  if (d.kind === 'card') return { status: 'N/A', kind: 'card', note: 'card / media link (whole-block link, not button-like): hover owned by the component, listed in the inventory' };
  const m0 = await page.evaluate(MEASURE(scope, d.i));
  if (!m0.top) return { status: 'SKIP', note: 'occluded' };
  const r0 = m0.rect; const px0 = await samplePx(page, r0, !!m0.tl);
  await page.mouse.move(r0.x + r0.w / 2, r0.y + r0.h / 2); await settle(page);
  const m1 = await page.evaluate(MEASURE(scope, d.i));
  const px1 = await samplePx(page, m1.rect, !!m0.tl);
  let dotC = null; if (m1.tl && m1.tl.dot) { const q = m1.tl.dot; dotC = await dotPx(page, q.bx, q.textLeft - 0.5, q.by, q.by + q.bh - 3, m1.color.slice(0, 3)); }
  await page.mouse.move(1, 1); await new Promise((r) => setTimeout(r, 120));
  const res = { kind: d.kind, checks: {}, info: {} };
  // disc: any candidate (element or its ring/btn child) whose ::before scale goes 0 -> 1
  let disc = null, dk = 0; for (let k = 0; k < m1.cand.length; k++) { const a = m0.cand[k].sc, b = m1.cand[k].sc; if (a && b && Math.min(a.scale, a.tf) < 0.05 && Math.min(b.scale, b.tf) > 0.95) { disc = m1.cand[k]; dk = k; break; } }
  const target = disc || m1.cand[0]; // sampling rect/bg
  const dim = (a, b) => Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
  res.checks.disc = !!disc;
  /* speed gate (customer 2026-11-13): every instance runs the ONE token --dur-hover-disc (+-1 ms) with delay 0, on the disc (::before scale) and on the owner's colour */
  if (disc) { const tok = await page.evaluate(`(${fnSrc})().token()`); const ct = await page.evaluate(`(${fnSrc})().tokens()`); const dd = disc.sc.dur, oc = disc.sc.own; const colChanges = dE(m0.cand[dk].color.slice(0, 3), m1.cand[dk].color.slice(0, 3)) > 1; /* the owner's colour is checked only where it really changes on hover (e.g. contact-line / header ring keep their colour) */
    res.checks.discDuration = (!!dd && Math.abs(dd.dur - tok) <= 1 && dd.delay === 0 && (!colChanges || (!!oc && Math.abs(oc.dur - ct.cdur) <= 1 && ct.cdelays.some((d) => Math.abs(oc.delay - d) <= 1)))); res.info.disc = { token: tok, before: dd, color: oc, colorToken: [ct.cdur, ...ct.cdelays] };
    /* COVERAGE (customer 2026-11-13, rule B2b): time from hover start until the disc completely covers the button (disc radius >= farthest point of the padding box, rounded corners included), from the real geometry + the disc's own easing. Must be the same for EVERY form (+-10% of the median of the whole run, checked after the crawl). */
    const R0 = disc.sc.D / 2, cw = Math.max(1, disc.rect.w - 2 * disc.sc.bw), ch = Math.max(1, disc.rect.h - 2 * disc.sc.bw), rr = Math.min(disc.sc.rad, cw / 2, ch / 2); const Rn = rr >= Math.min(cw, ch) / 2 - 0.5 ? Math.max(cw, ch) / 2 : Math.hypot(cw / 2 - rr, ch / 2 - rr) + rr;
    const bz = /cubic-bezier\(([^)]+)\)/.exec(disc.sc.ease); const [x1, y1, x2, y2] = bz ? bz[1].split(',').map(Number) : [0, 0, 1, 1]; const Bx = (u) => 3 * x1 * (1 - u) ** 2 * u + 3 * x2 * (1 - u) * u * u + u ** 3, By = (u) => 3 * y1 * (1 - u) ** 2 * u + 3 * y2 * (1 - u) * u * u + u ** 3;
    const frac = R0 > 0 ? Rn / R0 : Infinity; let covT = null; if (frac <= 1) { let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; By(m) < frac ? lo = m : hi = m; } covT = Math.round(Bx((lo + hi) / 2) * tok); }
    res.info.coverMs = covT; res.info.geo = [Math.round(R0), Math.round(Rn), Math.round(cw), Math.round(ch), +frac.toFixed(2)]; const hAssumed = await page.evaluate((i, scope) => { const root = scope ? document.querySelector(scope) : document; const el = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')][i]; const v = parseFloat(getComputedStyle(el).getPropertyValue('--_h')); return v || 0; }, d.i, scope); const multiLine = hAssumed > 0 && disc.rect.h > hAssumed * 1.25; /* a label that wraps to several lines is taller than the control height --_h the disc geometry is built on: reported, not compared */
    if (multiLine) res.info.coverSkipped = 'multi-line label (h ' + Math.round(disc.rect.h) + ' > 1.25 x --_h ' + hAssumed + ')';
    if (!(m1.tl || m0.tl || multiLine)) { /* text links have their own radial-gradient fill (rule B6) (the active language option is covered by the same disc check, customer 2026-11-14) */ res.checks.covered = covT !== null; res.coverMs = covT; } }
  const surf = disc ? (disc.sc.bg) : px1;
  const blend = (c, bg) => { const a = c[3] === undefined ? 1 : c[3]; return [0, 1, 2].map((i) => c[i] * a + bg[i] * (1 - a)); }; // semi-transparent labels are composited over the pixel behind them
  const colorDE = dE(blend(m0.cand[dk].color, px0), blend(m1.cand[dk].color, px1)); // label colour of the element that owns the disc (the link itself or its ring/round button)
  const labelC = contrast(blend(m1.cand[dk].color, px1), disc ? disc.sc.bg.slice(0, 3) : px1);
  const pxDE = dE(px0, px1);
  res.info = { ...res.info, colorDE: +colorDE.toFixed(1), pxDE: +pxDE.toFixed(1), labelContrast: +labelC.toFixed(1), tdChange: m0.td !== m1.td };
  const light = /(^|\.)contact-line(\.|$)/.test(d.sig);
  if (d.kind === 'button' && !(m1.tl || m0.tl)) {
    // .contact-line (customer 2026-11-13): the fill is by design only a step LIGHTER than its surface (--surface-white on page/raised/sunken), so the threshold is dE >= 1 (still must be lighter), not 10
    const minDE = light ? 1 : 10;
    res.checks.visible = Math.max(colorDE, pxDE) >= minDE || (disc && dE(px0, disc.sc.bg.slice(0, 3)) >= minDE);
    if (light) res.checks.lighter = !!disc && lum(disc.sc.bg.slice(0, 3)) > lum(px0) && m1.td === 'none' && m0.td === 'none';
    res.checks.label = labelC >= 3 || (!disc && Math.max(colorDE, pxDE) >= 10);
    res.checks.size = dim(m0.rect, m1.rect) <= 0.5;
    /* FRAME (customer 2026-11-13 "Рамка на всіх"): header/pill-role controls get a 1px opaque frame on hover; it must visibly differ from rest (transparent at rest) or already be opaque at rest */
    if (m1.frame) res.checks.frame = m1.bw >= 1 && m1.bc[3] > 0.9 && (m0.bc[3] > 0.9 || dE(blend(m0.bc, px0), blend(m1.bc, px1)) >= 10);
  } else if (m1.tl || m0.tl) { // TEXT-LINK (rule U14, customer 2026-11-14): text-only link (no fill, no icon): hover = LIGHTER text colour (--text-hover-lighter) + a dot LEFT of the text (::before, scale 0>1), both in --dur-hover-color; no plate / fill / border / outline / shadow / padding change, same bbox
    const tok = await page.evaluate(`(${fnSrc})().tokens()`); const t0 = m0.tl, t1 = m1.tl; const dd = t1 && t1.dur, dt = t1 && t1.dot && t1.dot.dur; const dot = t1 && t1.dot;
    const L0 = lum(m0.color.slice(0, 3)), L1 = lum(m1.color.slice(0, 3));
    const same = (a, b) => Math.abs(a - b) <= 1; const col = m1.color.slice(0, 3);
    res.checks = { colorLighter: L1 > L0 && dE(m0.color.slice(0, 3), col) >= 8, dotAppears: !!t0 && !!t1 && t0.has && t0.v < 0.05 && t1.v > 0.95, dotLeft: !!dot && !!dotC && dotC.cx + dot.w / 2 <= dot.textLeft + 0.5 && dotC.cx - dot.w / 2 >= -0.5, dotCentred: !!dot && !!dotC && Math.abs(dotC.cy - dot.lineCy) <= (dot.inline ? 3.5 : 0.5), /* one-line links: dot on the line-box centre +-0.5 px; wrapped inline prose links: dot on the x-height midline (optical centre), within 3.5 px of the line-box centre */ dotSize: !!dot && Math.abs(dot.w - 6) <= 1 && Math.abs(dot.h - dot.w) <= 0.5 && dot.rad !== '0px', dotColour: !!dot && dE(dot.bg.slice(0, 3), col) < 1,
      noBoxChange: !!t0 && !!t1 && t0.sig === t1.sig, noDecoChange: m0.td === m1.td, size: dim(m0.rect, m1.rect) <= 0.5 && Math.abs(m0.rect.x - m1.rect.x) <= 0.5 && Math.abs(m0.rect.y - m1.rect.y) <= 0.5,
      duration: !!dd && !!dt && Math.abs(dd.dur - tok.cdur) <= 1 && Math.abs(dt.dur - tok.cdur) <= 1 && tok.cdelays.some((x) => Math.abs(dd.delay - x) <= 1), label: contrast(col, px1) >= 4.5 };
    res.info.textColor = [m0.color.slice(0, 3).join(','), col.join(','), 'lum ' + L0.toFixed(3) + '>' + L1.toFixed(3), 'contrast ' + contrast(col, px1).toFixed(1)].join(' '); if (dot && dotC) res.info.dot = ['w' + dot.w, 'cx' + dotC.cx.toFixed(1), 'cy' + dotC.cy.toFixed(1), 'lineCy' + dot.lineCy.toFixed(1)].join(' ');
  } else { // text link: visible hover needed, no disc required
    res.checks.disc = !light || !!disc; res.checks.visible = Math.max(colorDE, pxDE) >= (light ? 1 : 10) || m0.td !== m1.td || Math.abs(m0.op - m1.op) > 0.2; res.checks.size = dim(m0.rect, m1.rect) <= 0.5;
    if (light) res.checks.lighter = !!disc && lum(disc.sc.bg.slice(0, 3)) > lum(px0) && m1.td === 'none' && m0.td === 'none';
  }
  res.status = Object.values(res.checks).every(Boolean) ? 'PASS' : 'FAIL';
  if (res.status === 'FAIL') { const a = await allowFor(page, d, d.i, scope, key); if (a) { const rest = Object.entries(res.checks).filter(([k, v]) => !v && !(a.skip || []).includes(k)); if (!rest.length) { res.status = 'ALLOW'; res.allow = a.reason + ' [skipped: ' + (a.skip || []).join(',') + ']'; } } }
  return res;
}

/* Cards with one action button = WHOLE CARD is the button (customer 2026-11-14, stretched link): a point on the card BODY (not on the button) must (a) resolve to the CTA (its ::after) or, for <a>-cards, to the card link, (b) show cursor:pointer, (c) put the button into the disc hover state. Keep in sync with the :is() lists in buttons.css / cards.css. */
const CARDS = ['.text-card', '.catalog__empty', '.product-card', '.link-card'];
async function testCards(page, key) {
  const out = [];
  const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, CARDS.join(','));
  for (let i = 0; i < n; i++) {
    const info = await page.evaluate((sel, i) => { const c = document.querySelectorAll(sel)[i]; const btn = c.querySelector('.btn,.round-btn'); if (!btn) return null; c.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = c.getBoundingClientRect(), b = btn.getBoundingClientRect(); if (!r.width || !b.width || getComputedStyle(c).visibility === 'hidden') return null;
      // a point inside the card, outside the button: card top-left area
      return { sig: c.className.trim().split(/\s+/).join('.'), x: r.x + Math.min(20, r.width / 4), y: r.y + Math.min(20, r.height / 4), inBtn: false, bw: b.width }; }, CARDS.join(','), i);
    if (!info) continue;
    await page.mouse.move(1, 1); await new Promise((r) => setTimeout(r, 150));
    const before = await page.evaluate((sel, i) => { const b = document.querySelectorAll(sel)[i].querySelector('.btn,.round-btn'); const s = getComputedStyle(b, '::before'); return s.scale === 'none' ? 1 : parseFloat(s.scale); }, CARDS.join(','), i);
    await page.mouse.move(info.x, info.y); await settle(page);
    const after = await page.evaluate((fnSrc, sel, i, x, y) => { const F = eval('(' + fnSrc + ')')(); const c = document.querySelectorAll(sel)[i]; const b = c.querySelector('.btn,.round-btn'); const t = document.elementFromPoint(x, y); const s = getComputedStyle(b, '::before'); return { scale: s.scale === 'none' ? 1 : parseFloat(s.scale), onBtn: c.matches('a') ? c.contains(t) : b.contains(t), cursor: t ? getComputedStyle(t).cursor : '', dur: F.timing(s, 'scale'), own: F.timing(getComputedStyle(b), 'color'), tok: F.token() }; }, fnSrc, CARDS.join(','), i, info.x, info.y);
    await page.mouse.move(1, 1);
    const ctk = await page.evaluate(`(${fnSrc})().tokens()`); const colorMoves = !!after.own; const speedOK = !!after.dur && Math.abs(after.dur.dur - after.tok) <= 1 && after.dur.delay === 0 && !!after.own && Math.abs(after.own.dur - ctk.cdur) <= 1 && ctk.cdelays.some((d) => Math.abs(after.own.delay - d) <= 1); /* ONE speed: --dur-hover-disc, delay 0 */
    const pass = before < 0.05 && after.scale > 0.95 && after.onBtn && after.cursor === 'pointer' && speedOK;
    out.push({ page: key.page, w: key.w, scene: 'card-hover', el: info.sig + ' > button (hover/click on card body = CTA)', kind: 'card-btn', status: pass ? 'PASS' : 'FAIL', checks: { cardHoverDisc: before < 0.05 && after.scale > 0.95, wholeCardIsCta: after.onBtn, cardPointer: after.cursor === 'pointer', discDuration: speedOK }, info: { before, after: after.scale, pointOnButton: after.onBtn, disc: { token: after.tok, before: after.dur, color: after.own } } });
  }
  return out;
}

(async () => {
  let srv = null, base = opt('url', null); if (!base || base === true) { srv = await startServer(); base = srv.url; }
  const rows = []; const inv = []; const SEEN = new Set(); const errors = [];
  const jobs = [];
  for (const w of WIDTHS) for (const [name, url] of PAGES) { if (ONLY && !ONLY.includes(name)) continue; jobs.push({ w, name, url }); }
  const runJob = async (job, browser) => {
    const page = await browser.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(45000); await page.bringToFront(); page.on('pageerror', (e) => errors.push(`${job.name}@${job.w}: ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|WebGL/.test(m.text())) errors.push(`${job.name}@${job.w}: ${m.text()}`); });
    /* no WebGL: the 3D hero/scene loops saturate the CPU in software-GL headless Chrome and starve hover timing; pages fall back to their static state (hover CSS is unaffected) */
    await page.evaluateOnNewDocument(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(t) ? null : g.call(this, t, ...a); }; });
    await page.setViewport({ width: job.w, height: 900, deviceScaleFactor: 1, hasTouch: false, isMobile: false });
    await page.goto(base + job.url, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '[data-reveal],[data-reveal] *{opacity:1!important;transform:none!important;transition-property:color,background-color,border-color,scale,translate!important}' });
    const scenes = [{ id: 'page', scope: null }];
    if (job.w >= 1200) scenes.push({ id: 'lang-dropdown', scope: '.header .lang-menu__list', pre: async () => { await page.click('.header [data-lang-switch]'); await new Promise((r) => setTimeout(r, 400)); } });
    else scenes.push({ id: 'burger-menu', scope: '.header__panel', pre: async () => { await page.click('.header [data-menu-toggle]'); await new Promise((r) => setTimeout(r, 400)); } });
    rows.push(...await testCards(page, { page: job.name, w: job.w }));
    for (const sc of scenes) {
      if (sc.pre) { if (job.name !== 'index' && job.name !== 'catalog' && job.name !== 'contact') continue; await page.evaluate(() => window.scrollTo(0, 0)); await sc.pre(); await page.mouse.move(1, 1); await settle(page); }
      const list = await page.evaluate(COLLECT(sc.scope));
      for (const d of list) {
        const sg = [job.w, sc.id, d.sig, d.kind === 'button' || d.kind === 'link' ? d.ctx : d.parent].join('|'); if (!opt('all', false) && SEEN.has(sg)) continue; SEEN.add(sg); /* default: one check per class signature + section context + width; --all = every element */
        const inHeader = sc.scope && sc.scope.startsWith('.header');
        let r; try { r = await Promise.race([testElement(page, d, sc.scope, { page: job.name, w: job.w }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 30s')), 30000))]); } catch (e) { r = { status: 'ERROR', note: String(e.message).slice(0, 80) }; }
        const row = { page: job.name, w: job.w, scene: sc.id, el: d.sig, text: d.text, kind: d.kind, ...r }; rows.push(row); if (opt('progress', false)) console.error(`[${rows.length}] ${row.status} ${job.name}@${job.w} ${row.el} ${row.note || ""}`);
        if (opt('verbose', false)) console.log(row.status, job.name, job.w, row.el, JSON.stringify(row.info || row.note || ''));
      }
      if (sc.pre) rows.push(await testLangSequence(page, { page: job.name, w: job.w }, sc.id === 'burger-menu'));
      inv.push(...list.map((d) => ({ page: job.name, w: job.w, scene: sc.id, el: d.sig, kind: d.kind, text: d.text })));
      if (sc.pre) { await page.reload({ waitUntil: 'networkidle0' }); }
    }
    await page.close();
  };
  const q = jobs.slice(); /* one browser (= one foreground tab) per worker: background tabs throttle transitions and break real hover */
  const launch = () => puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const workers = Array.from({ length: Math.min(+opt('workers', 1), jobs.length) }, async () => {
    let browser = await launch();
    while (q.length) {
      const j = q.shift(); let ok = false, last = null;
      for (let t = 0; t < 3 && !ok; t++) { // a crashed/closed Chrome is relaunched; rows of the failed attempt are dropped
        const before = rows.length;
        try { if (!browser.connected) browser = await launch(); await Promise.race([runJob(j, browser), new Promise((_, rej) => setTimeout(() => rej(new Error('job timeout 300s')), 300000))]); ok = true; }
        catch (e) { last = e; rows.length = before; try { await browser.close(); } catch (x) {} browser = await launch(); }
      }
      if (!ok) rows.push({ page: j.name, w: j.w, scene: 'job', el: '(page crawl)', kind: '-', status: 'ERROR', note: String(last && last.message).slice(0, 80) });
    }
    await browser.close();
  });
  await Promise.all(workers);
  if (srv) srv.stop();
  // ---- coverage gate (rule B2b): every form of button reaches full coverage at the same time (+-10% of the run median per width)
  { const byW = {}; for (const r of rows) if (r.coverMs) (byW[r.w] = byW[r.w] || []).push(r); for (const w of Object.keys(byW)) { const a = byW[w].map((r) => r.coverMs).sort((x, y) => x - y); const med = a[Math.floor(a.length / 2)];
      for (const r of byW[w]) { r.info.coverMedian = med; r.checks.coverage = Math.abs(r.coverMs - med) <= med * 0.1; if (!r.checks.coverage && r.status !== 'FAIL') r.status = 'FAIL'; } console.log(`coverage @${w}: median ${med} ms, min ${a[0]}, max ${a[a.length - 1]} (${a.length} discs)`); } }
  // ---- report
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'FAIL' ? -1 : 1));
  console.log(pad('STATUS', 7) + pad('KIND', 8) + pad('PAGE@W/scene', 30) + pad('ELEMENT', 62) + 'DETAIL');
  for (const r of rows) if (opt('verbose', false) || r.status !== 'PASS') console.log(pad(r.status, 7) + pad(r.kind || '', 8) + pad(`${r.page}@${r.w}/${r.scene}`, 30) + pad(r.el, 62) + (r.status === 'FAIL' ? Object.entries(r.checks || {}).filter(([k, v]) => !v).map(([k]) => k).join(',') + ' ' + JSON.stringify(r.info) : r.allow || r.note || ''));
  const cnt = (s) => rows.filter((r) => r.status === s).length;
  console.log(`\nChecked ${rows.length} unique elements: PASS ${cnt('PASS')}, ALLOW ${cnt('ALLOW')}, N/A(card/media links) ${cnt('N/A')}, SKIP ${cnt('SKIP')}, ERROR ${cnt('ERROR')}, FAIL ${cnt('FAIL')}`);
  if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 10));
  if (opt('inventory', false) && opt('inventory') !== true) fs.writeFileSync(opt('inventory'), JSON.stringify({ rows, inventory: inv }, null, 1));
  process.exit(cnt('FAIL') + cnt('ERROR') > 0 ? 1 : 0);
})();
