/* Shared runner for the icon gates (ICON-A..D): opens every page at every width in headless Chrome, freezes reveal animations, waits for fonts,
   runs `fn` in the page and collects its result. Usage by tools/icon-box-gate.cjs and tools/icon-text-align-gate.cjs. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
exports.ROOT = ROOT;
exports.parse = (argv) => {
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
  const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
  const sel = String(opt('pages', 'all'));
  /* generated pages (product / category hub) exist only in the build: samples of each type are served from dist by `vite preview` (base /osta/) */
  const samples = ['products/azithromycin/', 'products/category/api/'];
  return { URL: opt('url', 'http://localhost:5173').replace(/\/$/, ''), PREVIEW: opt('preview', 'http://localhost:4175/osta').replace(/\/$/, ''), WIDTHS: String(opt('widths', '375,768,1024,1440,1920')).split(',').map(Number),
    PAGES: sel === 'all' ? [...all, ...samples] : sel.split(','), TOL: Number(opt('tol', 1)), opt };
};
exports.guardParallel = () => {
  try { const out = cp.execSync("pgrep -f '^node .*(hover-gate|style-gate|poster-swap|grid-snap|hero-fit|header-geo|icon-box|icon-text)'", { encoding: 'utf8' }).split('\n').filter(Boolean).filter((p) => Number(p) !== process.pid);
    if (out.length) { console.error('another gate is running (pid ' + out.join(',') + '): not running two gates in parallel'); process.exit(3); } } catch (e) { /* no match */ }
};
exports.run = async (cfg, fn, fnCfg) => {
  let own = null; const gen = cfg.PAGES.some((p) => p.includes('/'));
  if (gen) { const up = async () => { try { return (await fetch(cfg.PREVIEW + '/index.html')).ok; } catch (e) { return false; } };
    if (!(await up())) { const port = 4176; cfg.PREVIEW = `http://localhost:${port}/osta`; own = cp.spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' }); for (let i = 0; i < 30 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500)); } }
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const res = [];
  for (const p of cfg.PAGES) for (const w of cfg.WIDTHS) {
    const pg = await br.newPage(); await pg.setViewport({ width: w, height: 900 });
    await pg.goto(p.includes('/') ? `${cfg.PREVIEW}/${p}` : `${cfg.URL}/${p === 'index' ? '' : p + '.html'}`, { waitUntil: 'networkidle2' });
    await pg.evaluate(async () => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); await document.fonts.ready; });
    await new Promise((r) => setTimeout(r, 600));
    res.push({ page: p, w, ...(await pg.evaluate(fn, { ...fnCfg, TOL: cfg.TOL })) }); await pg.close();
  }
  await br.close(); if (own) own.kill(); return res;
};
