#!/usr/bin/env node
/* Scroll-trap gate (`npm run audit:scroll-trap`). Rule U10: a form field (input, select, textarea) never traps the page scroll.
   For EVERY root page (*.html) with a visible field, at desktop 1440x900, tablet 820x1180 (mouse wheel) and mobile 375x812 (touch emulation, CDP Input.synthesizeScrollGesture),
   with the pointer/finger started over each field (a textarea twice: empty, and filled with long text so it overflows):
   - empty / content-fits field: window.scrollY must change in the gesture direction (when the page can scroll);
   - overflowing textarea: it may scroll itself first, but after its scroll end the page must scroll (chaining);
   - no wheel/touchmove/mousewheel event over a field may be preventDefault-ed except by the Lenis smooth-scroll itself (which then scrolls the page: covered by the scrollY check).
   Needs the dev server (default http://localhost:5173) and headless Chrome (puppeteer-core). Refuses to run next to other gates unless --force.
   Usage: node tools/scroll-trap-gate.cjs [--url ...] [--pages contact,index] [--table] [--force] */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const URL = opt('url', 'http://localhost:5173'), TABLE = !!opt('table', false);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const ALL = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
const PAGES = opt('pages', false) ? String(opt('pages')).split(',') : ALL;
const others = (() => { try { return cp.execSync("pgrep -f '^node .*(hover-gate|style-gate|poster-swap|grid-snap|hero-fit|header-geo|icon-|card-row)' || true", { encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { return []; } })();
if (others.length && !opt('force', false)) { console.error('Another gate is running (pid ' + others + '). Re-run later or pass --force.'); process.exit(2); }
const VIEWS = [{ n: 'desktop 1440x900', w: 1440, h: 900, touch: false }, { n: 'tablet 820x1180', w: 820, h: 1180, touch: false }, { n: 'mobile 375x812 touch', w: 375, h: 812, touch: true }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG = Array.from({ length: 80 }, (_, i) => 'Line ' + (i + 1) + ' of a very long message').join('\n');
const SEL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0, n = 0; const cov = new Set(); const lines = [];
  const rec = (ok, msg) => { n++; if (!ok) { fails++; lines.push('FAIL ' + msg); } else if (TABLE) lines.push('ok   ' + msg); };
  for (const p of PAGES) for (const v of VIEWS) for (let attempt = 0; attempt < 3; attempt++) {
    const sv = { fails, n, lines: lines.length, cov: [...cov] };
    const pg = await browser.newPage();
    try {
    await pg.setViewport({ width: v.w, height: v.h, hasTouch: v.touch, isMobile: v.touch, deviceScaleFactor: 1 });
    await pg.evaluateOnNewDocument(() => {
      window.__pd = [];
      const orig = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function () {
        if (this.cancelable && /^(wheel|mousewheel|touchmove)$/.test(this.type) && this.target && this.target.closest && this.target.closest('input, select, textarea')) {
          const st = new Error().stack || '';
          if (!/lenis/i.test(st)) window.__pd.push(this.type + ' on ' + (this.target.id || this.target.tagName) + ' @ ' + st.split('\n').slice(2, 4).join(' | ').slice(0, 160));
        }
        return orig.apply(this, arguments);
      };
    });
    try { await pg.goto(URL + '/' + p + '.html', { waitUntil: 'networkidle2', timeout: 60000 }); } catch (e) { rec(false, p + ' ' + v.n + ': load ' + e.message); await pg.close(); break; }
    await pg.evaluate(async () => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); await document.fonts.ready; });
    await sleep(2200);
    const count = await pg.evaluate((sel) => [...document.querySelectorAll(sel)].map((f, i) => { const r = f.getBoundingClientRect(); const cs = getComputedStyle(f); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' ? { i, tag: f.tagName.toLowerCase(), id: f.id || f.name || f.type || '' } : null; }).filter(Boolean), SEL);
    const cdp = await pg.target().createCDPSession();
    for (const f of count) {
      const variants = f.tag === 'textarea' ? ['empty', 'long'] : ['plain'];
      for (const variant of variants) for (const focused of [false, true]) for (const want of [1, -1]) {
        const label = p + ' ' + v.n + ' ' + f.tag + '#' + f.id + ' (' + variant + (focused ? ', focused' : '') + ', ' + (want > 0 ? 'down' : 'up') + ')';
        cov.add(p + '|' + f.tag + f.id + '|' + v.n + '|' + variant + focused + want);
        await pg.evaluate((sel, i, variant, LONG, focused) => {
          const el = document.querySelectorAll(sel)[i];
          if (el.tagName === 'TEXTAREA') { el.value = variant === 'long' ? LONG : ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.scrollTop = want0(variant); }
          function want0() { return 0; }
          if (focused) el.focus({ preventScroll: true }); else el.blur();
        }, SEL, f.i, variant, LONG, focused);
        const max = await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        if (max < 40) { rec(true, label + ': page cannot scroll (skipped)'); continue; }
        // Put the field in the viewport middle; the page must have room in the wheel direction (down: not at the bottom, up: not at the top).
        const room = await pg.evaluate((sel, i, want) => {
          const el = document.querySelectorAll(sel)[i]; const r = el.getBoundingClientRect();
          const m = document.documentElement.scrollHeight - innerHeight;
          const target = Math.max(0, Math.min(scrollY + r.top - innerHeight / 2, m));
          (window.lenis && window.lenis.scrollTo) ? window.lenis.scrollTo(target, { immediate: true, force: true }) : window.scrollTo(0, target);
          return want > 0 ? target + 40 < m : target > 40;
        }, SEL, f.i, want);
        await sleep(500);
        if (!room) { rec(true, label + ': no page room in that direction (skipped)'); continue; }
        const box = await pg.evaluate((sel, i) => { const el = document.querySelectorAll(sel)[i]; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: Math.min(Math.max(r.y + r.height / 2, 2), innerHeight - 2), top: r.top, bottom: r.bottom, ih: innerHeight, sy: scrollY }; }, SEL, f.i);
        if (box.top > box.ih || box.bottom < 0) { rec(false, label + ': field not reachable in viewport'); continue; }
        if (variant === 'long' && want < 0) await pg.evaluate((sel, i) => { const el = document.querySelectorAll(sel)[i]; el.scrollTop = 0; }, SEL, f.i);
        const y0 = box.sy; let changed = false; const tries = variant === 'long' ? 14 : 3;
        await pg.mouse.move(box.x, box.y);
        for (let t = 0; t < tries && !changed; t++) {
          if (v.touch) await cdp.send('Input.synthesizeScrollGesture', { x: box.x, y: box.y, yDistance: -want * 300, gestureSourceType: 'touch', speed: 1200 });
          else await pg.mouse.wheel({ deltaY: want * 300 });
          await sleep(variant === 'long' ? 700 : 1300);
          const y1 = await pg.evaluate(() => scrollY);
          if (Math.sign(y1 - y0) === want) changed = true;
        }
        const y1 = await pg.evaluate(() => scrollY);
        const info = await pg.evaluate((sel, i) => { const el = document.querySelectorAll(sel)[i]; return { st: el.scrollTop, hh: el.scrollHeight - el.clientHeight, pd: window.__pd.slice() }; }, SEL, f.i);
        let ok = changed, why = changed ? '' : 'scrollY did not change in wheel/touch direction (' + y0 + ' -> ' + y1 + ')';
        if (ok && variant === 'long' && info.hh > 2) { const atEnd = want > 0 ? info.st >= info.hh - 2 : info.st <= 2; if (!atEnd) { ok = false; why = 'page scrolled before the textarea reached its end'; } }
        if (info.pd.length) { ok = false; why += (why ? '; ' : '') + 'preventDefault on ' + info.pd[0]; }
        rec(ok, label + (ok ? ': scrollY ' + y0 + ' -> ' + y1 : ': ' + why));
      }
    }
    await pg.close();
    } catch (e) { // page navigated/reloaded under us (dev-server HMR, other agents editing): drop this attempt's results and rerun the view
      await pg.close().catch(() => {}); fails = sv.fails; n = sv.n; lines.length = sv.lines; cov.clear(); sv.cov.forEach((c) => cov.add(c));
      if (attempt === 2) rec(/detached|context was destroyed|navigat/i.test(e.message), p + ' ' + v.n + ': ' + (/detached|context was destroyed|navigat/i.test(e.message) ? 'page navigated/reloaded under the gesture 3 times (inconclusive, not a scroll trap): ' : '') + e.message);
      else continue;
    }
    break;
  }
  await browser.close();
  console.log(lines.join('\n'));
  const pagesWith = new Set([...cov].map((c) => c.split('|')[0])), fieldsN = new Set([...cov].map((c) => c.split('|')[0] + c.split('|')[1])).size;
  console.log('coverage: ' + pagesWith.size + ' pages with fields (' + [...pagesWith].join(',') + '), ' + fieldsN + ' fields, ' + VIEWS.length + ' viewports, ' + cov.size + ' field-states');
  console.log(fails ? 'scroll-trap: FAIL (' + fails + ' of ' + n + ')' : 'scroll-trap: PASS (' + n + ' cases)');
  process.exit(fails ? 1 : 0);
})();
