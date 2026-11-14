#!/usr/bin/env node
/* Icon-text-align gate (rules ICON-C / ICON-D, customer 2026-11-14).
   C. in a row with text the icon BOX aligns to the glyph height of the text (ink, not line-height): box top/bottom = text ink top/bottom within 1 px.
      The VISIBLE icon is measured (rendered ink of the glyph = bounding box of the <use> content + half the stroke), not the empty svg/box.
      Text ink = actual string for rows outside set T; for set T (contact rows, chips, filters) the CAP HEIGHT of the face (cap top ... baseline; descenders hang below), so all glyphs of the set are equal (ICON-A), tolerance 0.5 px (canvas measureText; baseline =
      Range rect top + fontBoundingBoxAscent, so the result is what is painted). Also checked: the visible glyph is centred in its box (<= 1 px) and fills it minus the gap (ICON-B).
   D. the box may sit inside a ring / round button / chevron cell (the outer circle may be larger than the text): ICON-C applies to the INNER box; the box must be concentric
      with its circle (centre offset <= tolerance).
   Enforced (FAIL): rows of set T: contact rows (.contact-line), category chips (.chip), filter items (.filter-item). Other rows (buttons, chips, filters, lang, field error, ring + title) are
   reported as WARN with the numbers: ICON-B (box = icon + 2-4) and ICON-C jointly force icon <= text ink - gap there, a sitewide glyph change that needs the customer's decision.
   Usage: node tools/icon-text-align-gate.cjs [--url ..] [--widths 375,768,1024,1440,1920] [--pages all|a,b] [--tol 1] [--strict] (--strict: WARN rows also FAIL). Exit != 0 on FAIL. */
