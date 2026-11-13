/* Generates the brand assets from the existing logo (public/assets/img/logo.png) with headless Chrome (puppeteer-core):
   public/og-default.png (1200x630, white logo on --surface-accent blue), favicon.ico (PNG-in-ICO 32+48), favicon.svg (embeds the logo PNG),
   apple-touch-icon.png (180), icon-192.png, icon-512.png. No new graphics: only the supplied logo. Usage: node tools/og.cjs */
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'public/assets/img/logo.png')).toString('base64');
const font = 'data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'public/assets/fonts/AstaSans-Medium.woff2')).toString('base64');
const tokens = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
const blue = (tokens.match(/--c-blue-700:\s*(#[0-9a-fA-F]{6})/) || [])[1] || '#0a3782';

const ogHtml = `<style>@font-face{font-family:A;src:url(${font})}*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:${blue};font-family:A,sans-serif;color:#fff;display:flex;align-items:center;gap:72px;padding:0 96px}
img{height:300px;filter:brightness(0) invert(1)}h1{font-size:60px;line-height:1.1;font-weight:500;letter-spacing:-.01em}p{margin-top:24px;font-size:28px;opacity:.85}</style>
<body><img src="${logo}"><div><h1>APIs, excipients and specialty ingredients</h1><p>OSTA Trading GmbH · Reinbek near Hamburg</p></div></body>`;
const iconHtml = (s) => `<style>*{margin:0}body{width:${s}px;height:${s}px;background:#fff;display:flex;align-items:center;justify-content:center}img{width:${Math.round(s * 0.8)}px;height:auto}</style><body><img src="${logo}"></body>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const shot = async (html, w, h, file) => { await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await page.setContent(html, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready); const buf = await page.screenshot({ type: 'png', omitBackground: false }); if (file) fs.writeFileSync(path.join(ROOT, 'public', file), buf); return buf; };
  await shot(ogHtml, 1200, 630, 'og-default.png');
  await shot(iconHtml(180), 180, 180, 'apple-touch-icon.png');
  await shot(iconHtml(192), 192, 192, 'icon-192.png');
  await shot(iconHtml(512), 512, 512, 'icon-512.png');
  const p32 = await shot(iconHtml(32), 32, 32); const p48 = await shot(iconHtml(48), 48, 48);
  const imgs = [p32, p48]; const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = 6 + 16 * imgs.length; const dirs = []; imgs.forEach((b, i) => { const d = Buffer.alloc(16); const s = i ? 48 : 32; d[0] = s; d[1] = s; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(b.length, 8); d.writeUInt32LE(off, 12); off += b.length; dirs.push(d); });
  fs.writeFileSync(path.join(ROOT, 'public/favicon.ico'), Buffer.concat([head, ...dirs, ...imgs]));
  fs.writeFileSync(path.join(ROOT, 'public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192" width="64" height="64"><image width="192" height="192" xlink:href="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'public/icon-192.png')).toString('base64')}"/></svg>\n`);
  await browser.close();
  console.log('brand assets written to public/');
})();
