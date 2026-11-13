#!/usr/bin/env node
/* SEO / GEO audit of the BUILT site (dist/). No network. Usage: npm run build && npm run audit:seo [-- --no-console] [-- --json out.json]
   Checks per HTML page: title (30-60, unique), description (70-160, unique), canonical (absolute, self, in sitemap iff indexable), hreflang pairs (reciprocal + x-default),
   robots meta vs sitemap, headings (one h1, first in main, no gaps, no empty, no duplicates, none in header/footer), lang, OG/Twitter, JSON-LD (parses + required fields),
   img alt, internal links resolve, viewport/favicon/theme-color, "no-JS" SSR content. Plus sitemaps, robots.txt, 404.html, llms.txt, and console errors (headless Chrome).
   Exit code 1 on any FAIL. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE = cfg.siteUrl.replace(/\/+$/, '');
const BASE = new URL(SITE + '/').pathname;
const L = cfg.limits;
const args = process.argv.slice(2);
const results = []; // {page, fails:[], warns:[]}
const globalFails = [];

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
if (!fs.existsSync(DIST)) { console.error('dist/ not found: run `npm run build` first'); process.exit(2); }
const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html')).map((f) => path.relative(DIST, f)).sort();

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')); return m ? decode(m[1] ?? m[2]) : null; };
const metas = (html, key, val) => [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).filter((t) => attr(t, key) === val);
const metaContent = (html, key, val) => { const t = metas(html, key, val)[0]; return t ? attr(t, 'content') : null; };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'use', 'rect', 'circle', 'line', 'polyline', 'polygon', 'stop']);
/** light DOM walk -> headings (with hidden/main/header/footer context), images, text */
function scan(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/g;
  const stack = []; const headings = []; const imgs = []; let m; let cur = null; let text = ''; let last = 0;
  const flags = () => ({ hidden: stack.some((s) => s.hidden), main: stack.some((s) => s.tag === 'main'), hf: !stack.some((s) => s.tag === 'main') && stack.some((s) => s.tag === 'header' || s.tag === 'footer') });
  while ((m = re.exec(body))) {
    const between = body.slice(last, m.index); last = re.lastIndex;
    if (cur) cur.text += between;
    if (!stack.some((s) => s.hidden)) text += between + ' ';
    if (!m[2]) continue;
    const tag = m[2].toLowerCase(); const attrs = m[3];
    if (m[1]) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      if (cur && /^h[1-6]$/.test(tag)) { cur.text = decode(cur.text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); headings.push(cur); cur = null; }
      continue;
    }
    if (tag === 'img') imgs.push({ attrs, alt: attr(`<img${attrs}>`, 'alt'), hidden: flags().hidden, src: attr(`<img${attrs}>`, 'src') });
    if (!VOID.has(tag) && !m[4]) {
      const hidden = /\shidden(\s|=|$)/.test(attrs) || /aria-hidden="true"/.test(attrs) && false;
      stack.push({ tag, hidden });
      if (/^h[1-6]$/.test(tag)) cur = { level: +tag[1], text: '', ...flags(), id: attr(`<x${attrs}>`, 'id') };
    }
  }
  return { headings, imgs, text: decode(text).replace(/\s+/g, ' ').trim() };
}