const L = require('./icon-gate-lib.cjs');
const cfg = L.parse(process.argv.slice(2)); L.guardParallel();
const ENFORCED = ['contact-line', 'chip', 'filter-item'];
const tolOf = (k) => (ENFORCED.includes(k) ? 0.5 : cfg.TOL);   /* set T: 0.5 px to cap top / baseline */
const STRICT = process.argv.includes('--strict');
function inpage({ TOL }) {
  const ctx = document.createElement('canvas').getContext('2d'), out = [];
  const hasText = (n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !n.querySelector('svg') && n.tagName !== 'svg' && n.textContent.trim() && getComputedStyle(n).display !== 'none');
  const role = (b) => b.closest('.contact-line') ? 'contact-line' : b.closest('.btn') ? 'btn' : b.closest('.lang-switch') ? 'lang-switch' : b.closest('.filter-item') ? 'filter-item' : b.closest('.chip') ? 'chip' : b.closest('.field__error') ? 'field-error' : b.closest('.round-btn') ? 'round-btn' : b.closest('.icon-ring') ? 'ring+text' : 'other';
  for (const box of document.querySelectorAll('.icon-box')) {
    const br = box.getBoundingClientRect(); if (br.width < 1 || br.height < 1) continue;
    const circle = box.closest('.icon-ring, .round-btn, .select-wrap__chevron'); let dCircle = null;
    if (circle) { const cr = circle.getBoundingClientRect(); const rowEl = box.classList.contains('icon-box--ink') ? box.closest('.contact-line') : null; const ref = rowEl ? rowEl.getBoundingClientRect() : br; dCircle = +Math.abs((cr.top + cr.height / 2) - (ref.top + ref.height / 2)).toFixed(2); } /* ink box in a contact row: the CIRCLE must be concentric with its ROW (<= tol); the inner box sits on the text ink */
    /* text sibling of the box (or of the circle that holds it) */
    let anchor = circle || box, txt = null;
    for (let d = 0; d < 2 && anchor.parentElement && !txt; d++) {
      txt = [...anchor.parentElement.childNodes].find((n) => n !== anchor && hasText(n));
      if (!txt) anchor = anchor.parentElement;
    }
    if (!txt) { out.push({ role: role(box), name: box.querySelector('use')?.getAttribute('href').split('#')[1], text: '', dCircle, noText: true }); continue; }
    const el = txt.nodeType === 3 ? txt.parentElement : txt, cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const full = (txt.textContent || '').replace(/\s+/g, ' ').trim(), a = ctx.measureText(full), fa = a.fontBoundingBoxAscent;
    /* ink of the text: set T (contact rows, chips, filters) = ink of the FACE (reference glyphs Hdlb / gpqy), so every glyph of the set has the same size whatever the string; other rows = the actual string */
    const face = ['contact-line', 'chip', 'filter-item'].includes(role(box)), asc = face ? ctx.measureText('H').actualBoundingBoxAscent : a.actualBoundingBoxAscent, desc = face ? 0 : Math.max(0, a.actualBoundingBoxDescent);
    const rg = document.createRange(); rg.selectNodeContents(txt); const rects = [...rg.getClientRects()].filter((q) => q.width > 0);
    if (!rects.length) continue;
    const bl0 = Math.min(...rects.map((q) => q.top)), bl1 = Math.max(...rects.map((q) => q.bottom));
    if (bl1 < br.top || bl0 > br.bottom) { out.push({ role: role(box), name: box.querySelector('use')?.getAttribute('href').split('#')[1], text: '', dCircle, noText: true }); continue; } /* text is not in the box's row */
    const first = rects[0], last = rects.reduce((m, q) => (q.top > m.top ? q : m), rects[0]); const multi = Math.abs(last.top - first.top) > 2;
    const inkTop = first.top + fa - asc, inkBot = last.top + fa + desc;
    const sv = box.querySelector('svg'), sq = sv.getBoundingClientRect(), uq = sv.querySelector('use').getBoundingClientRect(), hs = 1.5 / 24 * sq.height / 2;   /* stroke 1.5 in a 24 viewBox */
    const gTop = uq.top - hs, gBot = uq.bottom + hs, gH = gBot - gTop;
    out.push({ role: role(box), name: box.querySelector('use')?.getAttribute('href').split('#')[1], text: (el.textContent || '').trim().slice(0, 24), multi,
      boxH: +br.height.toFixed(2), glyphH: +gH.toFixed(2), inkH: +(inkBot - inkTop).toFixed(2), dTop: +(gTop - inkTop).toFixed(2), dBot: +(gBot - inkBot).toFixed(2), dBoxCentre: +Math.abs((gTop + gBot) / 2 - (br.top + br.bottom) / 2).toFixed(2), fill: +(br.height - gH).toFixed(2), dCircle, tol: TOL });
  }
  return { rows: out };
}
(async () => {
  const res = await L.run(cfg, inpage, {}); const roles = {}; let fails = 0, warns = 0;
  const agg = (r, role, x) => { const k = role; const a = (roles[k] = roles[k] || { n: 0, dTop: 0, dBot: 0, dC: 0, boxH: new Set(), inkH: new Set(), glyph: new Set(), dCen: 0, fillMin: 1e9, fillMax: -1e9, bad: [], noText: 0 }); a.n++; if (x.noText || x.multi) { a.noText += x.noText ? 1 : 0; a.multi = (a.multi || 0) + (x.multi ? 1 : 0); } else { a.dTop = Math.max(a.dTop, Math.abs(x.dTop)); a.dBot = Math.max(a.dBot, Math.abs(x.dBot)); a.boxH.add(Math.round(x.boxH * 10) / 10); a.inkH.add(Math.round(x.inkH * 10) / 10); a.glyph.add(Math.round(x.glyphH * 10) / 10); a.dCen = Math.max(a.dCen, x.dBoxCentre); a.fillMin = Math.min(a.fillMin, x.fill); a.fillMax = Math.max(a.fillMax, x.fill); } if (x.dCircle != null) a.dC = Math.max(a.dC, x.dCircle); return a; };
  for (const r of res) for (const x of r.rows) { const a = agg(r, x.role, x); if (!x.noText && !x.multi && (Math.abs(x.dTop) > tolOf(x.role) || Math.abs(x.dBot) > tolOf(x.role)) && a.bad.length < 3) a.bad.push(`${r.page}@${r.w} ${x.name} "${x.text}" box ${x.boxH} ink ${x.inkH} dTop ${x.dTop} dBot ${x.dBot}`); }
  console.log('row role | icons | with text | max|dTop| | max|dBot| (visible glyph vs text ink) | box h | glyph h | text ink h | glyph centre off in box | box-glyph fill min..max | circle centre off | status');
  for (const k of Object.keys(roles).sort()) {
    const a = roles[k], enforced = ENFORCED.includes(k) || STRICT, misC = a.dTop > tolOf(k) || a.dBot > tolOf(k), misD = a.dC > tolOf(k) || a.dCen > tolOf(k) || (a.fillMin < 2 - cfg.TOL || a.fillMax > 4 + cfg.TOL); let st = 'PASS';
    if (a.n - a.noText - (a.multi || 0) === 0) st = 'n/a (no text sibling)'; else if (misC || misD) st = enforced ? 'FAIL' : 'WARN (decision pending)';
    if (st === 'FAIL') fails++; if (st.startsWith('WARN')) warns++;
    console.log([k, a.n, (a.n - a.noText - (a.multi || 0)) + (a.multi ? ' (+' + a.multi + ' multi-line: not measured)' : ''), a.dTop.toFixed(2), a.dBot.toFixed(2), [...a.boxH].join('/'), [...a.glyph].join('/'), [...a.inkH].join('/'), a.dCen.toFixed(2), a.fillMin.toFixed(1) + '..' + a.fillMax.toFixed(1), a.dC.toFixed(2), st].join(' | '));
    if (st !== 'PASS' && a.bad.length) for (const b of a.bad) console.log('     e.g. ' + b);
  }
  const cov = `${cfg.PAGES.length} pages x ${cfg.WIDTHS.join('/')} px, ${res.length} loads, ${Object.values(roles).reduce((s, a) => s + a.n, 0)} boxes`;
  console.log(`\nicon-text-align: ${fails ? 'FAIL' : 'PASS'}, ${warns} WARN (${cov})`);
  require('fs').writeFileSync(require('path').join(L.ROOT, 'tools/.last-icon-text-gate.json'), JSON.stringify({ at: new Date().toISOString(), cov, fails, warns, roles: Object.fromEntries(Object.entries(roles).map(([k, a]) => [k, { n: a.n, dTop: a.dTop, dBot: a.dBot, dC: a.dC, boxH: [...a.boxH], inkH: [...a.inkH] }])) }, null, 1));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
