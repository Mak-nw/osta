import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { includePartials, baseLinks } from './vite-plugin-include.js';
import { reviewMode } from './vite-plugin-review.js';

const pages = ['index', 'about', 'catalog', 'product', 'contact', 'services', 'design-system', 'privacy', 'terms', 'data-processing'];

export default defineConfig(({ command, isPreview }) => ({
  // Production is served from a sub-path (https://mak-nw.github.io/osta/); dev stays at '/'. Override with VITE_BASE.
  base: process.env.VITE_BASE ?? (command === 'build' || isPreview ? '/osta/' : '/'),
  plugins: [
    includePartials({ root: resolve(import.meta.dirname, 'src') }),
    baseLinks(),
    reviewMode({ dir: resolve(import.meta.dirname, '../review') }),
  ],
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
    },
  },
}));
