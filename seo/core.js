// SEO / prerender core: data loading, page enumeration, head+JSON-LD, i18n prerender, sitemap/robots/llms generation.
// Used by vite-plugin-seo.js (build: generateBundle, dev: middleware) and by tools/*.cjs (via dynamic import).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { esc, escAttr, applyI18n, getAttr, stripTags } from './html.js';

export const ROOT = resolve(import.meta.dirname, '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const CATS = ['api', 'excipients', 'food-grade'];
const CAT_ICON = { api: 'molecule', excipients: 'puzzle', 'food-grade': 'leaf' };
const CAT_KEY = { api: 'catalog.cat_api', excipients: 'catalog.cat_excipients', 'food-grade': 'catalog.cat_food' };
const AZ_SPECIAL = '#';

export function readSiteUrl() { return readJson(resolve(ROOT, 'site.config.json')).siteUrl.replace(/\/+$/, ''); }
export function siteBasePath() { return new URL(readSiteUrl() + '/').pathname; }

const fileDate = (() => {
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let d = null;
    try { d = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { /* not a git repo */ }
    if (!d) { try { d = statSync(file).mtime.toISOString().slice(0, 10); } catch { d = new Date().toISOString().slice(0, 10); } }
    cache.set(file, d); return d;
  };
})();

const words = (s) => (String(s || '').trim().match(/\S+/g) || []).length;

export function loadSite({ base = '/' } = {}) {
  const config = readJson(resolve(ROOT, 'site.config.json'));
  const registry = readJson(resolve(ROOT, 'seo/pages.json'));
  const rawProducts = readJson(resolve(ROOT, 'src/data/products.json'));
  const details = readJson(resolve(ROOT, 'src/data/product-details.json'));
  const dicts = { en: readJson(resolve(ROOT, 'src/i18n/en.json')), de: readJson(resolve(ROOT, 'src/i18n/de.json')) };
  const siteUrl = config.siteUrl.replace(/\/+$/, '');
  const abs = (path) => siteUrl + path;
  const get = (key, lang = 'en') => {
    const walk = (o) => key.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    const v = walk(dicts[lang]);
    return typeof v === 'string' && v !== '' ? v : walk(dicts.en);
  };
  const tt = (lang, key, vars = {}) => String(get(key, lang) ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

  const products = rawProducts.map((p) => {
    const d = details[p.slug] || {};
    const m = { ...d, ...p, availability: p.availability || 'in_stock', synonyms: p.synonyms || [] };
    const facts = ['cas', 'formula', 'colour', 'usage'].filter((k) => m[k]).length;
    const wc = words(m.description) + words(m.usage);
    const gate = { facts, words: wc, ok: !!(m.name && m.categories?.length && facts >= config.productGate.minFacts && wc >= config.productGate.minWords) };
    m.gate = gate;
    m.hidden = m.availability === 'hidden';
    m.indexable = !m.hidden && m.seo_ready === true && gate.ok;
    m.primary = m.categories[0];
    return m;
  }).filter((p) => !p.hidden);
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));

  const ctx = { config, registry, products, bySlug, dicts, get, tt, base, siteUrl, abs, cats: CATS };
  ctx.pages = enumeratePages(ctx);
  return ctx;
}

// ------------------------------------------------------------------ paths
export const langPath = (path, lang) => (lang === 'de' ? (path === '/' ? '/de/' : '/de' + path) : path);
export const outFile = (urlPath) => (urlPath.endsWith('/') ? urlPath.slice(1) + 'index.html' : urlPath.slice(1));
const catPath = (c) => `/products/category/${c}/`;
const AZ_PATH = '/products/a-z/';

function pageLastmod(ctx, e) {
  if (e.reg?.lastmod) return e.reg.lastmod;
  if (e.kind === 'product') return e.product.updated_at;
  if (e.kind === 'hub') { const l = hubProducts(ctx, e.hub).map((p) => p.updated_at).sort(); return l.at(-1) || fileDate(resolve(ROOT, 'src/data/products.json')); }
  if (e.source) return fileDate(resolve(ROOT, e.source));
  return fileDate(resolve(ROOT, 'site.config.json'));
}

