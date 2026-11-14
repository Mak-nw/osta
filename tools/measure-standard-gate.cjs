#!/usr/bin/env node
/* Measure-standard gate (rule M1, customer 2026-11-14), `npm run audit:measure`.
   ONE measuring basis for all spacing = the VISIBLE height of letters (cap-top ... baseline, no line-height leading).
   A. COMPUTED: every text member of a spacing group (headings, p, dt/dd, li, tags/labels, role classes; selector MEMBERS) on every page at 1440 and 375 has computed
      `text-box-trim: trim-both` with edge `cap alphabetic` (base.css, ONE shared rule), unless it is a documented exception (EXC below: selector + reason).
   B. CLIP: a trimmed member's real glyph extent (ascender 'Hdlb' ... descender 'gpqy') is not cut by an overflow-clipping ancestor (trim moves the box edge to cap-top / baseline).
   C. OVERLAY = INDEPENDENT INK: for sample pairs (Contact, Documentation card, Logistics section) the number the 'Стиль' overlay (dev-tools/review/inspector.js) prints for the gap
      between two text elements equals the independent ink measurement (canvas cap height + text-node baseline, tools/measure-standard-lib.cjs) within 0.5 px.
   Usage: node tools/measure-standard-gate.cjs [--url http://localhost:5173] [--widths 1440,375] [--pages all|a,b] [--no-overlay] [--verbose]. Exit != 0 on FAIL. */
const cp = require('child_process');
const puppeteer = require('puppeteer-core');
const L = require('./icon-gate-lib.cjs');
const M = require('./measure-standard-lib.cjs');
const argv = process.argv.slice(2);
const cfg = L.parse(argv.includes('--widths') ? argv : argv.concat(['--widths', '1440,375']));
const VERBOSE = argv.includes('--verbose'), NO_OVERLAY = argv.includes('--no-overlay');
try { const out = cp.execSync("pgrep -f '^node .*(measure-standard|card-padding|card-row|hover-gate|style-gate|poster-swap|grid-snap|hero-fit|header-geo|icon-|scroll-trap|link-targets)'", { encoding: 'utf8' }).split('\n').filter(Boolean).filter((p) => Number(p) !== process.pid);
  if (out.length) { console.error('another gate is running (pid ' + out.join(',') + '): not running two gates in parallel'); process.exit(3); } } catch (e) { /* no match */ }

/* Text members of spacing groups (same list as the shared rule in src/styles/base.css). */
const MEMBERS = 'h1,h2,h3,h4,h5,h6,p,dt,dd,li,legend,figcaption,label.field__label,.t-display,.t-h1,.t-h2,.t-h3,.t-lead,.t-body,.t-label,.section-label,.people-card__name,.people-card__role';
/* Documented exceptions: not trimmed on purpose. Each = selector (matches the member or an ancestor) + reason. */
const EXC = [
  { sel: 'a, button, .btn, .contact-line, [role=button], summary, select, option, .chip, .filter-item, .lang-switch, .lang-menu, .nav-pill, .round-btn, .header__burger', reason: 'text inside a fixed-height control: the painted box (hit area) is the unit, gaps are measured to the box; label centred by the control height' },
  { sel: 'dd:has(.contact-line)', reason: 'dd holds a contact-line control (ring row), the control box is the unit' },
  { sel: '.hero-scene__label, .process-steps__dot, [aria-hidden=true][class*=scene], [data-scene]', reason: 'text label drawn on a 3D / illustration scene (positioned by the scene, not part of a spacing group)' },
  { sel: '.field__label.is-floating, .field--pill .field__label', reason: 'label floating inside a field (absolute, centred by the control height; trim set in forms.css where needed)' },
  { sel: '.design-system-page [class*=specimen], .ds-demo', reason: 'design-system showcase specimens (documentation of states)' },
  { sel: '.footer__label, .footer__reach-label', reason: 'footer link rows: hit-area padding (5/7 rule A3.1), the link box is the unit' },
];

