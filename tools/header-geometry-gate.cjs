#!/usr/bin/env node
/* Header geometry gate (`npm run audit:header`, rule L6). Customer 2026-11-14: the header is identical on all pages, widths and browsers.
   Chrome mode: for widths 375 768 1024 1199 1200 1280 1440 1920 and every root *.html page (EN) + /de/about.html, measure
   header, panel, logo (link + img), burger, every nav item, lang switch, CTA bbox and |logo centre - panel centre|.
   FAIL: any value differs from the first page (index) at the same width by > 0.5 px; logo centre offset > 0.5 px at >= 1200 (symmetric grid);
   at <= 1199 the logo is allowed to be off-centre, but only the same on every page. DE texts are longer, so for DE only text-independent
   values (header, panel, logo, burger, y/height of everything) are strict; text-driven x/width of nav, lang, CTA are reported as info.
   --safari: drive real Safari via safaridriver on :4444 (raw WebDriver HTTP), compare with Chrome per page/width:
   1 px tolerance for text-metric-driven boxes (nav, lang, CTA), 0.5 px for header/panel/logo and logo centre offset.
   Needs the dev server (default http://localhost:5173), headless Chrome (puppeteer-core). Refuses to run next to other gates unless --force.
   Usage: node tools/header-geometry-gate.cjs [--url ...] [--pages a,b] [--widths 375,...] [--safari] [--table] [--force] */
const cp = require('child_process');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const URL = opt('url', 'http://localhost:5173'), TABLE = !!opt('table', false), SAFARI = !!opt('safari', false);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const WIDTHS = String(opt('widths', '375,768,1024,1199,1200,1280,1440,1920')).split(',').map(Number);
const allPages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'design-system.html').map((f) => f.replace(/\.html$/, ''));
allPages.sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));
const PAGES = opt('pages', false) ? String(opt('pages')).split(',') : allPages.concat(['de/about']);
const urlOf = (p) => URL + '/' + (p === 'index' ? '' : p + '.html');
const TEXT_DRIVEN = (k) => /^(nav|lang|cta|left|actions)/.test(k);
const others = (() => { try { return cp.execSync("pgrep -f '^node .*(hover-gate|style-gate|poster-swap|grid-snap|hero-fit)[.]cjs' || true", { encoding: 'utf8' }).split('\n').filter(Boolean).join(','); } catch (e) { return ''; } })();
if (others && !opt('force', false)) { console.error('Another gate is running (pid ' + others + '). Re-run later or pass --force.'); process.exit(2); }

/* measurement script, runs in the page; returns a JSON string (works in Chrome evaluate and Safari execute/sync) */
const MEASURE = `
var S = [['header','.header'],['panel','.header__panel'],['left','.header__left'],['burger','.header__burger'],['logo','.header__logo'],['logoimg','.header__logo img'],['actions','.header__actions'],['lang','.lang-switch'],['cta','.header__cta']];
var o = {}, R = function (e) { var r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
S.forEach(function (s) { var e = document.querySelector(s[1]); if (!e) { o[s[0]] = null; return; } var r = R(e); o[s[0]] = (r[2] === 0 && r[3] === 0) ? null : r; });
Array.prototype.forEach.call(document.querySelectorAll('.header__nav .nav-pill'), function (e, i) { var r = R(e); o['nav' + i] = (r[2] === 0 && r[3] === 0) ? null : r; });
if (o.logo && o.panel) o.logoOff = Math.abs((o.logo[0] + o.logo[2] / 2) - (o.panel[0] + o.panel[2] / 2));
o.iw = innerWidth; o.cw = document.documentElement.clientWidth;
return JSON.stringify(o);`;

const pad = (s, n) => String(s).padEnd(n);
const f1 = (v) => (Math.round(v * 10) / 10);
function diffs(a, b, tol, strict) { // a, b: measurement objects; returns list of strings
  const out = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'iw' && k !== 'cw'));
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (k === 'logoOff') { if (Math.abs(va - vb) > 0.5) out.push(`logoOff ${f1(va)} vs ${f1(vb)}`); continue; }
    if ((va == null) !== (vb == null)) { out.push(`${k} ${va ? 'present' : 'hidden'} vs ${vb ? 'present' : 'hidden'}`); continue; }
    if (!va) continue;
    const td = TEXT_DRIVEN(k);
    ['x', 'y', 'w', 'h'].forEach((c, i) => {
      const d = Math.abs(va[i] - vb[i]), t = td ? tol.text : 0.5;
      if (strict === 'notext' && td && (c === 'x' || c === 'w')) return;
      if (d > t) out.push(`${k}.${c} ${f1(va[i])} vs ${f1(vb[i])} (d ${f1(d)})`);
    });
  }
  return out;
}

async function chromeRun() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const data = {};
  for (const w of WIDTHS) {
    const pg = await browser.newPage();
    await pg.setViewport({ width: w, height: 900 });
    for (const p of PAGES) {
      await pg.goto(urlOf(p), { waitUntil: 'domcontentloaded' });
      await pg.evaluate(async () => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); await document.fonts.ready; });
      await new Promise((r) => setTimeout(r, 700));
      data[w + '|' + p] = JSON.parse(await pg.evaluate(new Function(MEASURE)));
    }
    await pg.close();
  }
  await browser.close();
  return data;
}

