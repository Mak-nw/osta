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
  return { toRGB, sig, visible, classify };
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

/* collect clickable elements of a scope; returns descriptors (index into the matching list) */
const COLLECT = (scope) => `(() => { const F = (${fnSrc})(); const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; if (!root) return [];
  const els = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')];
  return els.map((el, i) => F.visible(el) ? { i, sig: F.sig(el), kind: F.classify(el), state: el.matches('.is-hover,.is-pressed,.is-focus:not(.lang-menu__option),.is-disabled,[disabled],[aria-disabled=true]'), text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40), parent: F.sig(el.parentElement), ctx: (el.closest('section,footer,header,main,.hero,[class*=closing]') || document.body).className } : null).filter(Boolean); })()`;

/* measure state of the i-th element: colours, pseudo scale, rect */
const MEASURE = (scope, i) => `(() => { const F = (${fnSrc})(); const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
  const els = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')]; const el = els[${i}];
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const cand = [el, ...el.querySelectorAll('.round-btn,.icon-ring--action,[class*="btn"]')];
  const sc = (n) => { const s = getComputedStyle(n, '::before'); if (s.content === 'none' || s.content === 'normal' || s.display === 'none') return null; const v = s.scale === 'none' ? 1 : parseFloat(s.scale); const m = /matrix\\(([^,]+)/.exec(s.transform); return { scale: v, tf: m ? parseFloat(m[1]) : 1, bg: F.toRGB(s.backgroundColor) }; };
  const r = (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const s = getComputedStyle(el); const cs = getComputedStyle(el);
  return { rect: r(el), color: F.toRGB(s.color), bg: F.toRGB(s.backgroundColor), td: s.textDecorationLine, op: +s.opacity,
    cand: cand.map((n) => ({ idx: cand.indexOf(n), sc: sc(n), rect: r(n), bg: F.toRGB(getComputedStyle(n).backgroundColor), color: F.toRGB(getComputedStyle(n).color) })),
    top: (() => { const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!t && (el.contains(t) || t.contains(el)); })() }; })()`;

/* wait until every short CSS transition (< 2 s) has finished (robust under CPU load, unlike a fixed sleep); min 150 ms so a transition has started */
const settle = async (page) => { await new Promise((r) => setTimeout(r, 150)); await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => { try { return a instanceof CSSTransition && a.effect.getComputedTiming().endTime < 2000; } catch (e) { return false; } }).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2500))])); await new Promise((r) => setTimeout(r, 100)); };
async function samplePx(page, rect) { // colour of the pixel 6px (or 15%) inside the left edge, vertical middle
  const sc = await page.evaluate(() => [window.scrollX, window.scrollY]); // clip is in page coordinates
  const x = rect.x + Math.min(6, rect.w * 0.15) + sc[0], y = rect.y + rect.h / 2 + sc[1];
  const b64 = await page.screenshot({ clip: { x: Math.max(0, x), y: Math.max(0, y), width: 1, height: 1 }, encoding: 'base64', type: 'png' });
  return page.evaluate((d) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(im, 0, 0); res([...g.getImageData(0, 0, 1, 1).data].slice(0, 3)); }; im.src = 'data:image/png;base64,' + d; }), b64);
}
const allowFor = async (page, desc, idx, scope, key) => { /* allowlist match by selector evaluated in page */
  for (const a of allow) { if (a.pages && !a.pages.includes(key.page)) continue; if (a.widths && !a.widths.includes(key.w)) continue;
    const ok = await page.evaluate((sel, i, scope) => { const root = scope ? document.querySelector(scope) : document; const el = [...root.querySelectorAll('a,button,[role=button],[role=option],[role=tab],summary,input[type=submit]')][i]; return el.matches(sel); }, a.selector, idx, scope);
    if (ok) return a; } return null; };

