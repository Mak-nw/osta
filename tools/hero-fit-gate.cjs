#!/usr/bin/env node
/* Hero fit gate (`npm run audit:hero-fit`). Customer 2026-11-14: the hero of every page fits ONE screen, CTA included, at every size.
   For each page with a hero (index, about, services; the short text hero faq too; 404 is an error page with a button list, not a hero scene, so it is not gated) at the viewport matrix
   375x667 390x844 768x1024 834x1112 1024x768 1100x760 1180x820 1199x700 1280x720 1440x900 1920x1080 (+ --extra: heights 568-1200 at widths 320-1920):
   FAIL if hero bottom > innerHeight, or the last button of the hero bottom > innerHeight, or horizontal overflow (scrollWidth > clientWidth).
   Pages without a hero band (catalog, contact, product, hubs use .product-hero, legal) are not full-screen heroes: catalog/contact have none; the others are short blocks, covered by the same rule when listed in PAGES.
   Needs the dev server (default http://localhost:5173) and headless Chrome (puppeteer-core). Not run together with other gates (CPU): refuses unless --force.
   Usage: node tools/hero-fit-gate.cjs [--url ...] [--pages index,about] [--extra] [--table] [--force] */
const cp = require('child_process');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const URL = opt('url', 'http://localhost:5173'), TABLE = !!opt('table', false);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGES = String(opt('pages', 'index,about,services,faq')).split(',');
let MATRIX = [[375, 667], [390, 844], [768, 1024], [834, 1112], [1024, 768], [1100, 760], [1180, 820], [1199, 700], [1280, 720], [1440, 900], [1920, 1080]];
if (opt('extra', false)) { MATRIX = []; for (const w of [320, 375, 414, 600, 768, 900, 1024, 1199, 1200, 1366, 1600, 1920]) for (const h of [568, 640, 700, 768, 900, 1024, 1200]) MATRIX.push([w, h]); }
const others = (() => { try { return cp.execSync("pgrep -f '^node .*(hover-gate|style-gate|poster-swap|grid-snap)[.]cjs' || true", { encoding: 'utf8' }).split('\n').filter(Boolean).join(','); } catch (e) { return ''; } })();
if (others && !opt('force', false)) { console.error('Another gate is running (pid ' + others + '). Re-run later or pass --force.'); process.exit(2); }
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0, n = 0;
  for (const p of PAGES) {
    const pg = await browser.newPage();
    for (const [w, h] of MATRIX) {
      await pg.setViewport({ width: w, height: h });
      for (let t = 0; ; t++) { try { await pg.goto(URL + '/' + p + '.html', { waitUntil: 'domcontentloaded' }); break; } catch (e) { if (t >= 2) throw e; await new Promise((r) => setTimeout(r, 1000)); } }   // the dev server may reload the page (HMR): retry
      await pg.evaluate(async () => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); await document.fonts.ready; });
      await new Promise((r) => setTimeout(r, 500));
      const r = await pg.evaluate(() => {
        const hero = document.querySelector('.hero, .legal__hero, .product-hero'); if (!hero) return null;
        const btns = hero.querySelectorAll('.btn, a[class*="btn"]'), last = btns[btns.length - 1], R = (e) => e.getBoundingClientRect();
        return { hero: Math.round(R(hero).bottom), cta: last ? Math.round(R(last).bottom) : 0, ih: innerHeight, ow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      n++;
      if (!r) { console.log('FAIL ' + p + ' ' + w + 'x' + h + ': no hero found'); fails++; continue; }
      const bad = r.hero > r.ih || r.cta > r.ih || r.ow;
      if (bad) { fails++; console.log('FAIL ' + p + ' ' + w + 'x' + h + ': hero bottom ' + r.hero + ', CTA bottom ' + r.cta + ' > ' + r.ih + (r.ow ? ', horizontal overflow' : '')); }
      else if (TABLE) console.log('ok   ' + p + ' ' + w + 'x' + h + ': hero ' + r.hero + ', CTA ' + r.cta + ' <= ' + r.ih);
    }
    await pg.close();
  }
  await browser.close();
  console.log(fails ? 'hero-fit: FAIL (' + fails + ' of ' + n + ')' : 'hero-fit: PASS (' + n + ' cases)');
  process.exit(fails ? 1 : 0);
})();
