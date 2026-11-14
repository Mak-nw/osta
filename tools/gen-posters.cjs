/**
 * gen-posters.cjs — `npm run poster`: generates the STATIC POSTERS of the above-the-fold WebGL hero scenes (frame 0 of each scene) into public/assets/img/hero-poster-{home,about,services}-{width}-{dpr}.webp (one file per viewport-width bucket x pixel-ratio class, see BUCKETS) and rewrites the <picture> block of each page.
 * WHY BUCKETS: the live scene draws 1-device-pixel lines and fixed-size dots, so its look depends on the on-screen size and the pixel ratio. A poster is a bitmap: it matches the live frame only when it was rendered at the SAME css size and pixel ratio it is shown at. Each poster is therefore rendered at the real viewport of its bucket (centre width) and ratio class and picked by media queries (width range + resolution).
 * The page shows the poster in its first paint (img[data-hero-poster] in a <picture>); the live canvas replaces it in ONE frame (no fade) with its clock reset to 0 (src/utils/hero-poster.js). Component rules: components/hero.css ("HERO POSTER").
 * Method (deterministic): headless Chrome (SwiftShader) opens the page with prefers-reduced-motion (the live scene then shows exactly frame 0 and never starts its clock), waits for the live canvas,
 * hides everything except the canvas, makes the page transparent and takes a transparent PNG of the scene's WORLD BOX at devicePixelRatio 2, then encodes webp (alpha, lossy, quality lowered until <= MAX_KB).
 *   home      square, half-extent 4.5/2 world units around the scene centre (fit unit read from host.__heroScene.fit); white dots on transparent => over the hero blue
 *   about     square, half-extent 1.2 world units around the globe centre (= 1.0625 * smaller side of the zone); ink = --accent on transparent => over the light hero surface
 *   services  the drawing's half-extent box (+2 %), ratio hx/hy printed below; ink = --accent on transparent. (ISO labels and the px-chosen markers are NOT in the poster: they fade in with the live scene.)
 * Usage: `node tools/gen-posters.cjs [--url http://localhost:5173] [--only home,about,services] [--widths 375,1440] [--dprs 1,2]` (without --widths/--dprs: every bucket; --only/--widths/--dprs rewrite the <picture> from ALL files present on disk). The dev server must be running. After a scene change re-run it; the CSS constants it prints must equal the ones in components/hero.css
 * (the script checks them and exits 1 on a mismatch). Output sizes are printed (budget <= 160 KB each: the ladder stops at the first file under it, so small posters stay far below).
 */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://localhost:5173'), ONLY = arg('--only', 'home,about,services').split(',');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'img'), ROOT = path.join(__dirname, '..'), CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'components', 'hero.css'), 'utf8');
const MAX_KB = 160, HOME_SPAN = 4.5, ABOUT_HALF = 1.2, SVC_MARGIN = 1.02, SVC_PAD = 0.07;
/** viewport-width buckets: `w` = the width the poster is rendered at (bucket centre), [min, max] = the widths it is shown at; dprs = pixel-ratio classes (live scenes cap the canvas ratio at 2 on >= 1200 px and at 1.5 below, utils/dpr.js; below 1200 px the classes 2 and 3 are rendered at the real device ratio on purpose: the poster then contains the SAME browser up-scaling of the 1.5 canvas that the live canvas gets on such a screen) */
const BUCKETS = [
  { w: 375, min: 0, max: 479, dprs: [1, 1.5, 2, 3] }, { w: 600, min: 480, max: 679, dprs: [1, 1.5, 2, 3] }, { w: 768, min: 680, max: 899, dprs: [1, 1.5, 2] }, { w: 1024, min: 900, max: 1199, dprs: [1, 1.5, 2] },
  { w: 1280, min: 1200, max: 1359, dprs: [1, 1.5, 2] }, { w: 1440, min: 1360, max: 1599, dprs: [1, 1.5, 2] }, { w: 1728, min: 1600, max: 1799, dprs: [1, 1.5, 2] }, { w: 1920, min: 1800, max: 99999, dprs: [1, 1.5, 2] },
];
/* ratio class 3 only for phone widths (tablets are 2x at most) */
const MIN_RES = { 1: 0, 1.5: 1.25, 2: 1.75, 3: 2.5 };   // a device with ratio >= this value takes the poster of that class (the highest matching class wins; media queries are ordered high -> low)
const vpHeight = (w) => (w >= 1200 ? 900 : w >= 768 ? 1024 : 812);   // the gate (tools/poster-swap-gate.cjs) uses the same
const SCENES = {
  home: { page: 'index.html', host: '.hero--home [data-hero-scene]' },
  about: { page: 'about.html', host: '[data-hero-media]' },
  services: { page: 'services.html', host: '[data-hero-scene]' },
};
const fileOf = (name, w, d) => `hero-poster-${name}-${w}-${String(d).replace('.', '_')}.webp`;
const ISOLATE = 'html, body, body * { background: transparent !important; background-image: none !important; } body * { visibility: hidden !important; } canvas { visibility: visible !important; opacity: 1 !important; transition: none !important; } [data-hero-poster] { display: none !important; }';
const WANT_W = (arg('--widths', '') || '').split(',').filter(Boolean).map(Number), WANT_D = (arg('--dprs', '') || '').split(',').filter(Boolean).map(Number);