function enumeratePages(ctx) {
  const { registry, products } = ctx;
  const list = [];
  const add = (e) => { e.outFile = outFile(e.urlPath); e.url = ctx.abs(e.urlPath); e.lastmod = pageLastmod(ctx, e); list.push(e); };
  for (const [key, reg] of Object.entries(registry)) {
    if (key.startsWith('_')) continue;
    const langs = reg.langs || ['en', 'de'];
    for (const lang of langs) {
      const base = { key, reg, lang, langs, noindex: reg.robots === 'noindex' };
      if (reg.hub) add({ ...base, kind: 'hub', hub: reg.hub, source: 'src/templates/hub.html', urlPath: langPath(reg.path, lang) });
      else add({ ...base, kind: key === 'catalog' ? 'catalog' : 'static', source: reg.source, urlPath: langPath(reg.path, lang) });
    }
  }
  for (const p of products) {
    add({ key: `product:${p.slug}`, kind: 'product', lang: 'en', langs: ['en'], product: p, source: 'src/templates/product.html', urlPath: `/products/${p.slug}/`, noindex: !p.indexable, reg: registry._product });
  }
  add({ key: 'product-shim', kind: 'shim', lang: 'en', langs: ['en'], urlPath: '/product.html', noindex: true, reg: registry._shim || {} });
  return list;
}

export function hubProducts(ctx, hub) {
  return ctx.products.filter((p) => p.indexable && (hub === 'az' || p.categories.includes(hub)));
}
const sortName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** alternates: only for pages that exist in both languages */
export function alternates(ctx, e) {
  if (e.langs.length < 2) return null;
  const path = e.urlPath.replace(/^\/de(\/|$)/, '/');
  return Object.fromEntries(e.langs.map((l) => [l, ctx.abs(langPath(path, l))]));
}
/** language-switch targets (pair, or the nearest hub when the counterpart does not exist) */
export function switchTargets(ctx, e) {
  const alt = alternates(ctx, e);
  if (alt) return alt;
  return { en: e.lang === 'en' ? e.url : ctx.abs('/'), de: ctx.abs(e.kind === 'product' ? '/de/catalog.html' : '/de/') };
}

// ------------------------------------------------------------------ meta text
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

function productMeta(ctx, p) {
  const { registry, config } = ctx; const T = registry._product.en;
  const brand = config.titleBrand; const cat = T.categoryTitle[p.primary] || 'supplier';
  const short = p.name.replace(/\s*\([^)]*\)/g, '').trim();
  const variants = [`${p.name} — ${cat}${brand}`, `${short} — ${cat}${brand}`, `${p.name} — ${cat}, Hamburg${brand}`, `${p.name}${brand}`, `${short}${brand}`];
  const { titleMin, titleMax } = config.limits;
  let title = variants.find((v) => v.length >= titleMin && v.length <= titleMax) || variants.find((v) => v.length <= titleMax) || clip(variants.at(-1), titleMax);
  if (title.length < titleMin) title = `${p.name} — ${cat} from Hamburg${brand}`;
  const first = (p.description || '').split(/(?<=[.;])\s/)[0].replace(/\.$/, '');
  const cas = p.cas ? ` (CAS ${p.cas})` : '';
  const tail = p.availability === 'in_stock' ? ' Request a quotation from OSTA Trading, Hamburg.' : ' Available on request: request sourcing from OSTA Trading, Hamburg.';
  const head = `${p.name}${cas}: `;
  const room = config.limits.descMax - head.length - tail.length - 1;
  const STOP = /\s+(a|an|the|of|as|and|or|with|to|for|in|on|by|used|that|which|from|is|are|its|it|into|than|at|be)$/i;
  const cut = (n) => {
    if (first.length <= n) return first;
    const clauses = first.split(/,\s+/); let acc = '';
    for (const c of clauses) { const next = acc ? `${acc}, ${c}` : c; if (next.length > n) break; acc = next; }
    if (acc.length < 25) {
      acc = first.slice(0, n).replace(/\s+\S*$/, '');
      const ms = [...acc.matchAll(/\s(with|that|which|used|and|from|belonging|obtained|related|essential|functions|of)\s/g)].filter((m) => m.index > 25);
      if (ms.length) acc = acc.slice(0, ms.at(-1).index);
    }
    let prev; do { prev = acc; acc = acc.replace(STOP, '').replace(/[\s,;:(-]+$/, ''); } while (acc !== prev);
    return acc;
  };
  let desc = `${head}${cut(Math.max(room, 20))}.${tail}`;
  if (desc.length > config.limits.descMax) desc = `${head}${cut(Math.max(room - 5, 20))}.${tail}`;
  if (desc.length < config.limits.descMin) desc = `${p.name}${cas}: ${T.fallbackDescription}`;
  return { title, description: desc };
}

export function metaFor(ctx, e) {
  const lang = e.lang;
  if (e.kind === 'product') return productMeta(ctx, e.product);
  if (e.kind === 'shim') return { title: 'Product redirect | OSTA Trading', description: 'This address has moved to the product pages of OSTA Trading. You are being redirected to the catalogue.' };
  const m = e.reg[lang] || e.reg.en;
  return { title: m.title, description: m.description, name: m.name };
}

