#!/usr/bin/env node
/* Link-targets gate (static, no browser): runs on built `dist/` + source HTML/i18n. Usage: node tools/link-targets-gate.cjs [--dist dist] [--verbose]
   (a) every internal <a href> (dist pages, source HTML, i18n strings) resolves to a built page; ?category= must exist in the catalog filters; #hash must exist as id; no bare/empty '#', no redirect shim (/product.html).
   (b) every internal target must be in tools/link-registry.json and approved:true (approved:false or unknown = FAIL; product pages = PENDING, reported not failed).
   (c) external links: https + rel noopener (when target=_blank) + listing. Also reports (not fails) hub urls in sitemap / llms.txt / JSON-LD. Exit 1 on FAIL. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'); const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const DIST = path.resolve(ROOT, String(opt('dist', 'dist')));
if (!fs.existsSync(DIST)) { console.error('link-targets-gate: dist not found (run `npm run build`)'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const origin = new URL(cfg.siteUrl).origin, base = new URL(cfg.siteUrl).pathname.replace(/\/?$/, '/');
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, 'link-registry.json'), 'utf8'));
const apat = (reg.approvedPatterns || []).map((r) => new RegExp(r.pattern)); const excl = new Set((reg.excludePages || []).map((x) => x.page));
const approved = new Map(reg.approved.map((r) => [r.target, r])); const pending = reg.pending.map((p) => new RegExp(p.pattern));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const rel = (f, r) => path.relative(r, f).split(path.sep).join('/');
const strip = (h) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, '');
const fails = [], pend = new Map(), targets = new Map(), ext = new Map(), notes = [];
const F = (p, m) => fails.push(p + ': ' + m);
const catalogHtml = fs.readFileSync(path.join(DIST, 'catalog.html'), 'utf8');
const cats = new Set([...catalogHtml.matchAll(/data-category="([^"]+)"/g)].map((m) => m[1]));
const idCache = new Map(); const idsOf = (f) => { if (!idCache.has(f)) idCache.set(f, new Set([...fs.readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return idCache.get(f); };
const toFile = (p) => { let q = p; if (q.endsWith('/')) q += 'index.html'; let f = path.join(DIST, q); if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; f = path.join(DIST, p, 'index.html'); return fs.existsSync(f) ? f : null; };
const stripBase = (p) => (p.startsWith(base) ? '/' + p.slice(base.length) : p);

function check(where, href, fromFile, isDist) {
  href = href.trim().replace(/&amp;/g, '&');
  if (/\{\{|<!--@/.test(href)) return; /* template placeholder */
  if (href === '' || href === '#') return F(where, 'empty/placeholder href "' + href + '"');
  if (/^(mailto:|tel:|sms:|javascript:)/i.test(href)) return;
  let u;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) { u = new URL(href.startsWith('//') ? 'https:' + href : href); if (u.origin !== origin) return void (ext.get(href) || ext.set(href, new Set())).add(where); }
  else if (href.startsWith('#')) { const id = href.slice(1); if (fromFile && !idsOf(fromFile).has(id) && id !== 'main') F(where, 'in-page anchor ' + href + ' has no id'); return; }
  else u = new URL(href, origin + (isDist ? '/' : '/'));
  let p = decodeURIComponent(stripBase(u.pathname)); if (p === '/index.html') p = '/';
  const de = p === '/de/' || p.startsWith('/de/'); if (de) p = p === '/de/' ? '/' : p.slice(3); /* DE twin = same registry target */
  let key = p + (u.search ? u.search : ''); if (/^\/contact\.html\?product=/.test(key)) key = '/contact.html?product=<slug>'; /* registry key: path + query, no hash */
  const hubSelf = /^dist\/(de\/)?products\/category\/([a-z-]+)\/index\.html$/.exec(where.split(' ')[0]); if (hubSelf && key === '/products/category/' + hubSelf[2] + '/') return; /* hub self/DE-twin language switch */
  const f = toFile((de ? '/de' + (p === '/' ? '/' : p) : p));
  if (!f) return F(where, 'broken link ' + href + ' (no built page)');
  if (/\/product\.html$/.test(p)) F(where, 'link to redirect shim ' + p);
  for (const [k, v] of u.searchParams) { if (k === 'product' && p === '/contact.html') continue; if (k === 'category') { if (!cats.has(v) || v === 'all') F(where, 'catalog has no category "' + v + '"'); } else if (k !== 'q') F(where, 'unknown query param ' + k + ' in ' + href); }
  if (u.hash && !idsOf(f).has(u.hash.slice(1))) F(where, 'anchor ' + u.hash + ' not found in ' + p);
  (targets.get(key) || targets.set(key, { n: 0, pages: new Set() }).get(key)); const t = targets.get(key); t.n++; t.pages.add(where.split(' ')[0]);
  const r = approved.get(key);
  if (key === '/contact.html?product=<slug>') { /* approved pattern */ } else if (r) { if (!r.approved) F(where, 'FORBIDDEN target ' + key + ' (' + r.note + ')'); }
  else if (false) { }
  else if (pending.some((rx) => rx.test(key))) pend.set(key, (pend.get(key) || 0) + 1);
  else F(where, 'target not in link-registry.json: ' + key);
}
function scan(file, root, isDist) {
  const raw = fs.readFileSync(file, 'utf8'); const h = strip(raw); const name = (isDist ? 'dist/' : 'src/') + rel(file, root); if (excl.has(rel(file, root))) return;
  if (isDist && /http-equiv=["']refresh["']/i.test(raw) && !/<main[\s>]/i.test(raw)) return; /* redirect shim */
  for (const m of h.matchAll(/<a\b[^>]*>/gi)) {
    const href = (/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[0]) || [])[2] ?? (/\bhref\s*=\s*'([^']*)'/i.exec(m[0]) || [])[1];
    if (href === undefined) { F(name, '<a> without href: ' + m[0].slice(0, 60)); continue; }
    if (!/^(mailto:|tel:)/i.test(href) && /^(https?:)?\/\//i.test(href) && new URL(href.startsWith('//') ? 'https:' + href : href).origin !== origin) {
      if (!/^https:/i.test(href)) F(name, 'external link not https: ' + href);
      if (/target=["']_blank["']/i.test(m[0]) && !/rel=["'][^"']*noopener/i.test(m[0])) F(name, 'external _blank without rel=noopener: ' + href);
    }
    check(name, href, isDist ? file : null, isDist);
  }
}
const distHtml = walk(DIST).filter((f) => f.endsWith('.html')); distHtml.forEach((f) => scan(f, DIST, true));
const srcFiles = [...fs.readdirSync(ROOT).filter((x) => x.endsWith('.html')).map((x) => path.join(ROOT, x)), ...walk(path.join(ROOT, 'src/partials')), ...walk(path.join(ROOT, 'src/templates'))].filter((f) => f.endsWith('.html'));
srcFiles.forEach((f) => scan(f, ROOT, false));
/* i18n strings with <a href> */
for (const l of ['en', 'de']) { const j = fs.readFileSync(path.join(ROOT, 'src/i18n', l + '.json'), 'utf8'); for (const m of j.matchAll(/<a\b[^>]*?href=\\?"([^"\\]*)\\?"/g)) check('i18n/' + l + '.json', m[1], null, true); }
/* sitemap / llms / JSON-LD: reported, not failed */
const hubRe = /products\/category\//; const listed = new Map();
for (const f of walk(DIST).filter((x) => /\.(xml|txt)$/.test(x))) { const t = fs.readFileSync(f, 'utf8'); const n = (t.match(/products\/category\/[a-z-]+\//g) || []).length; if (n && !/robots/.test(f)) listed.set('dist/' + rel(f, DIST), n); }
for (const f of distHtml) { const t = fs.readFileSync(f, 'utf8'); const ld = [...t.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n'); const n = (ld.match(/products\/category\/[a-z-]+\//g) || []).length; if (n) listed.set('JSON-LD ' + rel(f, DIST), n); }
const sorted = [...targets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log('link-targets-gate: ' + distHtml.length + ' dist pages + ' + srcFiles.length + ' source HTML + i18n; ' + sorted.length + ' distinct internal targets');
console.log('TARGET | COUNT | PAGES | STATUS');
for (const [k, v] of sorted) { const r = approved.get(k); const st = r ? (r.approved ? 'approved' : 'FORBIDDEN') : k === '/contact.html?product=<slug>' ? 'approved (pattern)' : pending.some((rx) => rx.test(k)) ? 'PENDING' : 'UNKNOWN';
  if (opt('verbose', false) || !k.startsWith('/products/') || /category/.test(k)) console.log(k + ' | ' + v.n + ' | ' + v.pages.size + (opt('verbose', false) ? ' [' + [...v.pages].slice(0, 6).join(', ') + ']' : '') + ' | ' + st); }
const pc = [...pend.values()].reduce((a, b) => a + b, 0); console.log('PENDING product pages /products/<slug>/: ' + pend.size + ' distinct targets, ' + pc + ' links (pending customer approval; not a FAIL)');
console.log('EXTERNAL links: ' + ext.size + (ext.size ? ' -> ' + [...ext.keys()].slice(0, 10).join(', ') : ''));
for (const [k, n] of listed) console.log('LISTED (not changed): ' + k + ' x' + n);
const uniq = [...new Set(fails)]; console.log('FAIL ' + uniq.length); uniq.slice(0, opt('verbose', false) ? 1e9 : 40).forEach((x) => console.log('FAIL ' + x));
process.exit(uniq.length ? 1 : 0);
