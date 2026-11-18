#!/usr/bin/env node
/* No-heading-period gate, `npm run audit:no-heading-period`.
   Customer rule (2026-11-19): visible headings (h1-h6, section and card titles: t-h* / *-title / card-title classes) must not end with a single '.'.
   Not touched: '?', '!', ellipsis, and periods of known abbreviations (Co. Ltd. Inc. Corp. GmbH & Co. KG, e.g. i.e. etc. Dr. St. Nr. vs. ...). Descriptions/paragraphs are out of scope.
   Crawls every page (en + de) on the local server at --width (default 1440), visible elements only. Exit 1 on FAIL.
   Usage: node tools/no-heading-period-gate.cjs [--url http://localhost:5173] [--width 1440]. */
const { createRequire } = require('node:module');
const req = createRequire(__filename);
const puppeteer = req('puppeteer-core');
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const BASE = arg('--url', 'http://localhost:5173').replace(/\/$/, '');
const WIDTH = Number(arg('--width', '1440'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* known abbreviations whose period is part of the word (text ending with one of these is allowed) */
const ABBR = /(^|[\s&(])(Co|Ltd|Inc|Corp|GmbH|KG|Dr|Prof|St|Nr|No|vs|etc|e\.g|i\.e|Jr|Sr|Mr|Mrs|Ms|Ph\.D|U\.S|U\.K|approx|incl|z\.B|d\.h|u\.a)\.$/i;
const SEL = 'h1,h2,h3,h4,h5,h6,[class*="t-h"],[class*="card-title"],[class*="-title"],[class*="title--"]';
const KNOWN = ['/', '/de/', '/about.html', '/services.html', '/catalog.html', '/contact.html', '/faq.html', '/terms.html', '/impressum.html', '/data-processing.html', '/privacy.html', '/design-system.html'];
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900 });
  const queue = [...KNOWN, ...KNOWN.filter((k) => k !== '/' && k !== '/de/').map((k) => (k.startsWith('/de/') ? k : '/de' + k))];
  const seen = new Set(); const pages = []; const flagged = [];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue; seen.add(p);
    const r = await page.goto(BASE + p, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => null);
    if (!r || r.status() >= 400) continue;
    pages.push(p);
    const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const l of links) {
      if (!l || /^(mailto:|tel:|#)/.test(l)) continue;
      let u; try { u = new URL(l, BASE + p); } catch { continue; }
      if (u.origin !== new URL(BASE).origin) continue;
      const path = u.pathname.replace(/\/index\.html$/, '/');
      if (!/\.html$|\/$/.test(path)) continue;
      if (!seen.has(path)) queue.push(path);
    }
    const found = await page.evaluate((SEL) => {
      const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; };
      return [...document.querySelectorAll(SEL)].filter(vis).map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.innerText || '').replace(/\s+/g, ' ').trim() })).filter((x) => x.text);
    }, SEL);
    for (const f of found) {
      if (/\.$/.test(f.text) && !/\.\.$/.test(f.text) && !ABBR.test(f.text)) flagged.push({ page: p, ...f });
    }
  }
  await browser.close();
  console.log(`no-heading-period @${WIDTH}: ${pages.length} pages (en+de), ${flagged.length} heading(s) ending with a period`);
  for (const f of flagged) console.log(`  FAIL ${f.page} <${f.tag}> ${f.text.slice(0, 120)}`);
  console.log(flagged.length ? 'FAIL' : 'PASS 0');
  process.exit(flagged.length ? 1 : 0);
})();
