// Mini-plugin: replaces <!--@include partials/name.html--> with the file content (recursive).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RE = /<!--@include\s+([^\s>]+)\s*-->/g;

export function includePartials({ root }) {
  const expand = (html, depth = 0) => {
    if (depth > 5) throw new Error('include depth exceeded');
    return html.replace(RE, (_, file) => expand(readFileSync(resolve(root, file), 'utf8'), depth + 1));
  };
  return {
    name: 'osta-include-partials',
    enforce: 'pre',
    transformIndexHtml: { order: 'pre', handler: (html) => expand(html) },
    handleHotUpdate({ file, server }) {
      if (file.includes('/src/partials/')) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

// Build only: prefix root-absolute page links (href="/about.html#team") with the Vite base.
// Assets/scripts/styles are already rewritten by Vite itself; values already starting with base are left alone.
export function baseLinks() {
  let base = '/';
  let build = false;
  return {
    name: 'osta-base-links',
    configResolved(c) { base = c.base; build = c.command === 'build'; },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!build || base === '/') return html;
        return html.replace(/(\s(?:href|src|poster|data-src|content|action)=")\/(?!\/|@vite)([^"]*")/g, (m, a, rest) =>
          ('/' + rest).startsWith(base) ? m : `${a}${base}${rest}`);
      },
    },
  };
}
