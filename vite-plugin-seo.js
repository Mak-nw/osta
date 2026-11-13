// SEO plugin: static prerender of i18n (EN at /, DE at /de/), generated product/hub pages, meta + JSON-LD,
// sitemap*.xml, robots.txt, llms.txt, site.webmanifest, security.txt.
//  build: everything is produced in generateBundle from the HTML Vite already bundled (hashed assets, base applied);
//  dev:   a middleware serves the same pages (source file -> server.transformIndexHtml -> renderPage), so dev == prod.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSite, renderPage, shimHtml, rewriteLinks, buildSitemaps, buildRobots, buildLlms, buildManifest, buildSecurityTxt } from './seo/core.js';

const ROOT = import.meta.dirname;
const TEXT = { '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' };

export function seo() {
  let base = '/';
  const extras = (ctx) => ({
    'robots.txt': buildRobots(ctx), 'llms.txt': buildLlms(ctx), 'site.webmanifest': buildManifest(ctx), '.well-known/security.txt': buildSecurityTxt(ctx), ...buildSitemaps(ctx),
  });
  return {
    name: 'osta-seo',
    enforce: 'post',
    configResolved(c) { base = c.base; },
    handleHotUpdate({ file, server }) {
      if (/\/(src\/i18n|src\/data|src\/templates)\/|content\/seo\/|site\.config\.json|\/seo\//.test(file)) { server.ws.send({ type: 'full-reload' }); return []; }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          const url = new URL(req.url, 'http://localhost');
          const p = decodeURIComponent(url.pathname);
          if (p.startsWith('/@') || p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/__')) return next();
          const ctx = loadSite({ base: '/' });
          const x = extras(ctx);
          const extra = x[p.slice(1)];
          if (extra != null) { res.setHeader('Content-Type', TEXT[p.match(/\.[a-z]+$/)?.[0]] || 'text/plain; charset=utf-8'); return res.end(extra); }
          const path = p === '/index.html' ? '/' : p;
          const e = ctx.pages.find((q) => q.urlPath === path) || ctx.pages.find((q) => q.urlPath === path + '/' && q.kind !== 'static');
          if (!e) return next();
          if (e.urlPath !== path) { res.statusCode = 301; res.setHeader('Location', e.urlPath + url.search); return res.end(); }
          let out;
          if (e.kind === 'shim') out = rewriteLinks(shimHtml(ctx), { lang: 'en', base: '/', dePaths: new Set() });
          else {
            const file = resolve(ROOT, e.source);
            if (!existsSync(file)) return next();
            const transformed = await server.transformIndexHtml(e.urlPath, readFileSync(file, 'utf8'), req.originalUrl);
            out = renderPage(ctx, e, transformed);
          }
          res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
          res.end(out);
        } catch (err) { next(err); }
      });
    },
    generateBundle: { order: 'post', handler(_, bundle) {
      const ctx = loadSite({ base });
      const srcOf = (file) => { const a = bundle[file]; if (!a || a.type !== 'asset') throw new Error(`[osta-seo] missing bundled HTML: ${file}; have: ${Object.keys(bundle).filter((k) => k.endsWith('.html')).join(', ')}`); return String(a.source); };
      const sources = new Map();
      for (const e of ctx.pages) if (e.source && !sources.has(e.source)) sources.set(e.source, srcOf(e.source));
      for (const e of ctx.pages) {
        const html = e.kind === 'shim' ? rewriteLinks(shimHtml(ctx), { lang: 'en', base, dePaths: new Set() }) : renderPage(ctx, e, sources.get(e.source));
        if (bundle[e.outFile]) bundle[e.outFile].source = html;
        else this.emitFile({ type: 'asset', fileName: e.outFile, source: html });
      }
      for (const t of ['src/templates/product.html', 'src/templates/hub.html']) delete bundle[t];
      for (const [fileName, source] of Object.entries(extras(ctx))) this.emitFile({ type: 'asset', fileName, source });
    } },
  };
}