// ------------------------------------------------------------------ JSON-LD
export function jsonLd(ctx, e, meta) {
  const { config, abs, tt } = ctx; const c = config.company; const lang = e.lang;
  const orgId = abs('/#organization'); const siteId = abs('/#website');
  const org = {
    '@type': 'Organization', '@id': orgId, name: c.legalName, legalName: c.legalName, url: abs('/'),
    logo: { '@type': 'ImageObject', url: abs('/assets/img/logo.png'), width: 900, height: 658 },
    email: c.email, telephone: c.telephone, faxNumber: c.fax,
    address: { '@type': 'PostalAddress', streetAddress: c.streetAddress, postalCode: c.postalCode, addressLocality: c.addressLocality, addressCountry: c.addressCountry },
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'sales', email: c.email, telephone: c.telephone, availableLanguage: ['English', 'German'] }],
    knowsAbout: ['Active pharmaceutical ingredients', 'Pharmaceutical excipients', 'Food grade ingredients'],
  };
  const ids = [];
  if (config.credentials.eudraGmdpNumber) ids.push({ '@type': 'PropertyValue', propertyID: 'EudraGMDP', value: config.credentials.eudraGmdpNumber });
  if (config.credentials.wdaNumber) ids.push({ '@type': 'PropertyValue', propertyID: 'WDA', value: config.credentials.wdaNumber });
  if (ids.length) org.identifier = ids;
  if (c.sameAs?.length) org.sameAs = c.sameAs;
  const website = {
    '@type': 'WebSite', '@id': siteId, url: abs('/'), name: config.siteName, inLanguage: config.locales, publisher: { '@id': orgId },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: abs('/catalog.html') + '?q={search_term_string}' }, 'query-input': 'required name=search_term_string' },
  };
  const graph = [org, website];
  const pageType = e.kind === 'hub' || e.kind === 'catalog' ? 'CollectionPage' : (e.reg?.type || 'WebPage');
  const page = { '@type': pageType, '@id': e.url + '#webpage', url: e.url, name: meta.title, description: meta.description, inLanguage: lang, isPartOf: { '@id': siteId }, about: { '@id': orgId } };
  // breadcrumbs
  const crumbs = breadcrumbs(ctx, e);
  if (crumbs.length > 1) {
    graph.push({ '@type': 'BreadcrumbList', '@id': e.url + '#breadcrumb', itemListElement: crumbs.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: b.url })) });
    page.breadcrumb = { '@id': e.url + '#breadcrumb' };
  }
  if (e.kind === 'product') {
    const p = e.product;
    const props = [];
    if (p.inn) props.push({ '@type': 'PropertyValue', name: 'INN', value: p.inn });
    if (p.cas) props.push({ '@type': 'PropertyValue', name: 'CAS number', value: p.cas });
    if (p.formula) props.push({ '@type': 'PropertyValue', name: 'Molecular formula', value: p.formula });
    if (p.colour) props.push({ '@type': 'PropertyValue', name: 'Appearance', value: p.colour });
    props.push({ '@type': 'PropertyValue', name: 'Availability status', value: tt('en', p.availability === 'in_stock' ? 'product.status_in_stock' : 'product.status_on_request') });
    graph.push({ '@type': 'Product', '@id': e.url + '#product', name: p.name, description: p.description, url: e.url, category: tt('en', CAT_KEY[p.primary]), additionalProperty: props, mainEntityOfPage: { '@id': e.url + '#webpage' } });
    page.mainEntity = { '@id': e.url + '#product' };
  }
  if (e.kind === 'hub' || e.kind === 'catalog') {
    const list = e.kind === 'catalog' ? ctx.products.filter((p) => p.availability === 'in_stock' && p.indexable) : hubProducts(ctx, e.hub);
    page.mainEntity = { '@type': 'ItemList', numberOfItems: list.length, itemListElement: list.slice().sort(sortName).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(`/products/${p.slug}/`), name: p.name })) };
  }
  if (e.key === 'faq') {
    page.mainEntity = faqItems(ctx, lang).map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } }));
  }
  graph.push(page);
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function faqItems(ctx, lang) {
  const out = [];
  for (let i = 1; i <= 30 && ctx.get(`faq.q${i}`, 'en'); i++) out.push({ q: ctx.get(`faq.q${i}`, lang), a: stripTags(ctx.get(`faq.a${i}`, lang)) });
  return out;
}