const urlOfFile = (f) => SITE + '/' + f.replace(/index\.html$/, '');
const fileOfUrl = (u) => { let p = u.startsWith(SITE) ? u.slice(SITE.length) : u; p = p.split(/[?#]/)[0]; if (!p.startsWith('/')) p = '/' + p; return p.endsWith('/') ? p.slice(1) + 'index.html' : p.slice(1); };

// ---- sitemaps
const sitemapFiles = walk(DIST).map((f) => path.relative(DIST, f)).filter((f) => /^sitemap.*\.xml$/.test(f));
const sitemapUrls = new Map(); // loc -> {lastmod, alts, file}
const sfail = (m) => globalFails.push('sitemap: ' + m);
if (!sitemapFiles.includes('sitemap.xml')) sfail('sitemap.xml missing');
for (const f of sitemapFiles) {
  const x = fs.readFileSync(path.join(DIST, f), 'utf8');
  if (!/^<\?xml/.test(x)) sfail(`${f}: no XML declaration`);
  if (f === 'sitemap.xml') {
    const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (!locs.length) sfail('sitemap.xml: no <sitemap> entries');
    locs.forEach((l) => { if (!l.startsWith(SITE + '/')) sfail(`sitemap.xml: ${l} is not absolute under siteUrl`); if (!sitemapFiles.includes(fileOfUrl(l))) sfail(`sitemap.xml: ${l} points to a missing file`); });
    continue;
  }
  const entries = [...x.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  if (entries.length > 50000) sfail(`${f}: >50000 URLs`);
  if (!entries.length) sfail(`${f}: empty urlset`);
  if (Buffer.byteLength(x) > 50 * 1024 * 1024) sfail(`${f}: >50MB`);
  for (const [, e] of entries) {
    const loc = (e.match(/<loc>([^<]+)<\/loc>/) || [])[1]; const lm = (e.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    if (!loc || !loc.startsWith(SITE + '/')) sfail(`${f}: bad loc ${loc}`);
    if (!lm || !/^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/.test(lm)) sfail(`${f}: ${loc} lastmod not ISO (${lm})`);
    if (sitemapUrls.has(loc)) sfail(`duplicate URL in sitemaps: ${loc}`);
    const alts = [...e.matchAll(/<xhtml:link[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    sitemapUrls.set(loc, { lastmod: lm, alts, file: f });
  }
}

// ---- pages
const pageInfo = new Map();
const titles = new Map(); const descs = new Map();
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(DIST, f), 'utf8');
  const fails = []; const warns = []; const F = (m) => fails.push(m);
  const url = urlOfFile(f);
  const isShim = f === 'product.html';
  const lang = (html.match(/<html[^>]*\slang="([^"]+)"/) || [])[1];
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
  const desc = metaContent(html, 'name', 'description');
  const canonical = ((html.match(/<link[^>]*rel="canonical"[^>]*>/) || [])[0] || '').match(/href="([^"]+)"/)?.[1];
  const robots = metaContent(html, 'name', 'robots') || '';
  const noindex = /noindex/i.test(robots);
  const hreflangs = [...html.matchAll(/<link[^>]*rel="alternate"[^>]*>/g)].map((m) => [attr(m[0], 'hreflang'), attr(m[0], 'href')]).filter((a) => a[0]);
  const sc = scan(html);
  const info = { f, url, lang, title, desc, canonical, noindex, hreflangs, h1: sc.headings.find((h) => h.level === 1 && !h.hidden)?.text, headings: sc.headings.filter((h) => !h.hidden), text: sc.text };
  pageInfo.set(f, info);
  // lang
  if (!lang || !/^(en|de)$/.test(lang)) F(`html lang missing/invalid (${lang})`);
  if (f.startsWith('de/') && lang !== 'de') F('DE page without lang=de');
  if (!f.startsWith('de/') && lang !== 'en') F('EN page without lang=en');
  // title/description
  if (!title) F('no <title>'); else { if (title.length < L.titleMin || title.length > L.titleMax) F(`title length ${title.length} (${L.titleMin}-${L.titleMax}): ${title}`); if (!title.endsWith('OSTA Trading') && !title.endsWith('OSTA Trading GmbH') && !isShim) warns.push('title brand suffix missing'); }
  if (!desc) F('no meta description'); else if (desc.length < L.descMin || desc.length > L.descMax) F(`description length ${desc.length} (${L.descMin}-${L.descMax})`);
  if (!noindex) { if (titles.has(title)) F(`duplicate title with ${titles.get(title)}`); titles.set(title, f); if (desc) { if (descs.has(desc)) F(`duplicate description with ${descs.get(desc)}`); descs.set(desc, f); } }
  // canonical
  if (!canonical) F('no canonical'); else {
    if (!/^https:\/\//.test(canonical)) F('canonical not absolute https');
    if (!isShim && canonical !== url) F(`canonical ${canonical} != own URL ${url}`);
  }
  // robots vs sitemap
  const inMap = sitemapUrls.has(url);
  if (noindex && inMap) F('noindex page is in sitemap');
  if (!noindex && !inMap && cfg.indexing) F('indexable page missing from sitemap');
  if (!/<meta name="robots"/.test(html)) F('no robots meta');
  if (!/<meta name="viewport"[^>]*width=device-width/.test(html)) F('no viewport meta');
  if (!/rel="icon"/.test(html)) F('no favicon link');
  if (!/name="theme-color"/.test(html)) F('no theme-color');
  // OG / Twitter
  for (const k of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name', 'og:locale', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt']) if (!metaContent(html, 'property', k)) F(`missing ${k}`);
  for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) if (!metaContent(html, 'name', k)) F(`missing ${k}`);
  if (metaContent(html, 'property', 'og:url') !== canonical && !isShim) F('og:url != canonical');
  // JSON-LD
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!lds.length) F('no JSON-LD');
  let types = [];
  for (const j of lds) {
    let o; try { o = JSON.parse(j); } catch (e) { F('JSON-LD does not parse: ' + e.message); continue; }
    const g = o['@graph'] || [o]; types = g.map((n) => n['@type']);
    const by = (t) => g.find((n) => n['@type'] === t);
    const org = by('Organization'); if (!org) F('JSON-LD: Organization missing'); else for (const k of ['name', 'url', 'logo', 'address', 'contactPoint']) if (!org[k]) F(`Organization.${k} missing`);
    if (!by('WebSite')) F('JSON-LD: WebSite missing');
    if (!g.some((n) => /Page$/.test(n['@type']))) F('JSON-LD: no WebPage-type node');
    const pr = by('Product');
    if (/^products\/[^/]+\/index\.html$/.test(f) && f !== 'products/a-z/index.html') {
      if (!pr) F('Product JSON-LD missing'); else { if (!pr.name || !pr.description || !pr.additionalProperty?.length) F('Product: name/description/additionalProperty missing'); if (pr.offers) F('Product must not have offers (no price)'); }
    } else if (pr) F('Product JSON-LD on a non-product page');
    if (by('FAQPage') ? false : g.some((n) => n.mainEntity?.[0]?.['@type'] === 'Question')) F('Question without FAQPage');
    if (f.replace(/^de\//, '') === 'faq.html') { const q = by('FAQPage'); if (!q || !q.mainEntity?.length || q.mainEntity.some((x) => !x.name || !x.acceptedAnswer?.text)) F('FAQPage incomplete'); } else if (by('FAQPage')) F('FAQPage on a non-FAQ page');
    if (/contact\.html$/.test(f) && !by('ContactPage')) F('ContactPage missing on contact');
    const bc = by('BreadcrumbList'); if (f.replace(/^de\//, '') !== 'index.html' && !isShim && !bc) F('BreadcrumbList missing'); if (bc && bc.itemListElement.some((it, i) => it.position !== i + 1 || !it.name || !it.item)) F('BreadcrumbList items invalid');
  }
  info.types = types;
  // headings
  const hs = sc.headings.filter((h) => !h.hidden);
  const h1s = hs.filter((h) => h.level === 1);
  if (isShim) { /* redirect shim: no content */ } else {
    if (h1s.length !== 1) F(`h1 count = ${h1s.length}`);
    if (hs[0] && hs[0].level !== 1) F(`first heading is h${hs[0].level}, not h1`);
    if (h1s[0] && !h1s[0].main) F('h1 is not inside <main>');
    if (hs.some((h) => h.hf)) F('heading inside header/footer');
    const empty = sc.headings.filter((h) => !h.text); if (empty.length) F(`${empty.length} empty heading(s)`);
    let prev = 0; for (const h of hs) { if (h.level > prev + 1 && prev) F(`heading level jump h${prev} -> h${h.level} ("${h.text.slice(0, 40)}")`); prev = h.level; }
    const seen = new Map(); for (const h of hs) { const k = h.text.toLowerCase(); if (seen.has(k)) F(`duplicate heading "${h.text}"`); seen.set(k, 1); }
  }
  // images
  for (const im of sc.imgs) if (!im.hidden && im.alt === null) F(`<img> without alt (${im.src})`);
  // SSR "no-JS" content
  if (!isShim) {
    if (!info.h1) F('SSR: no visible h1 text in source HTML');
    if (sc.text.length < 200) F(`SSR: very little visible text (${sc.text.length})`);
    const todo = [...html.matchAll(/<[a-z0-9]+\b[^>]*\sdata-i18n(?:-html)?="[^"]*"(?![^>]*data-i18n-done)[^>]*>/gi)].length;
    if (todo) F(`SSR: ${todo} data-i18n element(s) not prerendered`);
    if (/^products\/[^/]+\/index\.html$/.test(f) && f !== 'products/a-z/index.html') { if (!/<table class="spec-table"/.test(html)) F('SSR: product has no parameter table'); }
    if (f.replace(/^de\//, '') === 'catalog.html') { const n = (html.match(/href="[^"]*\/products\/[a-z0-9-]+\/"/g) || []).length; if (n < 10) F(`SSR: catalogue has only ${n} static product links`); info.catalogLinks = n; }
  }
  // links
  const links = [...html.matchAll(/\s(?:href|src|action)="([^"]*)"/g)].map((m) => decode(m[1]));
  for (const l of links) {
    if (/^(mailto:|tel:|#|https?:|data:|javascript:)/.test(l) || !l) continue;
    if (l.includes('product.html?slug=')) F(`internal link to legacy ?slug= URL: ${l}`);
    if (!l.startsWith('/')) { warns.push(`relative link ${l}`); continue; }
    if (!l.startsWith(BASE)) { F(`internal link without base: ${l}`); continue; }
    const rel = fileOfUrl(l.slice(BASE.length - 1)); const target = path.join(DIST, rel);
    if (!fs.existsSync(target)) F(`broken link ${l}`);
  }
  results.push({ page: f, fails, warns });
}

// ---- cross-page: hreflang reciprocity, DE differs from EN
for (const [f, i] of pageInfo) {
  if (!i.hreflangs.length) continue;
  const r = results.find((x) => x.page === f); const F = (m) => r.fails.push(m);
  const map = Object.fromEntries(i.hreflangs);
  if (!map['x-default']) F('hreflang: x-default missing');
  if (map[i.lang] !== i.url) F('hreflang: self-reference missing');
  for (const [l, href] of i.hreflangs) {
    if (l === 'x-default') continue;
    const tf = fileOfUrl(href); const t = pageInfo.get(tf);
    if (!t) { F(`hreflang ${l} -> missing page ${href}`); continue; }
    if (!t.hreflangs.some(([ll, hh]) => ll === i.lang && hh === i.url)) F(`hreflang ${l}: target does not link back`);
    if (l !== i.lang && l === 'de' && t.h1 && t.h1 === i.h1 && !/^faq|a-z/.test(f)) F(`DE h1 equals EN h1 ("${t.h1}"): text not translated`);
  }
}
// sitemap hreflang alternates must resolve to existing pages
for (const [loc, e] of sitemapUrls) { if (!pageInfo.has(fileOfUrl(loc))) globalFails.push(`sitemap URL without page: ${loc}`); for (const [, h] of e.alts) if (!pageInfo.has(fileOfUrl(h))) globalFails.push(`sitemap hreflang target missing: ${h}`); }

// ---- robots / 404 / llms
const robots = fs.existsSync(path.join(DIST, 'robots.txt')) ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
if (!robots) globalFails.push('robots.txt missing');
else {
  if (!new RegExp(`^Sitemap: ${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap\\.xml$`, 'm').test(robots)) globalFails.push('robots.txt: absolute Sitemap line missing');
  const star = robots.split(/\n\n/).find((b) => /User-agent: \*/.test(b)) || '';
  if (cfg.indexing && /^Disallow: \/\s*$/m.test(star)) globalFails.push('robots.txt blocks everything for *');
  for (const crit of ['/catalog.html', '/products/', '/about.html']) if (new RegExp(`^Disallow: ${crit}`, 'm').test(star)) globalFails.push(`robots.txt blocks ${crit}`);
  if (!/Disallow: \/design-system/.test(star)) globalFails.push('robots.txt: design-system not disallowed');
}
const nf = pageInfo.get('404.html'); if (!nf) globalFails.push('404.html missing'); else if (!nf.noindex) globalFails.push('404.html is not noindex');
if (!fs.existsSync(path.join(DIST, 'llms.txt'))) globalFails.push('llms.txt missing');
for (const f of ['site.webmanifest', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'og-default.png', '.well-known/security.txt']) if (!fs.existsSync(path.join(DIST, f))) globalFails.push(`${f} missing`);
const ds = pageInfo.get('design-system.html'); if (ds && !ds.noindex) globalFails.push('design-system.html must be noindex');

// ---- console errors (headless Chrome against a static server of dist/)
async function consoleCheck() {
  let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { return { skipped: 'puppeteer-core missing' }; }
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(CHROME)) return { skipped: 'Chrome not found' };
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(BASE)) { res.statusCode = 404; return res.end('x'); }
    p = p.slice(BASE.length); if (!p || p.endsWith('/')) p += 'index.html';
    const file = path.join(DIST, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(path.join(DIST, '404.html'))); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const sample = ['', 'about.html', 'catalog.html', 'products/ibuprofen/', 'products/a-z/', 'faq.html', 'de/', 'de/catalog.html', '404.html', 'contact.html'];
    for (const s of sample) {
      const page = await browser.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${s || '/'}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${s || '/'}: pageerror ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`${s || '/'}: requestfailed ${r.url()}`));
      await page.goto(`http://127.0.0.1:${port}${BASE}${s}`, { waitUntil: 'load', timeout: 30000 }).catch((e) => errors.push(`${s}: goto ${e.message}`));
      await new Promise((r) => setTimeout(r, 1500));
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  return { errors: errors.filter((e) => !/favicon|404 \(Not Found\)/.test(e) || /og-default|icon/.test(e)) };
}

(async () => {
  let cons = { skipped: 'disabled (--no-console)' };
  if (!args.includes('--no-console')) cons = await consoleCheck();
  if (cons.errors?.length) globalFails.push(...cons.errors.map((e) => 'console: ' + e));
  // ---- report
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log('\nSEO audit of dist/  (siteUrl ' + SITE + ', base ' + BASE + ')\n');
  console.log(pad('PAGE', 52) + pad('INDEX', 8) + pad('LANG', 6) + pad('JSON-LD', 36) + 'RESULT');
  let pass = 0; let fail = 0;
  for (const r of results) {
    const i = pageInfo.get(r.page); const ok = !r.fails.length; ok ? pass++ : fail++;
    console.log(pad(r.page, 52) + pad(i.noindex ? 'noindex' : 'index', 8) + pad(i.lang, 6) + pad((i.types || []).filter((t) => !/^(Organization|WebSite)$/.test(t)).join(','), 36) + (ok ? 'PASS' : 'FAIL'));
    r.fails.forEach((f) => console.log('    FAIL: ' + f));
  }
  const warnCount = results.reduce((n, r) => n + r.warns.length, 0);
  console.log(`\nPages: ${results.length}  PASS: ${pass}  FAIL: ${fail}  (warnings: ${warnCount})`);
  console.log(`Sitemap URLs: ${sitemapUrls.size} in ${sitemapFiles.length - 1} part files; noindex pages: ${[...pageInfo.values()].filter((i) => i.noindex).length}`);
  console.log('Console check: ' + (cons.skipped ? 'skipped (' + cons.skipped + ')' : `${cons.errors.length} error(s)`));
  if (globalFails.length) { console.log('\nGLOBAL FAIL:'); globalFails.forEach((g) => console.log('  - ' + g)); } else console.log('Global checks (sitemaps, robots.txt, 404, llms.txt, assets): PASS');
  const idx = args.indexOf('--json'); if (idx >= 0) fs.writeFileSync(args[idx + 1], JSON.stringify({ results, globalFails, pages: [...pageInfo.values()] }, null, 2));
  process.exit(fail || globalFails.length ? 1 : 0);
})();
