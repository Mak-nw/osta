#!/usr/bin/env node
/* Poster -> live swap gate (`npm run audit:poster`). Customer 2026-11-14: "перехід через прозорість забери. Баг у тому, що статика розміром БІЛЬШЕ за динаміку і це скаче. Потрібне правило точно однакових розмірів".
   Home / About / Services show a static poster (img[data-hero-poster]) in the first paint; the live three.js canvas replaces it IN ONE FRAME (src/utils/hero-poster.js: no fade). The swap is invisible only when the poster is GEOMETRICALLY the live frame 0. The gate checks that, per page x width x pixel ratio:
     1. BBOX    the bounding box of the drawn content (alpha >= ALPHA) of the poster vs of the live canvas frame 0 (both rendered alone, transparent, reduced motion = the live scene shows exactly frame 0):
                each of the four edges (left, top, right, bottom) differs <= TOL_PX (0.5 css px; = 1 device px at ratio 2, so width/height, which are two edges, may differ by up to 1 css px at ratio 2).
     2. SIZE    the poster bitmap is shown 1:1: naturalWidth/Height = the device size of the <img> layout box (+-1 device px), otherwise the browser resamples it and it differs from the canvas. (The <img> box itself is the scene's WORLD box and may be larger or smaller than the canvas box: only what is DRAWN has to coincide, rule 1.)
     3. PIXELS  D = mean abs. RGB difference (0..255) of the poster alone vs the canvas frame 0 alone, both over mid-grey, over the canvas rectangle; D <= D_MAX. (D_MAX is measured, not guessed: the poster is a lossy webp, so even a perfect copy has D = the webp quantisation noise; D_MAX = 2 x the worst D of the correct posters, see README.)
     4. INSTANT  no opacity / filter transition and no mix-blend-mode on the poster or the canvas, and the real revealLive() shows the canvas (computed opacity 1) and hides the poster in the SAME task.
   Text of a failure is plain Ukrainian ("статика більша за динаміку на N px").
   Matrix (default): pages home, about, services x widths 1920,1728,1440,1280,1024,768,600,375 x ratios 1,2 (= the centres of the poster buckets of tools/gen-posters.cjs; other widths: --widths 1512,1680 show the in-between bucket behaviour).
   Needs the dev server (default http://localhost:5173) and headless Chrome (puppeteer-core, SwiftShader). Exit code != 0 on any FAIL. Viewport heights as in tools/gen-posters.cjs.
   Usage: node tools/poster-swap-gate.cjs [--url ...] [--pages home,about,services] [--widths 1920,375] [--dprs 1,2] [--table] [--break scale=1.03] [--force]
     --break scale=1.03  negative test: the poster is scaled by +3 % (must FAIL);  --table  prints every case with all numbers.
   Not run together with hover-gate / style-gate / pilot (CPU): the script refuses unless --force. */
