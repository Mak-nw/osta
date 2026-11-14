#!/usr/bin/env node
/* Static gate (no browser, no dependencies): runs on the BUILT site `dist/` and is safe for CI (GitHub Actions has no configured Chrome/WebGL).
   Checks every HTML page: lang, <title>, meta description, absolute canonical, hreflang (en + de + x-default on indexable pages),
   exactly one <h1>, heading hierarchy without skipped levels / empty headings, duplicate ids; plus built CSS/JS:
   `stroke-dasharray` and JS `dashed: true` (dashed illustration lines are forbidden) = FAIL; `border-*-style: dashed|dotted` in CSS = WARN (customer decision pending for disabled fields).
   CSS must contain no black/near-black literal (#000, black, rgba(0,0,0,..), #0x..-#2x.. hex). Exit code 1 on any FAIL. Usage: node tools/static-gate.cjs [--dist dist] [--verbose]. The browser gate (tools/style-gate.cjs) stays a local/pre-merge check: see tools/README.md. */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const DIST = path.resolve(__dirname, '..', String(opt('dist', 'dist')));
if (!fs.existsSync(DIST)) { console.error('static-gate: ' + DIST + ' not found (run `npm run build` first)'); process.exit(2); }
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(DIST); const rel = (f) => path.relative(DIST, f).split(path.sep).join('/');
const fails = [], warns = []; let pages = 0, skipped = 0;
const F = (f, m) => fails.push(rel(f) + ': ' + m), W = (f, m) => warns.push(rel(f) + ': ' + m);
const strip = (h) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<template[\s\S]*?<\/template>/gi, '');
const attr = (tag, n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? (m[2] !== undefined ? m[2] : m[3]) : null; };

for (const f of files.filter((x) => x.endsWith('.html'))) {
  const raw = fs.readFileSync(f, 'utf8'); const h = strip(raw);
  if (/<meta[^>]+http-equiv=["']refresh["']/i.test(raw) && !/<main[\s>]/i.test(raw)) { skipped++; continue; } /* redirect shim (product.html) */
  pages++;
  const htmlTag = (/<html\b[^>]*>/i.exec(h) || [''])[0]; if (!attr(htmlTag, 'lang')) F(f, 'missing <html lang>');
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1]; if (!title || !title.trim()) F(f, 'missing/empty <title>');
  const metas = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]); const links = [...h.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const desc = metas.find((m) => /name=["']description["']/i.test(m)); if (!desc || !(attr(desc, 'content') || '').trim()) F(f, 'missing meta description');
  const robots = metas.find((m) => /name=["']robots["']/i.test(m)); const noindex = !!robots && /noindex/i.test(attr(robots, 'content') || '');
  const canon = links.find((l) => /rel=["']canonical["']/i.test(l)); if (!canon || !/^https?:\/\//.test(attr(canon, 'href') || '')) { if (!(f.endsWith('404.html') && noindex)) F(f, 'missing or non-absolute canonical'); }
  const alt = links.filter((l) => /rel=["']alternate["']/i.test(l) && attr(l, 'hreflang')); const langs = new Set(alt.map((l) => attr(l, 'hreflang').toLowerCase()));
  const r0 = rel(f), twin = r0.startsWith('de/') || fs.existsSync(path.join(DIST, 'de', r0)); /* hreflang only where a DE twin exists (products are EN-only) */
  if (!noindex && twin) { for (const need of ['en', 'de', 'x-default']) if (!langs.has(need)) F(f, 'indexable page lacks hreflang="' + need + '"'); }
  const hs = [...h.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ l: +m[1], t: m[2].replace(/<[^>]+>/g, '').trim() }));
  const n1 = hs.filter((x) => x.l === 1).length; if (n1 !== 1) F(f, n1 + ' <h1> (exactly one required)');
  let prev = 0; for (const x of hs) { if (!x.t && !/<img|<svg/i.test(x.t)) F(f, 'empty h' + x.l); if (prev && x.l > prev + 1) F(f, 'heading level skipped h' + prev + ' -> h' + x.l + ' ("' + x.t.slice(0, 30) + '")'); prev = x.l; }
  const ids = [...h.matchAll(/<[a-z][^>]*\sid=("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] !== undefined ? m[2] : m[3]); const seen = new Set(), dup = new Set(); for (const i of ids) { if (seen.has(i)) dup.add(i); seen.add(i); } if (dup.size) F(f, 'duplicate id: ' + [...dup].slice(0, 5).join(', '));
}
for (const f of files.filter((x) => /\.css$/.test(x))) { const t = fs.readFileSync(f, 'utf8');
  if (/#000(?:000)?\b|\bblack\b|rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\s*[,)\/]|#(?:[0-2][0-9a-f]){3}(?![0-9a-f])/i.test(t.replace(/\/\*[\s\S]*?\*\//g, ''))) F(f, 'black / near-black colour literal in CSS (A5.1: the site has no black; use deep navy tokens)');
  if (/--c-grey|--text-muted|\.t-muted\b|#566265|#6f7e82/i.test(t.replace(/\/\*[\s\S]*?\*\//g, ''))) F(f, 'grey colour token/literal in CSS (customer 2026-11-13: the site has no grey; use --text-accent-subtle / --text)');
  for (const m of t.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?![0-9a-f])/gi)) { const v = [m[1], m[2], m[3]].map((x) => parseInt(x, 16)), mx = Math.max(...v), mn = Math.min(...v); if (mx >= 41 && mx <= 215 && mx - mn <= 16) F(f, 'grey hex literal ' + m[0] + ' in CSS (no grey on the site)'); }
  if (/stroke-dasharray\s*:\s*(?!none)/i.test(t)) F(f, '`stroke-dasharray` in CSS (dashed illustration lines are forbidden)');
  if (/border(-[a-z]+)?-style\s*:\s*(dashed|dotted)|border(-[a-z]+)?\s*:[^;}]*\b(dashed|dotted)\b/i.test(t)) W(f, '`dashed|dotted` border in CSS (disabled fields: customer decision pending)'); }
for (const f of files.filter((x) => /\.m?js$/.test(x))) { const t = fs.readFileSync(f, 'utf8'); /* three.js itself defines LineDashedMaterial: look for USAGE only */
  if (/\bdashed\s*:\s*(!0|true)\b/.test(t) || /new\s+\w*LineDashedMaterial\s*\(/.test(t)) F(f, 'JS uses dashed lines (`dashed: true` / LineDashedMaterial)'); }
console.log('static-gate: ' + pages + ' pages checked (' + skipped + ' redirect shim skipped), ' + fails.length + ' FAIL, ' + warns.length + ' WARN');
const show = (a, p, max) => { for (const x of a.slice(0, max)) console.log(p + x); if (a.length > max) console.log(p + '... +' + (a.length - max) + ' more'); };
show(fails, 'FAIL ', opt('verbose', false) ? 1e9 : 40); show(warns, 'WARN ', opt('verbose', false) ? 1e9 : 10);
process.exit(fails.length ? 1 : 0);