async function testElement(page, d, scope, key) {
  if (d.kind === 'demo') return { status: 'N/A', kind: 'demo', note: 'forced-state demo in design-system (.is-hover/.is-focus/.is-pressed/.is-disabled) or disabled control: not interactive' };
  if (d.state) return { status: 'N/A', kind: d.kind, note: 'forced-state specimen (.is-hover/.is-pressed/.is-focus/.is-disabled, design-system page) or disabled: no real hover to test' };
  if (d.kind === 'card') return { status: 'N/A', kind: 'card', note: 'card / media link (whole-block link, not button-like): hover owned by the component, listed in the inventory' };
  const m0 = await page.evaluate(MEASURE(scope, d.i));
  if (!m0.top) return { status: 'SKIP', note: 'occluded' };
  const r0 = m0.rect; const px0 = await samplePx(page, r0);
  await page.mouse.move(r0.x + r0.w / 2, r0.y + r0.h / 2); await settle(page);
  const m1 = await page.evaluate(MEASURE(scope, d.i));
  const px1 = await samplePx(page, m1.rect);
  await page.mouse.move(1, 1); await new Promise((r) => setTimeout(r, 120));
  const res = { kind: d.kind, checks: {}, info: {} };
  // disc: any candidate (element or its ring/btn child) whose ::before scale goes 0 -> 1
  let disc = null, dk = 0; for (let k = 0; k < m1.cand.length; k++) { const a = m0.cand[k].sc, b = m1.cand[k].sc; if (a && b && Math.min(a.scale, a.tf) < 0.05 && Math.min(b.scale, b.tf) > 0.95) { disc = m1.cand[k]; dk = k; break; } }
  const target = disc || m1.cand[0]; // sampling rect/bg
  const dim = (a, b) => Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
  res.checks.disc = !!disc;
  const surf = disc ? (disc.sc.bg) : px1;
  const blend = (c, bg) => { const a = c[3] === undefined ? 1 : c[3]; return [0, 1, 2].map((i) => c[i] * a + bg[i] * (1 - a)); }; // semi-transparent labels are composited over the pixel behind them
  const colorDE = dE(blend(m0.cand[dk].color, px0), blend(m1.cand[dk].color, px1)); // label colour of the element that owns the disc (the link itself or its ring/round button)
  const labelC = contrast(blend(m1.cand[dk].color, px1), disc ? disc.sc.bg.slice(0, 3) : px1);
  const pxDE = dE(px0, px1);
  res.info = { colorDE: +colorDE.toFixed(1), pxDE: +pxDE.toFixed(1), labelContrast: +labelC.toFixed(1), tdChange: m0.td !== m1.td };
  if (d.kind === 'button') {
    res.checks.visible = Math.max(colorDE, pxDE) >= 10 || (disc && dE(px0, disc.sc.bg.slice(0, 3)) >= 10);
    res.checks.label = labelC >= 3 || (!disc && Math.max(colorDE, pxDE) >= 10);
    res.checks.size = dim(m0.rect, m1.rect) <= 0.5;
  } else { // text link: visible hover needed, no disc required
    res.checks.disc = true; res.checks.visible = Math.max(colorDE, pxDE) >= 10 || m0.td !== m1.td || Math.abs(m0.op - m1.op) > 0.2; res.checks.size = dim(m0.rect, m1.rect) <= 0.5;
  }
  res.status = Object.values(res.checks).every(Boolean) ? 'PASS' : 'FAIL';
  if (res.status === 'FAIL') { const a = await allowFor(page, d, d.i, scope, key); if (a) { const rest = Object.entries(res.checks).filter(([k, v]) => !v && !(a.skip || []).includes(k)); if (!rest.length) { res.status = 'ALLOW'; res.allow = a.reason + ' [skipped: ' + (a.skip || []).join(',') + ']'; } } }
  return res;
}

/* Cards with one action button: hovering the card BODY (not the button) must put the button into the disc hover state. Keep in sync with the :is() list in buttons.css. */
const CARDS = ['.text-card', '.help-card', '.catalog__empty', '.cta-block'];
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
    const after = await page.evaluate((sel, i, x, y) => { const c = document.querySelectorAll(sel)[i]; const b = c.querySelector('.btn,.round-btn'); const t = document.elementFromPoint(x, y); const s = getComputedStyle(b, '::before'); return { scale: s.scale === 'none' ? 1 : parseFloat(s.scale), onBtn: b.contains(t), cursor: t ? getComputedStyle(c).cursor : '' }; }, CARDS.join(','), i, info.x, info.y);
    await page.mouse.move(1, 1);
    const pass = before < 0.05 && after.scale > 0.95 && !after.onBtn;
    out.push({ page: key.page, w: key.w, scene: 'card-hover', el: info.sig + ' > button (hover on card body)', kind: 'card-btn', status: pass ? 'PASS' : 'FAIL', checks: { cardHoverDisc: pass }, info: { before, after: after.scale, pointOnButton: after.onBtn } });
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
