import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { includePartials, baseLinks } from './vite-plugin-include.js';
import { reviewMode } from './vite-plugin-review.js';
import { seo } from './vite-plugin-seo.js';
import { siteBasePath } from './seo/core.js';

const pages = ['index', 'about', 'catalog', 'contact', 'services', 'design-system', 'privacy', 'terms', 'data-processing', 'faq', 'impressum', '404', 'src/templates/product', 'src/templates/hub'];

export default defineConfig(({ command, isPreview }) => ({
  // Production base = path of siteUrl in site.config.json (GitHub Pages: /osta/; own domain: /); dev stays at '/'. Override with VITE_BASE.
  base: process.env.VITE_BASE ?? (command === 'build' || isPreview ? siteBasePath() : '/'),
  plugins: [
    includePartials({ root: resolve(import.meta.dirname, 'src') }),
    baseLinks(),
    seo(),
    reviewMode({ dir: resolve(import.meta.dirname, '../review') }),
  ],
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
    },
  },
}));