export function breadcrumbs(ctx, e) {
  const lang = e.lang; const home = { name: ctx.get('product.breadcrumb_home', lang), url: ctx.abs(langPath('/', lang)) };
  const catalog = { name: ctx.get('product.breadcrumb_products', lang), url: ctx.abs(langPath('/catalog.html', lang)) };
  const name = () => (e.reg?.[lang] || e.reg?.en)?.name || (e.reg?.[lang] || e.reg?.en)?.title;
  if (e.key === 'index') return [home];
  if (e.kind === 'product') return [home, catalog, { name: e.product.name, url: e.url }];
  if (e.kind === 'hub') return [home, catalog, { name: name(), url: e.url }];
  if (e.kind === 'shim') return [home];
  return [home, { name: name(), url: e.url }];
}

// ------------------------------------------------------------------ head
export function headBlock(ctx, e, meta) {
  const { config, abs } = ctx; const lang = e.lang;
  const robots = e.noindex ? (e.key === '404' || e.kind === 'shim' ? 'noindex,follow' : 'noindex,follow') : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
  const alt = alternates(ctx, e);
  const img = abs(config.ogImage.path);
  const imgAlt = ctx.get('meta.og_image_alt', lang);
  const og = [
    ['og:type', e.kind === 'product' ? 'website' : 'website'], ['og:site_name', config.siteName], ['og:title', meta.title], ['og:description', meta.description], ['og:url', e.url],
    ['og:locale', config.ogLocale[lang]], ...(alt ? Object.keys(alt).filter((l) => l !== lang).map((l) => ['og:locale:alternate', config.ogLocale[l]]) : []),
    ['og:image', img], ['og:image:width', config.ogImage.width], ['og:image:height', config.ogImage.height], ['og:image:alt', imgAlt], ['og:image:type', 'image/png'],
  ];
  const lines = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${escAttr(meta.description)}">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${e.url}">`,
    ...(alt ? [...Object.entries(alt).map(([l, u]) => `<link rel="alternate" hreflang="${l}" href="${u}">`), `<link rel="alternate" hreflang="x-default" href="${alt.en}">`] : []),
    `<meta name="theme-color" content="${config.themeColor}">`,
    ...og.map(([k, v]) => `<meta property="${k}" content="${escAttr(v)}">`),
    '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:title" content="${escAttr(meta.title)}">`, `<meta name="twitter:description" content="${escAttr(meta.description)}">`, `<meta name="twitter:image" content="${img}">`, `<meta name="twitter:image:alt" content="${escAttr(imgAlt)}">`,
    '<link rel="icon" href="/favicon.ico" sizes="32x32">', '<link rel="icon" href="/favicon.svg" type="image/svg+xml">', '<link rel="apple-touch-icon" href="/apple-touch-icon.png">', '<link rel="manifest" href="/site.webmanifest">',
    `<script type="application/ld+json">${JSON.stringify(jsonLd(ctx, e, meta)).replace(/</g, '\\u003c')}</script>`,
  ];
  return lines.join('\n  ');
}