const cp = require('child_process');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const URL = opt('url', 'http://localhost:5173'), TABLE = !!opt('table', false), BREAK = opt('break', '');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGES = String(opt('pages', 'home,about,services')).split(',');
const WIDTHS = String(opt('widths', '1920,1728,1440,1280,1024,768,600,375')).split(',').map(Number);
const DPRS = String(opt('dprs', '1,2')).split(',').map(Number);
const SCENES = { home: { page: 'index.html', host: '.hero--home [data-hero-scene]' }, about: { page: 'about.html', host: '[data-hero-media]' }, services: { page: 'services.html', host: '[data-hero-scene]' } };
const vpHeight = (w) => (w >= 1200 ? 900 : w >= 768 ? 1024 : 812);   // same as tools/gen-posters.cjs
const TOL_PX = 0.5, ALPHA = Number(process.env.POSTER_ALPHA || 24), D_MAX = Number(process.env.POSTER_D_MAX || 1.0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const others = (() => { try { return cp.execSync("pgrep -f '^node .*(hover-gate|style-gate)[.]cjs' || true", { encoding: 'utf8' }).split('\n').filter(Boolean).join(','); } catch (e) { return ''; } })();
if (others && !opt('force', false)) { console.error('Another hover-gate/style-gate is running (pid ' + others + '). Re-run later or pass --force.'); process.exit(2); }

/** in the scratch page: bbox of alpha >= ALPHA (device px) of each PNG, and D of the two composited over grey, over the clip (device px) */
async function analyse(dec, a, b, clip) {
  return dec.evaluate(async (x, y, clip, ALPHA) => {
    const bm = async (d) => createImageBitmap(await (await fetch('data:image/png;base64,' + d)).blob());
    const ia = await bm(x), ib = await bm(y), W = ia.width, H = ia.height;
    const px = (i) => { const c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0); return g.getImageData(0, 0, W, H).data; };
    const da = px(ia), db = px(ib);
    const [rx0, ry0, rx1, ry1] = clip.map(Math.round);   // only the scene area (the dev review toolbar etc. must not count)
    const box = (d) => { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let yy = Math.max(0, ry0); yy < Math.min(H, ry1); yy++) for (let xx = Math.max(0, rx0); xx < Math.min(W, rx1); xx++) if (d[(yy * W + xx) * 4 + 3] >= ALPHA) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; } return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]; };
    let s = 0, n = 0;
    const over = (d, p) => { const al = d[p + 3] / 255; return [0, 1, 2].map((k) => d[p + k] * al + 128 * (1 - al)); };   // canvas pixels are straight-alpha RGBA from the screenshot
    const [cx0, cy0, cx1, cy1] = clip.map(Math.round);
    for (let yy = Math.max(0, cy0); yy < Math.min(H, cy1); yy++) for (let xx = Math.max(0, cx0); xx < Math.min(W, cx1); xx++) { const p = (yy * W + xx) * 4, u = over(da, p), v = over(db, p); s += (Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1]) + Math.abs(u[2] - v[2])) / 3; n++; }
    return { a: box(da), b: box(db), D: n ? s / n : 0 };
  }, a.toString('base64'), b.toString('base64'), clip, ALPHA);
}