/* ---- Safari via raw WebDriver ---- */
const WD = 'http://localhost:4444';
async function wd(m, p, b) { const r = await fetch(WD + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; }
async function safariSession() {
  try { await fetch(WD + '/status'); } catch (e) { cp.spawn('safaridriver', ['-p', '4444'], { detached: true, stdio: 'ignore' }).unref(); await new Promise((r) => setTimeout(r, 1500)); }
  for (let i = 0; i < 20; i++) {
    try { return await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }); }
    catch (e) { if (i === 19) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
}
async function safariRun() {
  const s = await safariSession(); const S = '/session/' + s.sessionId; const data = {};
  try {
    for (const w of WIDTHS) {
      await wd('POST', S + '/window/rect', { width: w, height: 900, x: 0, y: 0 });
      // Safari may show a classic 15 px scrollbar (System Settings > always show): size the window so clientWidth (layout viewport, what breakpoints see) == w, as in Chrome headless
      const cwOf = () => wd('POST', S + '/execute/sync', { script: 'return document.documentElement.clientWidth', args: [] });
      let cw = await cwOf();
      for (let k = 0; k < 3 && cw !== w; k++) {
        const rect = await wd('GET', S + '/window/rect');
        await wd('POST', S + '/window/rect', { width: rect.width + (w - cw), height: 900, x: 0, y: 0 });
        cw = await cwOf();
      }
      for (const p of PAGES) {
        await wd('POST', S + '/url', { url: urlOf(p) });
        await new Promise((r) => setTimeout(r, 1800));
        await wd('POST', S + '/execute/sync', { script: "document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach(function(e){e.style.opacity=1;e.style.transform='none';e.style.transition='none'});return 1", args: [] });
        await new Promise((r) => setTimeout(r, 500));
        data[w + '|' + p] = JSON.parse(await wd('POST', S + '/execute/sync', { script: MEASURE, args: [] }));
      }
    }
  } finally { try { await wd('DELETE', S); } catch (e) {} }
  return data;
}

function summary(title, data) {
  console.log('\n== ' + title + ' ==');
  console.log(pad('width', 6) + pad('iw/cw', 11) + pad('header h', 9) + pad('panel x,y,w,h', 28) + pad('logo x,y,w,h', 28) + 'logoOff');
  for (const w of WIDTHS) { const m = data[w + '|index']; if (!m) continue; console.log(pad(w, 6) + pad(m.iw + '/' + m.cw, 11) + pad(f1(m.header[3]), 9) + pad(m.panel.map(f1).join(','), 28) + pad(m.logo.map(f1).join(','), 28) + f1(m.logoOff)); }
}

(async () => {
  const chrome = await chromeRun();
  let fails = 0, info = 0, n = 0;
  const fail = (s) => { fails++; console.log('FAIL ' + s); };
  summary('Chrome (index; panel/logo/offset per width)', chrome);
  for (const w of WIDTHS) {
    const base = chrome[w + '|' + PAGES[0]];
    for (const p of PAGES) {
      const m = chrome[w + '|' + p]; n++;
      const de = p.startsWith('de/');
      if (p !== PAGES[0]) {
        const d = diffs(base, m, { text: 0.5 }, de ? 'notext' : null);
        if (d.length) fail(`chrome ${w} ${p} vs ${PAGES[0]}: ${d.join('; ')}`);
        else if (TABLE) console.log(`ok   chrome ${w} ${p}`);
        if (de) { const t = diffs(base, m, { text: 0.5 }, null).filter((x) => !d.includes(x)); if (t.length) { info++; console.log(`info chrome ${w} ${p} (DE text width, not a fail): ${t.slice(0, 4).join('; ')}${t.length > 4 ? ' ...' : ''}`); } }
      }
      if (w >= 1200 && m.logoOff > 0.5) fail(`chrome ${w} ${p}: logo centre offset ${f1(m.logoOff)} > 0.5 at >=1200`);
      if (w <= 1199 && m.logoOff > 0.5 && p === PAGES[0] && TABLE) console.log(`note chrome ${w}: logo offset ${f1(m.logoOff)} (allowed <=1199, only must be equal across pages)`);
    }
  }
  let safariN = 0;
  if (SAFARI) {
    let saf;
    try { saf = await safariRun(); } catch (e) { console.log('FAIL safari session: ' + e.message); fails++; }
    if (saf) {
      summary('Safari (index)', saf);
      for (const w of WIDTHS) for (const p of PAGES) {
        const s = saf[w + '|' + p], c = chrome[w + '|' + p]; safariN++;
        if (s.cw !== w) { fail(`safari ${w} ${p}: could not reach layout width (clientWidth ${s.cw})`); continue; }
        const d = diffs(c, s, { text: 1 }, null);
        if (d.length) fail(`safari vs chrome ${w} ${p}: ${d.slice(0, 8).join('; ')}${d.length > 8 ? ' ... +' + (d.length - 8) : ''}`);
        else if (TABLE) console.log(`ok   safari ${w} ${p}`);
        if (w >= 1200 && s.logoOff > 0.5) fail(`safari ${w} ${p}: logo centre offset ${f1(s.logoOff)} > 0.5 at >=1200`);
      }
    }
  }
  console.log(`\ncoverage: ${PAGES.length} pages (${PAGES.join(', ')}) x ${WIDTHS.length} widths (${WIDTHS.join(', ')}) x browsers: Chrome ${n}${SAFARI ? ', Safari ' + safariN : ' (Safari not run: pass --safari)'}; info ${info}`);
  console.log(fails ? `header-geometry: FAIL (${fails})` : 'header-geometry: PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