// ------------------------------------------------------------------ link rewriting
const PASS = /^\/(assets\/|src\/|@|node_modules\/|__|favicon|apple-touch|site\.webmanifest|og-default|robots|sitemap|llms|\.well-known|de\/)/;
export function rewriteLinks(html, { lang, base, dePaths }) {
  const strip = (p) => (base !== '/' && p.startsWith(base) ? '/' + p.slice(base.length) : p);
  const fix = (v) => {
    if (!v.startsWith('/') || v.startsWith('//')) return v;
    let p = strip(v);
    const m = p.match(/^([^?#]*)(.*)$/); let path = m[1]; const rest = m[2];
    if (path === '/index.html') path = '/';
    if (lang === 'de' && !PASS.test(path) && dePaths.has(path)) path = '/de' + path;
    else if (lang === 'de' && path === '/') path = '/de/';
    p = path + rest;
    return base === '/' || p.startsWith('/@') ? p : base + p.slice(1);
  };
  return html.replace(/(\s(?:href|src|poster|action|data-src)=")([^"]*)(")/g, (m, a, v, c) => a + fix(v) + c);
}

// ------------------------------------------------------------------ slots / pages
const icon = (id, cls = 'icon icon-text') => `<svg class="${cls}" aria-hidden="true"><use href="/assets/icons/sprite.svg#${id}"/></svg>`;
const chip = (ctx, cat, lang, cls = 'chip--tag') => `<span class="chip ${cls}">${icon(CAT_ICON[cat])}<span data-i18n="${CAT_KEY[cat]}">${esc(ctx.get(CAT_KEY[cat], lang))}</span></span>`;

// customer 2026-11-13: a list card shows NO availability mark (the catalogue lists only in-stock items; the mark belongs on non-catalogue pages only)
export function productCard(ctx, p, lang, { level = 2 } = {}) {
  return `<a class="card card--link product-card" href="/products/${p.slug}/" data-slug="${p.slug}"${lang === 'de' ? ' hreflang="en"' : ''}>
    <div class="product-card__tags">${p.categories.map((c) => chip(ctx, c, lang)).join('')}</div>
    <h${level} class="product-card__title">${esc(p.name)}</h${level}>
    <div class="product-card__footer"><span data-i18n="common.know_more">${esc(ctx.get('common.know_more', lang))}</span><span class="round-btn round-btn--outline">${icon('arrow-up-right', 'icon')}</span></div>
  </a>`;
}

// one definition of the product CTA (customer 2026-11-13): rendered twice on a product page, under the intro (slot cta-top) and under the info tiles (slot cta)
function productCta(ctx, p, lang) {
  const key = p.availability === 'in_stock' ? 'product.cta_quote' : 'product.cta_sourcing';
  return `<a class="btn btn--primary btn--lg btn--split" href="/contact.html?product=${encodeURIComponent(p.slug)}"><span data-i18n="${key}">${esc(ctx.get(key, lang))}</span><svg class="icon" aria-hidden="true"><use href="/assets/icons/sprite.svg#arrow-up-right"/></svg></a>`;
}

function specRows(ctx, p, lang) {
  const t = (k) => ctx.get(k, lang);
  const rows = [[t('product.spec_name'), esc(p.name)]];
  if (p.inn) rows.push(['INN', esc(p.inn)]);
  if (p.cas) rows.push([t('product.cas'), esc(p.cas)]);
  if (p.formula) rows.push([t('product.formula'), esc(p.formula)]);
  if (p.colour) rows.push([t('product.spec_appearance'), esc(p.colour)]);
  rows.push([t('product.spec_category'), p.categories.map((c) => esc(t(CAT_KEY[c]))).join(', ')]);
  if (p.availability !== 'in_stock') rows.push([t('product.spec_status'), esc(t(`product.status_${p.availability}`))]);
  rows.push([t('product.spec_updated'), `<time datetime="${p.updated_at}">${p.updated_at}</time>`]);
  return rows;
}

function related(ctx, p, lang) {
  const same = ctx.products.filter((q) => q.slug !== p.slug && q.indexable && q.categories.some((c) => p.categories.includes(c)));
  same.sort((a, b) => (b.primary === p.primary) - (a.primary === p.primary) || a.id - b.id);
  const pick = same.slice(0, 3);
  if (!pick.length) return '';
  const h = ctx.get('product.related', lang);
  return `<section class="section--sm product-related" aria-labelledby="related-title"><div class="container stack stack--5">
    <div class="section-head"><h2 class="t-h2 t-accent" id="related-title" data-i18n="product.related">${esc(h)}</h2></div>
    <div class="grid-3">${pick.map((q) => productCard(ctx, q, lang, { level: 3 })).join('\n')}</div>
    <a class="btn btn--secondary btn--md" href="/catalog.html"><span data-i18n="common.all_products">${esc(ctx.get('common.all_products', lang))}</span><svg class="icon" aria-hidden="true"><use href="/assets/icons/sprite.svg#arrow-up-right"/></svg></a>
  </div></section>`;
}

function answerBlock(ctx, p, lang) {
  const cat = ctx.get(CAT_KEY[p.primary], lang);
  const cas = p.cas ? ` (CAS ${p.cas})` : '';
  return ctx.tt(lang, p.availability === 'in_stock' ? 'product.answer_stock' : 'product.answer_request', { name: p.name, cas, category: cat });
}

function fill(html, slots) {
  return Object.entries(slots).reduce((h, [k, v]) => h.split(`<!--@slot:${k}-->`).join(v), html);
}

function hubSlots(ctx, e) {
  const lang = e.lang; const list = hubProducts(ctx, e.hub).sort(sortName);
  const t = (k) => ctx.get(k, lang); const reg = e.reg[lang] || e.reg.en;
  const nav = [['/products/a-z/', t('hub.az_nav')], ...CATS.map((c) => [catPath(c), t(CAT_KEY[c])]), ['/catalog.html', t('hub.in_stock_nav')]]
    .filter(([href]) => href !== e.reg.path)
    .map(([href, label]) => `<a class="btn btn--secondary btn--md" href="${href}"><span>${esc(label)}</span><svg class="icon" aria-hidden="true"><use href="/assets/icons/sprite.svg#arrow-up-right"/></svg></a>`).join('');
  let listHtml;
  if (e.hub === 'az') {
    const letters = [...new Set(list.map((p) => (/^[A-Z]/i.test(p.name) ? p.name[0].toUpperCase() : AZ_SPECIAL)))].sort();
    const jump = `<nav class="row row--2 row--wrap" aria-label="${escAttr(t('hub.az_jump'))}">${letters.map((l) => `<a class="btn btn--secondary btn--sm" href="#letter-${l === AZ_SPECIAL ? '0' : l}">${l}</a>`).join('')}</nav>`;
    const secs = letters.map((l) => {
      const items = list.filter((p) => (/^[A-Z]/i.test(p.name) ? p.name[0].toUpperCase() : AZ_SPECIAL) === l);
      return `<section class="stack stack--5" id="letter-${l === AZ_SPECIAL ? '0' : l}" aria-labelledby="letter-title-${l === AZ_SPECIAL ? '0' : l}"><h2 class="t-h2 t-accent" id="letter-title-${l === AZ_SPECIAL ? '0' : l}">${l}</h2><div class="grid-3">${items.map((p) => productCard(ctx, p, lang, { level: 3 })).join('\n')}</div></section>`;
    }).join('\n');
    listHtml = `<div class="stack stack--7">${jump}${secs}</div>`;
  } else {
    listHtml = `<h2 class="t-h2 t-accent" id="hub-list-title">${esc(ctx.tt(lang, 'hub.list_title', { n: list.length, category: t(CAT_KEY[e.hub]) }))}</h2><div class="grid-3">${list.map((p) => productCard(ctx, p, lang, { level: 3 })).join('\n')}</div>`;
  }
  return {
    h1: esc(reg.h1 || reg.name || reg.title), intro: esc(reg.intro || reg.description), nav, list: e.hub === 'az' ? listHtml : `<div class="stack stack--5">${listHtml}</div>`,
    crumb: esc(reg.name || reg.h1),
  };
}

export function renderPage(ctx, e, srcHtml, { vite = false } = {}) {
  const { config, base } = ctx; const lang = e.lang;
  let html = srcHtml;
  const meta = metaFor(ctx, e);
  // dynamic slots
  if (e.kind === 'product') {
    const p = e.product; const t = (k) => ctx.get(k, lang);
    const cta = productCta(ctx, p, lang);
    const cards = [];
    const card = (id, ic, label, body) => `<div class="card info-card" data-block="${id}"><div class="info-card__head"><span class="icon-ring">${icon(ic)}</span><h2 class="info-card__label">${esc(label)}</h2></div>${body}</div>`;
    if (p.description) cards.push(card('description', 'info-diamond', t('product.description'), `<p class="info-card__value info-card__value--body">${esc(p.description)}</p>`));
    if (p.usage) cards.push(card('usage', 'search-check', t('product.usage'), `<p class="info-card__value info-card__value--body">${esc(p.usage)}</p>`));
    const table = `<table class="spec-table"><tbody>${specRows(ctx, p, lang).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
    cards.push(card('specs', 'file', t('product.specs'), `<div class="info-card__value info-card__value--body">${table}</div>`).replace('class="card info-card"', 'class="card info-card info-card--wide"'));
    if (p.faq?.length) cards.push(`<div class="card info-card info-card--wide" data-block="faq"><div class="info-card__head"><span class="icon-ring">${icon('chat-lines')}</span><h2 class="info-card__label">${esc(t('product.faq'))}</h2></div><div class="info-card__value info-card__value--body">${p.faq.map((f) => `<h3 class="t-lead">${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</div></div>`);
    const cas = p.cas ? `<span class="chip chip--pill chip--sm"><span class="meta-tag__key" data-i18n="product.cas">${esc(t('product.cas'))}</span><span>${esc(p.cas)}</span></span>` : '';
    const status = p.availability === 'in_stock' ? '' : `<span class="chip chip--pill chip--sm"><span class="meta-tag__key" data-i18n="product.spec_status">${esc(t('product.spec_status'))}</span><span data-i18n="product.status_${p.availability}">${esc(t(`product.status_${p.availability}`))}</span></span>`;
    html = html.split('{{name}}').join(esc(p.name));
    html = fill(html, {
      tags: p.categories.map((c) => chip(ctx, c, lang, 'chip--pill chip--sm')).join('') + cas + status,
      answer: esc(answerBlock(ctx, p, lang)),
      cards: cards.join('\n'),
      cta,
      'cta-top': cta,
      related: related(ctx, p, lang),
    });
  } else if (e.kind === 'hub') {
    const s = hubSlots(ctx, e);
    html = html.split('{{h1}}').join(s.h1).split('{{crumb}}').join(s.crumb);
    html = fill(html, { intro: s.intro, nav: s.nav, list: s.list });
  } else if (e.kind === 'catalog') {
    const list = ctx.products.filter((p) => p.availability === 'in_stock' && p.indexable).sort(sortName);
    html = fill(html, { 'catalog-list': list.map((p) => productCard(ctx, p, lang)).join('\n') });
  }
  // i18n prerender
  const urlFn = (v) => v;
  html = applyI18n(html, (k, l) => ctx.get(k, l), lang, urlFn);
  // head: remove existing title/description/canonical/icon, inject the block after the viewport meta
  html = html.replace(/<title>[\s\S]*?<\/title>\s*/gi, '').replace(/<meta\s+name="description"[^>]*>\s*/gi, '').replace(/<link\s+rel="(?:canonical|icon|apple-touch-icon|manifest)"[^>]*>\s*/gi, '');
  const block = headBlock(ctx, e, meta);
  html = /<meta name="viewport"[^>]*>/.test(html) ? html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n  ${block.replace(/\$/g, '$$$$')}`) : html.replace(/<head>/, `<head>\n  ${block.replace(/\$/g, '$$$$')}`);
  // <html lang, data-ssr, switch targets>
  const sw = switchTargets(ctx, e);
  const rel = (u) => u.slice(ctx.siteUrl.length) || '/';
  html = html.replace(/<html\b[^>]*>/, `<html lang="${lang}" data-ssr="${lang}" data-alt-en="${rel(sw.en)}" data-alt-de="${rel(sw.de)}">`);
  // links (language prefix + base). Meta URLs are already absolute.
  const dePaths = new Set(ctx.pages.filter((x) => x.lang === 'de').map((x) => x.urlPath.slice(3) || '/'));
  html = rewriteLinks(html, { lang, base, dePaths });
  // data-alt-* hold site paths: add base
  if (base !== '/') html = html.replace(/(data-alt-(?:en|de)=")\/([^"]*")/g, (m, a, r) => `${a}${base}${r}`);
  // language options in the switcher are real links to the equivalent page of the other language (crawlable without JS)
  const alt = { en: html.match(/data-alt-en="([^"]*)"/)?.[1], de: html.match(/data-alt-de="([^"]*)"/)?.[1] };
  html = html.replace(/(<a\b[^>]*\bclass="lang-menu__option"[^>]*?\bhref=")[^"]*("[^>]*\bdata-lang="(en|de)")/g, (m, a, b, l) => `${a}${alt[l] || ''}${b}`);
  return html;
}

// ------------------------------------------------------------------ sitemap / robots / llms
const urlEntry = (ctx, e) => {
  const alt = alternates(ctx, e);
  const xl = alt ? Object.entries(alt).concat([['x-default', alt.en]]).map(([l, u]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${u}"/>`).join('\n') + '\n' : '';
  return `  <url>\n    <loc>${esc(e.url)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n${xl}  </url>`;
};
const urlset = (ctx, list) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${list.map((e) => urlEntry(ctx, e)).join('\n')}\n</urlset>\n`;

export function indexable(ctx) { return ctx.pages.filter((e) => !e.noindex && ctx.config.indexing); }

export function buildSitemaps(ctx) {
  const ix = indexable(ctx);
  const parts = {
    'sitemap-pages.xml': ix.filter((e) => e.kind === 'static' || e.kind === 'catalog'),
    'sitemap-hubs.xml': ix.filter((e) => e.kind === 'hub'),
    'sitemap-products-in-stock.xml': ix.filter((e) => e.kind === 'product' && e.product.availability === 'in_stock'),
    'sitemap-products-on-request.xml': ix.filter((e) => e.kind === 'product' && e.product.availability === 'on_request'),
  };
  const files = {}; const idx = [];
  for (const [name, list] of Object.entries(parts)) {
    if (!list.length) continue; // an empty urlset is invalid
    files[name] = urlset(ctx, list.sort((a, b) => a.url.localeCompare(b.url)));
    idx.push(`  <sitemap>\n    <loc>${ctx.abs('/' + name)}</loc>\n    <lastmod>${list.map((e) => e.lastmod).sort().at(-1)}</lastmod>\n  </sitemap>`);
  }
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${idx.join('\n')}\n</sitemapindex>\n`;
  return files;
}

export function buildRobots(ctx) {
  const { config, abs } = ctx;
  const search = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User'];
  const training = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];
  const dis = ['/design-system.html'];
  const rules = (ua, allow) => `User-agent: ${ua}\n${allow ? 'Allow: /\n' + dis.map((d) => `Disallow: ${d}`).join('\n') : 'Disallow: /'}\n`;
  const allowAll = config.indexing;
  let s = `# robots.txt for ${ctx.siteUrl}\n# NOTE: crawlers read robots.txt only at the ROOT of a host. On GitHub Pages in a sub-path (/osta/) this file is NOT honoured;\n# it becomes effective once the site is served from the root of its own domain (see content/seo/README.md).\n\n`;
  s += rules('*', allowAll) + '\n';
  s += '# AI search / answer bots: allowed so the site can be cited in AI answers\n' + search.map((b) => rules(b, allowAll)).join('\n') + '\n';
  s += `# AI training bots: configurable via site.config.json "aiTrainingBots" (allow | disallow)\n` + training.map((b) => rules(b, allowAll && config.aiTrainingBots === 'allow')).join('\n') + '\n';
  s += `Sitemap: ${abs('/sitemap.xml')}\n`;
  return s;
}

export function buildLlms(ctx) {
  const { config, abs, get } = ctx; const c = config.company;
  const reg = ctx.registry;
  const line = (k, path) => `- [${(reg[k].en.name || reg[k].en.title)}](${abs(path)}): ${reg[k].en.description}`;
  const inStock = ctx.products.filter((p) => p.indexable && p.availability === 'in_stock').sort(sortName);
  const onReq = ctx.products.filter((p) => p.indexable && p.availability === 'on_request').sort(sortName);
  return `# OSTA Trading GmbH

> ${stripTags(get('about.intro_lead'))} Warehouse in Reinbek, Hamburg metropolitan area, Germany. The site is available in English and German.

OSTA Trading GmbH is registered in EudraGMDP as an API distributor, and its warehouse operates in compliance with GDP requirements. Products are listed with CAS number, formula and appearance where known; every product page offers a quotation request. There are no prices on the site: prices and terms are agreed per request.

## Key pages
${['about', 'services', 'catalog', 'faq', 'contact'].map((k) => line(k, reg[k].path)).join('\n')}
- [Imprint](${abs('/impressum.html')}): legal details

## Product hubs
- [A–Z index](${abs('/products/a-z/')}): all products with availability status
${CATS.map((cat) => `- [${get(CAT_KEY[cat])}](${abs(catPath(cat))}): ${reg['hub-' + cat].en.description}`).join('\n')}

## Products in stock
${inStock.map((p) => `- [${p.name}](${abs(`/products/${p.slug}/`)})${p.cas ? ` (CAS ${p.cas})` : ''}`).join('\n') || '- (none yet)'}
${onReq.length ? `\n## Products available on request\n${onReq.map((p) => `- [${p.name}](${abs(`/products/${p.slug}/`)})${p.cas ? ` (CAS ${p.cas})` : ''}`).join('\n')}\n` : ''}
## Contact
- Address: ${c.legalName}, ${c.streetAddress}, ${c.postalCode} ${c.addressLocality}, Germany
- Email: ${c.email}
- Phone: ${c.telephone}
- Fax: ${c.fax}

## Optional
- [German version](${abs('/de/')}): Deutsche Fassung der Website
- [Sitemap](${abs('/sitemap.xml')})
`;
}

export function buildManifest(ctx) {
  const base = ctx.base;
  return JSON.stringify({ name: 'OSTA Trading GmbH', short_name: 'OSTA', description: ctx.get('meta.home_description'), start_url: base, scope: base, display: 'browser', background_color: '#ffffff', theme_color: ctx.config.themeColor, icons: [{ src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' }] }, null, 2) + '\n';
}

export function buildSecurityTxt(ctx) {
  const s = ctx.config.securityTxt;
  return `# PLACEHOLDER contact: replace with a monitored security address.\nContact: ${s.contact}\nExpires: ${s.expires}\nPreferred-Languages: ${s.preferredLanguages}\nCanonical: ${ctx.abs('/.well-known/security.txt')}\n`;
}

export function shimHtml(ctx) {
  const e = ctx.pages.find((p) => p.kind === 'shim'); const meta = metaFor(ctx, e);
  const known = JSON.stringify(ctx.products.map((p) => p.slug));
  const catalog = ctx.abs('/catalog.html');
  const head = headBlock(ctx, { ...e, key: 'product-shim', reg: e.reg, langs: ['en'] }, meta).replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${catalog}">`);
  return `<!doctype html>
<html lang="en" data-ssr="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${head}
  <meta http-equiv="refresh" content="4;url=${ctx.base}catalog.html">
  <script>(function(){var s=new URLSearchParams(location.search).get('slug'),k=${known},b=location.pathname.replace(/product\\.html$/,'');location.replace(s&&k.indexOf(s)>-1?b+'products/'+s+'/':(s?b+'404.html':b+'catalog.html'));})();</script>
</head>
<body>
  <p>This page has moved. <a href="${ctx.base}catalog.html">Open the OSTA Trading product catalogue</a>.</p>
</body>
</html>
`;
}
export { CATS, CAT_KEY, CAT_ICON };
