/* Shared in-page measuring code for rule M1 (one basis for all spacing = the VISIBLE height of letters: cap-top ... baseline, no leading).
   Used by tools/measure-standard-gate.cjs. `inkOfInPage` is the independent reference measurement (canvas metrics + Range rect baseline); it does not depend on
   `text-box-trim`, so it gives the same visible numbers before/after trimming. Functions are self-contained (serialised into the page by puppeteer). */
exports.FREEZE_CSS = 'html .t-display .word__inner{transform:none!important;opacity:1!important;transition:none!important}';
exports.pairsInPage = function pairsInPage(arg) {
  const ctx = document.createElement('canvas').getContext('2d');
  const own = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const inkOf = (el) => {
    const cs = getComputedStyle(el);
    if (el.matches('dd') && el.querySelector('.contact-line')) { const r = el.querySelector('.contact-line').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, painted: true }; }
    if (el.matches('.btn, .chip, .round-btn, input, select, textarea, button, img, svg, hr')) { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, painted: true }; }
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText('H'), fa = m.fontBoundingBoxAscent, cap = m.actualBoundingBoxAscent;
    const rs = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);   /* rects of TEXT nodes only (inline-block wrappers such as .word have padding and would shift the line) */
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) rs.push(q); }
    if (!rs.length) return null;
    const first = Math.min(...rs.map((q) => q.top)), last = Math.max(...rs.map((q) => q.top)), r = el.getBoundingClientRect();
    return { top: first + fa - cap, bottom: last + fa, left: r.left, right: r.right, painted: false };
  };
  const LEAF = 'h1,h2,h3,h4,h5,h6,p,dt,dd,label,legend,.btn,figcaption';
  const root = document.querySelector(arg.root); if (!root) return { err: 'no root ' + arg.root };
  const leaves = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el instanceof SVGElement) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.display === 'inline' || cs.visibility === 'hidden') continue;
    if (cs.position === 'absolute' || cs.position === 'fixed') continue;
    if (!(own(el) || el.matches(LEAF)) || !(el.textContent.trim() || el.matches('.btn'))) continue;
    const up = el.parentElement && el.parentElement.closest(LEAF); if (up && root.contains(up) && up !== el) continue;   /* words/spans inside a heading or paragraph belong to it */
    const k = inkOf(el); if (!k) continue; leaves.push({ el, k, r: el.getBoundingClientRect(), cs });
  }
  leaves.sort((a, b) => a.k.top - b.k.top || a.k.left - b.k.left);
  const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + ' "' + (e.textContent || '').trim().slice(0, 14) + '"';
  const out = [];
  for (let i = 0; i < leaves.length - 1; i++) {
    const a = leaves[i]; let b = null;
    for (let j = i + 1; j < leaves.length; j++) { const c = leaves[j]; if (Math.min(a.k.right, c.k.right) - Math.max(a.k.left, c.k.left) > 4 && c.k.top >= a.k.bottom - 1) { b = c; break; } }
    if (!b) continue;
    out.push({ cx: (Math.max(a.k.left, b.k.left) + Math.min(a.k.right, b.k.right)) / 2, cy: (a.k.bottom + b.k.top) / 2, aTag: a.el.tagName, bTag: b.el.tagName, a: name(a.el), b: name(b.el), box: +(b.r.top - a.r.bottom).toFixed(1), ink: +(b.k.top - a.k.bottom).toFixed(1), trimA: a.cs.textBoxTrim, trimB: b.cs.textBoxTrim });
  }
  return { pairs: out };
};