function inpage({ MEMBERS, EXC, FREEZE }) {
  const st = document.createElement('style'); st.textContent = FREEZE; document.head.append(st);
  const ctx = document.createElement('canvas').getContext('2d');
  const sig = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '');
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const inlineOnly = (e, d = 0) => { if (d > 4) return false; for (const c of e.children) { const dd = getComputedStyle(c).display; if (!['inline', 'inline-block', 'contents'].includes(dd) || c instanceof SVGElement) return false; if (!inlineOnly(c, d + 1)) return false; } return true; };
  const exempt = (e) => { for (const x of EXC) { try { if (e.closest(x.sel)) return x.reason; } catch (err) { /* :has unsupported */ } } return null; };
  const rows = [], bad = [], clip = [], exm = {};
  let n = 0, trimmed = 0, ex = 0, inlineSkipped = 0;
  for (const el of document.body.querySelectorAll(MEMBERS)) {
    if (el instanceof SVGElement) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1) continue;
    if (!/\S/.test(el.textContent)) continue;
    if (!(own(el) || inlineOnly(el))) continue;                      /* only text members (text directly or in inline words / spans) */
    if (cs.display === 'inline') { inlineSkipped++; continue; }
    const why = exempt(el);
    if (why) { ex++; exm[why] = (exm[why] || 0) + 1; continue; }
    n++;
    const ok = cs.textBoxTrim === 'trim-both' && /cap/.test(cs.textBoxEdge) && /alphabetic/.test(cs.textBoxEdge);
    if (ok) trimmed++; else { const k = sig(el) + ' [' + cs.display + ']'; bad.push(k + ' "' + el.textContent.trim().slice(0, 18) + '"'); }
    if (ok) {                                                       /* clip check: real glyph extent vs clipping ancestors */
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText('Hdlb'), fa = m.fontBoundingBoxAscent, asc = m.actualBoundingBoxAscent, desc = ctx.measureText('gpqy').actualBoundingBoxDescent;
      let first = Infinity, last = -Infinity; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) { if (!t.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(t); for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) { first = Math.min(first, q.top); last = Math.max(last, q.top); } }
      if (Number.isFinite(first)) {
        const gTop = first + fa - asc, gBot = last + fa + desc;
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const ac = getComputedStyle(a); if (!/(hidden|clip|auto|scroll)/.test(ac.overflowY)) continue;
          const ar = a.getBoundingClientRect(), top = ar.top + parseFloat(ac.borderTopWidth), bot = ar.bottom - parseFloat(ac.borderBottomWidth);
          if (a.scrollHeight > a.clientHeight + 1 && /(auto|scroll)/.test(ac.overflowY)) break;                 /* scroll container: not a static clip */
          if (gTop < top - 0.5 || gBot > bot + 0.5) { clip.push(sig(el) + ' "' + el.textContent.trim().slice(0, 14) + '" in ' + sig(a) + ' (glyph ' + (+gTop.toFixed(1)) + '..' + (+gBot.toFixed(1)) + ' vs clip ' + (+top.toFixed(1)) + '..' + (+bot.toFixed(1)) + ')'); break; }
        }
      }
    }
  }
  return { n, trimmed, ex, exm, inlineSkipped, bad, clip, noSupport: !CSS.supports('text-box', 'trim-both cap alphabetic') };
}