async function runCase(browser, dec, name, w, d) {
  const sc = SCENES[name], h = vpHeight(w);
  const pg = await browser.newPage();
  await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: d });
  await pg.goto(`${URL}/${sc.page}`, { waitUntil: 'networkidle2' });
  await pg.waitForFunction((s) => { const c = document.querySelector(s + ' canvas'); return c && c.classList.contains('is-ready'); }, { timeout: 40000 }, sc.host);
  await sleep(1900);   // title reveal / late refit settle (as in gen-posters)
  const m = await pg.evaluate(async (s, brk) => {
    const host = document.querySelector(s), c = host.querySelector('canvas'), p = host.querySelector('[data-hero-poster]');
    const rc = (r) => [r.left, r.top, r.right, r.bottom];
    // the INSTANT part: the real revealLive on the real elements, reduced to what it must do in one task
    const mod = await import('/src/utils/hero-poster.js');
    p.hidden = false; c.classList.remove('is-ready'); void c.offsetWidth;
    const tr = (e) => { const cs = getComputedStyle(e); return { dur: cs.transitionDuration, blend: cs.mixBlendMode, op: cs.opacity }; };
    const before = { c: tr(c), p: tr(p) };
    mod.revealLive(host, c);
    const after = { canvasReady: c.classList.contains('is-ready'), canvasOpacity: getComputedStyle(c).opacity, posterHidden: p.hidden, posterDisplay: getComputedStyle(p).display, hostClass: host.className };
    p.hidden = false;
    if (brk.startsWith('scale=')) p.style.transform = `scale(${brk.slice(6)})`;
    const out = { img: rc(p.getBoundingClientRect()), canvas: rc(c.getBoundingClientRect()), host: rc(host.getBoundingClientRect()), src: p.currentSrc.split('/').pop(), nat: [p.naturalWidth, p.naturalHeight], cv: [c.width, c.height], before, after, dpr: devicePixelRatio };
    return out;
  }, sc.host, BREAK);
  // make both the live canvas and the poster visible one at a time on a transparent page
  await pg.addStyleTag({ content: `html, body, body *, body *::before, body *::after { background: transparent !important; background-image: none !important; border-color: transparent !important; box-shadow: none !important; } body * { visibility: hidden !important; color: transparent !important; }` });  // visibility only: display changes would move the hero fit (title/chips geometry) and with it the Home scene
  const only = (what) => pg.evaluate((s, what) => {
    const host = document.querySelector(s), c = host.querySelector('canvas'), p = host.querySelector('[data-hero-poster]');
    document.querySelectorAll('#__review-host').forEach((e) => e.remove());   // the dev review toolbar is not part of the page: it must not show up in the shots
    c.style.cssText = 'opacity:1!important;transition:none!important;visibility:' + (what === 'canvas' ? 'visible' : 'hidden') + '!important';
    p.hidden = false; p.style.setProperty('visibility', what === 'poster' ? 'visible' : 'hidden', 'important'); p.style.setProperty('transition', 'none', 'important');
  }, sc.host, what);
  await only('poster'); await sleep(150);
  const A = await pg.screenshot({ omitBackground: true, type: 'png' });
  await only('canvas'); await sleep(150);
  const B = await pg.screenshot({ omitBackground: true, type: 'png' });
  if (process.env.GATE_DUMP) { require('fs').writeFileSync(`${process.env.GATE_DUMP}/${name}-${w}-${d}-poster.png`, A); require('fs').writeFileSync(`${process.env.GATE_DUMP}/${name}-${w}-${d}-live.png`, B); }
  await pg.close();
  const cl = m.canvas.map((v) => v * d);   // only the canvas rectangle is compared: that is exactly the area the swap can change (the poster is clipped by the host there; anything outside is the page itself)
  const an = await analyse(dec, A, B, cl);
  const css = (bx) => bx && { l: bx[0] / d, t: bx[1] / d, w: (bx[2] - bx[0]) / d, h: (bx[3] - bx[1]) / d };
  const P = css(an.a), L = css(an.b);
  return { m, P, L, D: an.D };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars'] });
  const dec = await browser.newPage(); await dec.goto('about:blank');
  let fail = 0, n = 0, worstD = 0;
  for (const name of PAGES) for (const w of WIDTHS) for (const d of DPRS) {
    let r;
    try { r = await runCase(browser, dec, name, w, d); } catch (e) { console.error(`${name} ${w}@${d}: ПОМИЛКА ${e.message}`); fail++; continue; }
    n++;
    const { m, P, L } = r, why = [];
    const tag = `${name.padEnd(8)} ${String(w).padStart(4)}@${d}`;
    if (!P || !L) { why.push(!P ? 'постер порожній (немає видимого вмісту)' : 'жива сцена порожня'); }
    else {
      // the four EDGES of the drawn content (left, top, right, bottom), each in css px; a 1-device-pixel edge is 0.5 css px at ratio 2, so width/height (= two edges) may differ by up to 1 css px at ratio 2 and still mean "every edge within 0.5 px"
      const e = { 'ліво': P.l - L.l, 'верх': P.t - L.t, 'право': (P.l + P.w) - (L.l + L.w), 'низ': (P.t + P.h) - (L.t + L.h) };
      const grow = { 'ліво': -e['ліво'], 'верх': -e['верх'], 'право': e['право'], 'низ': e['низ'] };   // > 0: the poster sticks out further than the live scene on that side
      const bad = Object.entries(grow).filter(([, v]) => Math.abs(v) > TOL_PX);
      const big = bad.filter(([, v]) => v > 0), small = bad.filter(([, v]) => v < 0);
      if (big.length) why.push(`статика більша за динаміку: ${big.map(([k, v]) => `${k} на ${v.toFixed(1)} px`).join(', ')} (постер ${P.w.toFixed(1)}x${P.h.toFixed(1)}, жива ${L.w.toFixed(1)}x${L.h.toFixed(1)})`);
      if (small.length) why.push(`статика менша за динаміку: ${small.map(([k, v]) => `${k} на ${(-v).toFixed(1)} px`).join(', ')} (постер ${P.w.toFixed(1)}x${P.h.toFixed(1)}, жива ${L.w.toFixed(1)}x${L.h.toFixed(1)})`);
    }
    const iw = m.img[2] - m.img[0], ih = m.img[3] - m.img[1];
    // bitmap shown 1:1: natural size equals the device size of the layout box (+-1 device px)
    const wantW = Math.round(m.img[2] * d) - Math.round(m.img[0] * d), wantH = Math.round(m.img[3] * d) - Math.round(m.img[1] * d);
    if (Math.abs(m.nat[0] - wantW) > 1 || Math.abs(m.nat[1] - wantH) > 1) why.push(`картинка постера ${m.nat[0]}x${m.nat[1]} фіз.px розтягується до ${wantW}x${wantH} (файл ${m.src}): браузер її перемасштабує`);
    const cw = m.canvas[2] - m.canvas[0], chh = m.canvas[3] - m.canvas[1];
    if (r.D > D_MAX) why.push(`піксельна різниця D=${r.D.toFixed(2)} > ${D_MAX}`);
    const ok1 = (t) => t.dur.split(',').every((x) => parseFloat(x) === 0) && t.blend === 'normal';
    if (!ok1(m.before.c) || !ok1(m.before.p)) why.push(`є перехід/змішування: canvas ${m.before.c.dur}/${m.before.c.blend}, постер ${m.before.p.dur}/${m.before.p.blend} (заміна має бути миттєвою)`);
    if (!m.after.canvasReady || m.after.canvasOpacity !== '1' || !m.after.posterHidden || /is-handover/.test(m.after.hostClass)) why.push('заміна не одним кадром: після revealLive canvas не повністю видимий або постер не прихований');
    if (r.D > worstD) worstD = r.D;
    const ok = !why.length;
    if (!ok) fail++;
    const f = (v) => (v == null ? '-' : v.toFixed(1));
    if (TABLE || !ok) console.log(`${ok ? 'PASS' : 'FAIL'}  ${tag} | постер ${P ? `${f(P.w)}x${f(P.h)} @${f(P.l)},${f(P.t)}` : '-'} | жива ${L ? `${f(L.w)}x${f(L.h)} @${f(L.l)},${f(L.t)}` : '-'} | dW ${P && L ? (P.w - L.w).toFixed(1) : '-'} dH ${P && L ? (P.h - L.h).toFixed(1) : '-'} dL ${P && L ? (P.l - L.l).toFixed(1) : '-'} dT ${P && L ? (P.t - L.t).toFixed(1) : '-'} | img ${iw.toFixed(1)}x${ih.toFixed(1)} @${m.img[0].toFixed(1)},${m.img[1].toFixed(1)} canvas ${cw.toFixed(1)}x${chh.toFixed(1)} | D ${r.D.toFixed(2)} | ${m.src}`);
    else console.log(`PASS  ${tag} | dW ${(P.w - L.w).toFixed(1)} dH ${(P.h - L.h).toFixed(1)} dL ${(P.l - L.l).toFixed(1)} dT ${(P.t - L.t).toFixed(1)} | D ${r.D.toFixed(2)}`);
    why.forEach((x) => console.log('      - ' + x));
  }
  await browser.close();
  console.log(fail ? `\n${fail} FAIL з ${n}` : `\nALL PASS (${n} cases, max D ${worstD.toFixed(2)}, допуск bbox ${TOL_PX} px, D ≤ ${D_MAX})`);
  process.exit(fail ? 1 : 0);
})();