/** one picture: the poster of this scene at this viewport width and ratio class; returns { info, res } */
async function render(browser, name, w, dpr) {
  const sc = SCENES[name], h = vpHeight(w);
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  await page.goto(`${URL}/${sc.page}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction((sel) => { const h = document.querySelector(sel); const c = h && h.querySelector('canvas'); return c && c.classList.contains('is-ready'); }, { timeout: 30000 }, sc.host);
  await new Promise((r) => setTimeout(r, 1900));   // title reveal / late refit (1.6 s) settle
  // the box the <img> really gets: its own layout rectangle (un-hide it for a moment; measured BEFORE the isolation style hides it for good)
  const posterBox = await page.evaluate((sel) => { const p = document.querySelector(sel).querySelector('[data-hero-poster]'), was = p.hidden; p.hidden = false; const r = p.getBoundingClientRect(); p.hidden = was; return [r.left, r.top, r.right, r.bottom]; }, sc.host);
  await page.evaluate(() => document.querySelectorAll('#__review-host').forEach((e) => e.remove()));   // the dev review toolbar (light DOM child of <html>, not hidden by ISOLATE) must never get baked into a poster
  await page.addStyleTag({ content: ISOLATE });
  await new Promise((r) => setTimeout(r, 300));
  const info = await page.evaluate((sel, n, C) => {
    const h = document.querySelector(sel), r = h.getBoundingClientRect(), mn = Math.min(r.width, r.height), s = h.__heroScene;
    if (n === 'home') { const f = s.fit; return { cx: f.cx, cy: f.cy + 0, side: C.HOME_SPAN * f.unit, unit: f.unit }; }
    const pr = { left: C.box[0], top: C.box[1], right: C.box[2], bottom: C.box[3], width: C.box[2] - C.box[0], height: C.box[3] - C.box[1] };   // the world-box maths below only supplies the Services ratio
    if (n === 'about') return { cx: pr.left + pr.width / 2, cy: pr.top + pr.height / 2, side: pr.width, box: [pr.left, pr.top, pr.right, pr.bottom], formula: 2 * C.ABOUT_HALF * 0.4427 * mn };
    const [hx, hy] = s.info.half, unit = Math.min((r.width / 2 - C.PAD * mn) / hx, (r.height / 2 - C.PAD * mn) / hy);
    return { cx: pr.left + pr.width / 2, cy: pr.top + pr.height / 2, w: pr.width, h: pr.height, box: [pr.left, pr.top, pr.right, pr.bottom], formula: [2 * C.MARGIN * hx * unit, 2 * C.MARGIN * hy * unit], ratio: hx / hy };
  }, sc.host, name, { HOME_SPAN, ABOUT_HALF, MARGIN: SVC_MARGIN, PAD: SVC_PAD, box: posterBox });
  const bw = info.w || info.side, bh = info.h || info.side;
  // the poster <img> is painted pixel-snapped; the clip is that snapped rectangle in device pixels, so the bitmap is shown 1:1 (no resampling, no sub-pixel shift against the live canvas)
  // device-pixel rectangle of the <img> as Chrome paints it (edges rounded to whole device pixels): the bitmap must be EXACTLY that size, shown 1:1.
  // page.screenshot rounds fractional clips by its own rules (off by one pixel), so the screenshot takes a whole-css-pixel box (even numbers: whole device pixels at ratio 1.5) around it and the exact crop is cut out below.
  const bx = info.box || [info.cx - bw / 2, info.cy - bh / 2, info.cx + bw / 2, info.cy + bh / 2];
  const dev = [Math.round(bx[0] * dpr), Math.round(bx[1] * dpr), Math.round(bx[2] * dpr), Math.round(bx[3] * dpr)];
  // The live canvas covers ONLY the host rectangle; the poster's world box can be larger (stacked layouts: the box sticks out of the host and even out of the viewport, where a screenshot is blank).
  // So: screenshot the host rectangle (whole device pixels, always inside the viewport) and paste it into a transparent bitmap of the world box at its true offset. Outside the host the live scene draws nothing either.
  const hostR = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, sc.host);
  const hdev = [Math.round(hostR[0] * dpr), Math.round(hostR[1] * dpr), Math.round(hostR[2] * dpr), Math.round(hostR[3] * dpr)];
  const ix0 = Math.max(dev[0], hdev[0]), iy0 = Math.max(dev[1], hdev[1]), ix1 = Math.min(dev[2], hdev[2]), iy1 = Math.min(dev[3], hdev[3]);   // box ∩ host, device px
  const ox = Math.floor(ix0 / dpr / 2) * 2, oy = Math.floor(iy0 / dpr / 2) * 2, ow = Math.ceil((ix1 / dpr - ox) / 2) * 2, oh = Math.ceil((iy1 / dpr - oy) / 2) * 2;
  const shot = await page.screenshot({ clip: { x: ox, y: oy, width: ow, height: oh }, omitBackground: true, type: 'png' });
  const crop = [Math.round(ix0 - ox * dpr), Math.round(iy0 - oy * dpr), ix1 - ix0, iy1 - iy0, ix0 - dev[0], iy0 - dev[1], dev[2] - dev[0], dev[3] - dev[1]];   // [sx, sy, sw, sh, dx, dy, total w, total h]
  const cutter = await browser.newPage(); await cutter.goto('about:blank');
  const cutB64 = await cutter.evaluate(async (b64, c) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = new OffscreenCanvas(c[6], c[7]); cv.getContext('2d').drawImage(bmp, c[0], c[1], c[2], c[3], c[4], c[5], c[2], c[3]);
    const blob = await cv.convertToBlob({ type: 'image/png' }); const buf = new Uint8Array(await blob.arrayBuffer()); let t = ''; for (let i = 0; i < buf.length; i += 8192) t += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(t);
  }, shot.toString('base64'), crop);
  await cutter.close();
  const png = Buffer.from(cutB64, 'base64');
  if (process.env.POSTER_PNG_DIR) fs.writeFileSync(path.join(process.env.POSTER_PNG_DIR, fileOf(name, w, dpr).replace('.webp', '.png')), png);
  await page.close();
  // encode: `cwebp` (libwebp, `brew install webp`) with the alpha quality lowered until <= MAX_KB; without it Chrome's own encoder (alpha is lossless there, so bigger files)
  const outFile = path.join(OUT, fileOf(name, w, dpr)), tmpPng = path.join(os.tmpdir(), `hero-poster-${name}.png`);
  let res = null;
  try {
    fs.writeFileSync(tmpPng, png);
    for (const [q, aq] of [[90, 100], [85, 100], [80, 100], [70, 100], [60, 100], [50, 100], [40, 100], [30, 100], [20, 100]]) {   // quality ladder: LOSSLESS alpha first (a lossy alpha moves the 1-device-pixel edge of the drawing = the geometry the swap gate measures), colour q90 down to q40; only then the alpha quality
      cp.execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', String(aq), '-m', '6', tmpPng, '-o', outFile]);
      const kb = fs.statSync(outFile).size / 1024; res = { kb, q: `cwebp q${q} alpha_q${aq}`, ...pngSize(png) };
      if (kb <= MAX_KB) break;
    }
  } catch (e) { res = null; }
  if (!res) {
    const enc = await browser.newPage();
    await enc.goto('about:blank');
    const r = await enc.evaluate(async (b64, maxKb) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height); cv.getContext('2d').drawImage(bmp, 0, 0);
      let q = 0.95, blob;
      for (; q >= 0.3; q -= 0.05) { blob = await cv.convertToBlob({ type: 'image/webp', quality: q }); if (blob.size <= maxKb * 1024) break; }
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
      return { b64: btoa(s), q: 'chrome q' + q.toFixed(2), kb: blob.size / 1024, w: bmp.width, h: bmp.height };
    }, png.toString('base64'), MAX_KB);
    await enc.close();
    fs.writeFileSync(outFile, Buffer.from(r.b64, 'base64')); res = r;
  }
  return { info, res };
}

/** <picture> of a scene from the files on disk: media = width range + resolution class, ordered high ratio first; the fallback <img> is the 1440 / ratio 1 file */
function pictureOf(name, attrs) {
  const src = [];
  for (const b of [...BUCKETS].reverse()) {
    for (const d of [...b.dprs].reverse()) {
      if (!fs.existsSync(path.join(OUT, fileOf(name, b.w, d)))) continue;
      const q = [b.min ? `(min-width: ${b.min}px)` : '', b.max < 99999 ? `(max-width: ${b.max}px)` : '', MIN_RES[d] ? `(min-resolution: ${MIN_RES[d]}dppx)` : ''].filter(Boolean);
      src.push(`<source media="${q.join(' and ') || 'all'}" srcset="/assets/img/${fileOf(name, b.w, d)}">`);
    }
  }
  // sources are tried in document order: for one width range the higher ratio class has to come first (done above); the `all` fallthrough of a range is its ratio-1 file (a device of any ratio matches `min-resolution: 0`)
  return `<picture data-hero-picture>${src.join('')}<img data-hero-poster data-poster="${name}" src="/assets/img/${fileOf(name, 1440, 1)}" alt="" ${attrs} fetchpriority="high" decoding="async"></picture>`;
}

function rewriteHtml(name) {
  const f = path.join(ROOT, SCENES[name].page);
  let html = fs.readFileSync(f, 'utf8');
  const m = html.match(/<picture data-hero-picture>[\s\S]*?<\/picture>|<img data-hero-poster[^>]*>/);
  if (!m) { console.error(`  ${SCENES[name].page}: no poster element found`); return false; }
  const attrOf = (a) => (m[0].match(new RegExp(`${a}="([^"]*)"`)) || [])[1];
  const attrs = `width="${attrOf('width')}" height="${attrOf('height')}"`;
  html = html.replace(m[0], pictureOf(name, attrs));
  // the single-file <link rel=preload> of the old scheme is gone: the <img> is in the first bytes of <body>, the preload scanner picks the matching <source> there
  html = html.replace(/\s*<link rel="preload" as="image" type="image\/webp" href="\/assets\/img\/hero-poster-[a-z]+\.webp" fetchpriority="high">/, '');
  fs.writeFileSync(f, html);
  return true;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars'] });
  let bad = 0;
  for (const name of ONLY) {
    if (!SCENES[name]) { console.error('unknown scene', name); bad++; continue; }
    let ratio = null;
    for (const b of BUCKETS) {
      if (WANT_W.length && !WANT_W.includes(b.w)) continue;
      for (const d of b.dprs) {
        if (WANT_D.length && !WANT_D.includes(d)) continue;
        let r;
        try { r = await render(browser, name, b.w, d); } catch (e) { console.error(`${name} ${b.w}@${d}: ${e.message}`); bad++; continue; }
        console.log(`${name} ${b.w}@${d}: ${r.res.w}x${r.res.h}px webp (${r.res.q}) ${r.res.kb.toFixed(1)} KB` + (r.res.kb > MAX_KB ? '  OVER BUDGET' : ''));
        if (r.res.kb > MAX_KB) bad++;
        if (name === 'services') ratio = r.info.ratio;
      }
    }
    if (name === 'services' && ratio !== null) {
      console.log(`  services ratio hx/hy = ${ratio.toFixed(4)}`);
      if (!CSS.includes(`--poster-ratio: ${ratio.toFixed(2)}`)) { console.error(`  CSS constant mismatch: set --poster-ratio: ${ratio.toFixed(2)} in components/hero.css`); bad++; }
    }
    if (!rewriteHtml(name)) bad++;
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