(async () => {
  const res = await L.run(cfg, inpage, { MEMBERS, EXC, FREEZE: M.FREEZE_CSS });
  let fails = 0; const agg = {}, clipAll = [], excAll = {};
  console.log('M1 A. computed text-box-trim of text members (page @ width: members | trimmed | exempt | NOT trimmed)');
  for (const r of res) {
    if (r.noSupport) { console.log(`${r.page}@${r.w}: browser without text-box support, skipped`); continue; }
    const f = r.n - r.trimmed; if (f) fails++;
    for (const [k, v] of Object.entries(r.exm)) excAll[k] = (excAll[k] || 0) + v;
    for (const b of r.bad) { const k = b.replace(/ ".*$/, ''); (agg[k] = agg[k] || { n: 0, e: `${r.page}@${r.w} ${b}` }).n++; }
    for (const c of r.clip) clipAll.push(`${r.page}@${r.w}: ${c}`);
    if (VERBOSE || f) console.log(`${(r.page + '@' + r.w).padEnd(34)} ${String(r.n).padStart(4)} | ${String(r.trimmed).padStart(4)} | ${String(r.ex).padStart(4)} | ${f ? 'FAIL ' + f : 'PASS'}`);
  }
  const tot = res.reduce((s, r) => ({ n: s.n + r.n, t: s.t + r.trimmed, e: s.e + r.ex }), { n: 0, t: 0, e: 0 });
  console.log(`A total: ${tot.n} members, ${tot.t} trimmed, ${tot.e} documented exceptions over ${res.length} loads -> ${tot.n === tot.t ? 'PASS' : 'FAIL'}`);
  for (const [k, v] of Object.entries(agg)) console.log(`   NOT trimmed: ${k} x${v.n}  e.g. ${v.e}`);
  console.log('   exceptions used (count: reason):'); for (const [k, v] of Object.entries(excAll)) console.log(`     ${v}: ${k}`);
  console.log(`M1 B. clipped glyphs (ascender / descender cut by an overflow ancestor): ${clipAll.length ? 'FAIL ' + clipAll.length : 'PASS 0'}`);
  for (const c of [...new Set(clipAll)].slice(0, 12)) console.log('   ' + c); if (clipAll.length) fails++;
  if (tot.n !== tot.t) fails++;

  if (!NO_OVERLAY) {
    console.log('M1 C. overlay "Стиль" number vs independent ink (tolerance 0.5 px)');
    const SAMPLES = [['Contact', 'contact.html', '.contact-split__content'], ['Documentation (home text-card)', '', '.text-card--on-light'], ['Logistics (home)', '', '#home-supply-title']];
    const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
    let cmp = 0, bad = 0, miss = 0, noOverlay = false;
    for (const mode of ['trimmed', 'untrimmed (fallback from font metrics)']) for (const w of cfg.WIDTHS) for (const [name0, path, rootSel] of SAMPLES) {
      const name = name0 + (mode[0] === 'u' ? ' [no trim]' : '');
      const pg = await br.newPage(); await pg.setViewport({ width: w, height: 1100 });
      await pg.goto(`${cfg.URL}/${path}`, { waitUntil: 'networkidle2' });
      await pg.evaluate(async (css) => { document.querySelectorAll('[data-reveal],[data-reveal-load]').forEach((e) => { e.style.opacity = 1; e.style.transform = 'none'; e.style.transition = 'none'; }); const s = document.createElement('style'); s.textContent = css; document.head.append(s); await document.fonts.ready; }, M.FREEZE_CSS + (mode[0] === 'u' ? '*{text-box:none!important}' : ''));
      const root = await pg.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const s = e.closest('section') || e; s.id = s.id || 'm1-root'; s.scrollIntoView({ block: 'start', behavior: 'instant' }); return '#' + s.id; }, rootSel);
      await new Promise((r) => setTimeout(r, 900));
      if (!root) { console.log(`   ${name} @${w}: root missing`); bad++; await pg.close(); continue; }
      if (!(await pg.evaluate(() => !!window.__review))) { noOverlay = true; await pg.close(); continue; }
      await pg.evaluate(() => { window.__review.inspector.setMode('s', true); window.__review.inspector.update(); });
      const pr = await pg.evaluate(M.pairsInPage, { root });
      const labels = await pg.evaluate(() => { for (const h of document.querySelectorAll('*')) if (h.shadowRoot && h.shadowRoot.querySelector('.insp-s')) return [...h.shadowRoot.querySelectorAll('.insp-s .lb.lg')].map((b) => ({ x: parseFloat(b.style.left), y: parseFloat(b.style.top), t: parseFloat(b.textContent) })); return []; });
      const vh = 1100;
      for (const p of pr.pairs || []) {
        if (/^(SPAN|DD)$/.test(p.aTag) || /^(SPAN|DD)$/.test(p.bTag) || p.ink < 2 || p.ink > 70 || p.cy < 0 || p.cy > vh || p.ink !== p.ink) continue;
        const lb = labels.filter((l) => Math.abs(l.y - p.cy) <= 3 && Math.abs(l.x - p.cx) <= Math.max(8, 0.5 * 1)).sort((a, b) => Math.abs(a.t - p.ink) - Math.abs(b.t - p.ink))[0]
          || labels.filter((l) => Math.abs(l.y - p.cy) <= 3).sort((a, b) => Math.abs(a.t - p.ink) - Math.abs(b.t - p.ink))[0];
        if (!lb) { miss++; if (VERBOSE) console.log(`   ${name} @${w}: ${p.a} -> ${p.b}: independent ink ${p.ink}, overlay: no label`); continue; }
        cmp++; const d = Math.abs(lb.t - p.ink); if (d > 0.5) { bad++; console.log(`   FAIL ${name} @${w}: ${p.a} -> ${p.b}: overlay ${lb.t} vs ink ${p.ink} (box ${p.box})`); } else if (VERBOSE || p.ink > 0) console.log(`   ok   ${name} @${w}: ${p.a} -> ${p.b}: overlay ${lb.t} = ink ${p.ink} (box ${p.box})`);
      }
      await pg.close();
    }
    await br.close();
    if (noOverlay) { console.log('   overlay (window.__review) not present at ' + cfg.URL + ': dev server with the review plugin is required'); bad++; }
    console.log(`C: ${cmp} pairs compared, ${bad} mismatches, ${miss} without overlay label -> ${bad || !cmp ? 'FAIL' : 'PASS'}`);
    if (bad || !cmp) fails++;
  }
  console.log(`\nmeasure-standard: ${fails ? 'FAIL' : 'PASS'} (${cfg.PAGES.length} pages x ${cfg.WIDTHS.join('/')} px)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
