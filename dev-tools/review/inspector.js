// DEV-ONLY inspectors (loaded from overlay.js, never part of the build):
//   S = paddings (green) and flex/grid gaps (orange), T = typography labels, K = colour labels.
// Everything is drawn in the overlay's Shadow DOM; the site's DOM/styles are only read.

const MODES = [
  { id: 's', code: 'KeyS', label: 'Стиль', key: 'review.insp.s', title: 'Відступи (зелений) і gap (помаранчевий)' },
  { id: 't', code: 'KeyT', label: 'Текст', key: 'review.insp.t', title: 'Типографіка: розмір/інтерліньяж, вага, трекінг, клас, шрифт' },
  { id: 'k', code: 'KeyK', label: 'Колір', key: 'review.insp.k', title: 'Кольори тексту, фону й рамки з назвою токена' },
];
const MAX_LABELS = 300;      // labels per mode per frame
const MAX_BANDS = 2500;      // filled bands per frame
const MIN_BAND = 3;          // px, thinnest band shown
const MIN_LABEL = 18;        // px, longest side of a band that gets a label
const GROUP_LIMIT = 30;      // longer lists of identical objects are cut to GROUP_SHOWN
const GROUP_SHOWN = 6;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'HEAD', 'TITLE', 'BR', 'WBR']);
const TYPE_CLASSES = new Set(['t-display', 't-display-sm', 't-h1', 't-h2', 't-h3', 't-lead', 't-body', 't-small', 't-label']);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (Math.round(v * 10) / 10).toString();
const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function initInspector({ shadow, root, beforeLayers, bar, beforeButton, store, blocked }) {
  const st = { s: false, t: false, k: false };
  const stats = { lastMs: 0, avgMs: 0, runs: 0, labels: { s: 0, t: 0, k: 0 }, extra: { s: 0, t: 0, k: 0 } };

  // ---------- DOM ----------
  const layers = {};
  const wrap = document.createElement('div');
  wrap.className = 'insp';
  for (const m of MODES) {
    const d = document.createElement('div');
    d.className = `insp-layer insp-${m.id}`;
    d.hidden = true;
    layers[m.id] = d;
    wrap.append(d);
  }
  const more = document.createElement('div');
  more.className = 'insp-more';
  more.hidden = true;
  wrap.append(more);
  root.insertBefore(wrap, beforeLayers);

  const buttons = {};
  for (const m of MODES) {
    const b = document.createElement('button');
    b.className = 'btn alt';
    b.dataset.act = `insp-${m.id}`;
    b.title = m.title;
    b.innerHTML = `${m.label} <kbd>${m.code.slice(3)}</kbd>`;
    bar.insertBefore(b, beforeButton);
    b.addEventListener('click', () => setMode(m.id, !st[m.id]));
    buttons[m.id] = b;
  }
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.textContent = 'C коментар · G сітка · S стиль · T текст · K колір';
  root.append(legend);

  // ---------- colours ----------
  const colorCache = new Map();
  let ctx2d = null;
  function parseColor(str) {
    let c = colorCache.get(str);
    if (c !== undefined) return c;
    let m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      const a = p.length > 3 ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
      c = [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]), a];
    } else if ((m = str.match(/^color\(srgb ([^)]+)\)$/))) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      const a = p.length > 3 ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
      c = [parseFloat(p[0]) * 255, parseFloat(p[1]) * 255, parseFloat(p[2]) * 255, a];
    } else {
      try {
        if (!ctx2d) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; ctx2d = cv.getContext('2d', { willReadFrequently: true }); }
        ctx2d.clearRect(0, 0, 1, 1);
        ctx2d.fillStyle = '#000'; ctx2d.fillStyle = str; ctx2d.fillRect(0, 0, 1, 1);
        const d = ctx2d.getImageData(0, 0, 1, 1).data;
        c = [d[0], d[1], d[2], d[3] / 255];
      } catch { c = [0, 0, 0, 0]; }
    }
    if (c.some((v) => !Number.isFinite(v))) c = [0, 0, 0, 0];
    colorCache.set(str, c);
    return c;
  }
  const hex = (c) => '#' + [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(c[i]))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const fmtColor = (c) => (c[3] >= 0.995 ? hex(c) : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(c[3] * 100) / 100})`);
  const colorKey = (c) => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(c[3] * 100)}`;

  // token map: every custom property declared on :root/html that resolves to a colour
  let tokenMap = null;
  function buildTokens() {
    const names = new Set();
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.style && rule.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) {
          for (let i = 0; i < rule.style.length; i++) { const n = rule.style[i]; if (n.startsWith('--')) names.add(n); }
        }
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* cross-origin */ } }
    const outer = document.createElement('div');
    outer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;color:rgb(1, 2, 3)';
    const probe = document.createElement('span');
    outer.append(probe);
    root.append(outer);
    const cs = getComputedStyle(document.documentElement);
    const map = new Map();
    for (const name of names) {
      const raw = cs.getPropertyValue(name).trim();
      if (!raw || /^-?[\d.]+(px|em|rem|%|ms|s)?$/.test(raw)) continue;
      probe.style.color = `var(${name})`;
      const val = getComputedStyle(probe).color;
      if (val === 'rgb(1, 2, 3)' && !/rgb\(\s*1\s*,\s*2\s*,\s*3\s*\)|#010203/i.test(raw)) continue; // not a colour
      const k = colorKey(parseColor(val));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(name);
    }
    outer.remove();
    tokenMap = map;
  }
  const PREFIX = { text: '--text', bg: '--surface', border: '--border' };
  function tokenFor(c, kind) {
    if (!tokenMap) return '';
    const list = tokenMap.get(colorKey(c));
    if (!list) return '';
    const pref = PREFIX[kind];
    const score = (n) => {
      if (n.startsWith(pref)) return 0;
      if (/^--(text|surface|accent|border)/.test(n)) return 1;
      if (!n.startsWith('--c-')) return 2;
      return 3;
    };
    let best = list[0], bs = score(best);
    for (const n of list) { const s = score(n); if (s < bs || (s === bs && n.length < best.length)) { best = n; bs = s; } }
    return best;
  }

  // ---------- collection ----------
  const hasOwnText = (el) => { for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.data)) return true; return false; };
  const visible = (el) => { try { return el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true; } catch { return true; } };

  function collect(vw, vh) {
    const out = [];
    const push = (el) => {
      if (SKIP.has(el.tagName)) return;
      if (el instanceof SVGElement && el.localName !== 'svg') return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      out.push({ el, r, cs });
    };
    push(document.documentElement);
    for (const el of document.body.querySelectorAll('*')) push(el);
    if (document.body) push(document.body);
    return out;
  }

  const clip = (x, y, w, h, vw, vh) => {
    const x0 = Math.max(x, 0), y0 = Math.max(y, 0), x1 = Math.min(x + w, vw), y1 = Math.min(y + h, vh);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
  };
  const box = (cls, b) => `<i class="${cls}" style="left:${b[0]}px;top:${b[1]}px;width:${b[2]}px;height:${b[3]}px"></i>`;
  const label = (cls, x, y, inner, extra = '') => `<b class="lb ${cls}" style="left:${Math.round(x)}px;top:${Math.round(y)}px;${extra}">${inner}</b>`;

  // M1 (one measuring basis = the VISIBLE height of letters: cap-top ... baseline, no line-height leading).
  // A text block that is already trimmed (text-box: trim-both cap alphabetic, base.css) has box = ink -> its border box is used.
  // Any other text block (not trimmed, or text wrapped in inline words/spans) is measured here from the font: cap top = baseline - cap height
  // of 'H' (canvas actualBoundingBoxAscent), baseline = text-node rect top + fontBoundingBoxAscent; so the number shown = the visible distance.
  let inkCtx = null;
  const inlineOnlyText = (el, depth = 0) => {
    if (depth > 4 || !/\S/.test(el.textContent)) return false;
    for (const ch of el.children) {
      if (SKIP.has(ch.tagName)) continue;
      const d = getComputedStyle(ch).display;
      if (d !== 'inline' && d !== 'inline-block' && d !== 'contents') return false;
      if (ch instanceof SVGElement || ['IMG', 'VIDEO', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(ch.tagName)) return false;
      if (!inlineOnlyText(ch, depth + 1) && /\S/.test(ch.textContent)) return false;
    }
    return true;
  };
  function textInk(el, cs, r) {
    if (cs.textBoxTrim === 'trim-both' && /cap/.test(cs.textBoxEdge) && /alphabetic/.test(cs.textBoxEdge)) return r;
    if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d');
    inkCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = inkCtx.measureText('H'), fa = m.fontBoundingBoxAscent, cap = m.actualBoundingBoxAscent;
    if (!(fa > 0) || !(cap > 0)) return r;
    let first = Infinity, last = -Infinity;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!/\S/.test(n.data)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) { first = Math.min(first, q.top); last = Math.max(last, q.top); }
    }
    if (!Number.isFinite(first)) return r;
    const top = first + fa - cap, bottom = last + fa;
    return { left: r.left, right: r.right, width: r.width, top, bottom, height: bottom - top };
  }

  // visible ("ink") rect of a block: painted boxes use their border box; transparent wrappers use the union of their
  // painted descendants (so a link with transparent hit padding measures from its visible ring/text, not its hit zone)
  const REPLACED = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME', 'HR', 'PICTURE', 'OBJECT']);
  function inkRect(el, depth) {
    if (SKIP.has(el.tagName) || (el instanceof SVGElement && el.localName !== 'svg')) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.display === 'contents' || cs.visibility === 'hidden') return null;
    if (cs.position === 'absolute' || cs.position === 'fixed') return null;
    if (depth === 0 && cs.display === 'inline') return null;
    const r = el.getBoundingClientRect();
    const bgOn = cs.backgroundColor !== 'transparent' && !/^rgba\((\d+, ){3}0\)$/.test(cs.backgroundColor);
    const painted = REPLACED.has(el.tagName.toUpperCase()) || bgOn
      || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none'
      || ['Top', 'Right', 'Bottom', 'Left'].some((sd) => px(cs[`border${sd}Width`]) > 0 && cs[`border${sd}Style`] !== 'none');
    if (!painted && r.width > 0 && r.height > 0 && cs.display !== 'inline' && (hasOwnText(el) || inlineOnlyText(el))) return textInk(el, cs, r);
    if (painted || hasOwnText(el)) return (r.width > 0 && (r.height > 0 || el.tagName === 'HR' || painted)) ? r : null;
    if (depth > 8) return null;
    let u = null;
    for (const ch of el.children) {
      const q = inkRect(ch, depth + 1);
      if (!q) continue;
      u = u ? { left: Math.min(u.left, q.left), top: Math.min(u.top, q.top), right: Math.max(u.right, q.right), bottom: Math.max(u.bottom, q.bottom) } : { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
    }
    if (u) { u.width = u.right - u.left; u.height = u.bottom - u.top; }
    return u;
  }

  // ---------- S: padding + gap ----------
  function drawS(items, vw, vh) {
    let html = '', bands = 0;
    const labels = [];
    for (const { el, r, cs } of items) {
      const pt = px(cs.paddingTop), pr = px(cs.paddingRight), pb = px(cs.paddingBottom), pl = px(cs.paddingLeft);
      if ((pt || pr || pb || pl) && cs.display !== 'inline' && visible(el)) {
        const bt = px(cs.borderTopWidth), br = px(cs.borderRightWidth), bb = px(cs.borderBottomWidth), bl = px(cs.borderLeftWidth);
        const x = r.left + bl, y = r.top + bt, w = r.width - bl - br, h = r.height - bt - bb;
        const raw = [[x, y, w, pt], [x, y + h - pb, w, pb], [x, y + pt, pl, h - pt - pb], [x + w - pr, y + pt, pr, h - pt - pb]];
        let bestB = null, bestL = 0;
        for (const b of raw) {
          if (b[2] <= 0 || b[3] <= 0) continue;
          const c = clip(b[0], b[1], b[2], b[3], vw, vh);
          if (!c || Math.min(c[2], c[3]) < MIN_BAND) continue;
          if (bands++ < MAX_BANDS) html += box('bp', c);
          const long = Math.max(c[2], c[3]);
          if (long > bestL) { bestL = long; bestB = c; }
        }
        if (bestB && bestL >= MIN_LABEL) {
          const txt = pt === pr && pr === pb && pb === pl ? num(pt) : [pt, pr, pb, pl].map(num).join(' ');
          labels.push({ pri: bestB[2] * bestB[3], cls: 'lp', cx: bestB[0] + bestB[2] / 2, cy: bestB[1] + bestB[3] / 2, txt });
        }
      }
      // gaps between adjacent sibling blocks (visible ink, any layout: flex/grid gap, margins, dividers)
      if (el.children.length > 1 && el.children.length <= 80 && visible(el)) {
        const kids = [];
        for (const ch of el.children) {
          if (SKIP.has(ch.tagName)) continue;
          const q = inkRect(ch, 0);
          if (q) kids.push(q);
        }
        const seen = new Set();
        for (let i = 0; i < kids.length; i++) {
          for (let j = 0; j < kids.length; j++) {
            if (i === j) continue;
            const a = kids[i], b = kids[j];
            let band = null, val = 0;
            const y0 = Math.max(a.top, b.top), y1 = Math.min(a.bottom, b.bottom);
            const x0 = Math.max(a.left, b.left), x1 = Math.min(a.right, b.right);
            const dx = b.left - a.right, dy = b.top - a.bottom;
            if (dy >= 0.5 && x1 - x0 >= 1 && (dx < 0.5 || y1 - y0 < 0)) { band = [x0, a.bottom, x1 - x0, dy]; val = dy; }
            else if (dx >= 0.5 && (y1 - y0 >= 1 || (y1 - y0 >= 0 && (a.height === 0 || b.height === 0)))) { band = [a.right, y0, dx, Math.max(y1 - y0, 1)]; val = dx; }
            if (!band) continue;
            // another sibling inside the band = not adjacent
            let blocked = false;
            for (let k = 0; k < kids.length && !blocked; k++) {
              if (k === i || k === j) continue;
              const c = kids[k];
              if (c.right > band[0] + 0.5 && c.left < band[0] + band[2] - 0.5 && c.bottom > band[1] + 0.5 && c.top < band[1] + band[3] - 0.5) blocked = true;
            }
            if (blocked) continue;
            const key = band.map(Math.round).join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            const c = clip(band[0], band[1], band[2], band[3], vw, vh);
            if (!c) continue;
            if (bands++ < MAX_BANDS) html += box('bg', c);
            labels.push({ pri: 1e9 + c[2] * c[3], cls: 'lg', cx: c[0] + c[2] / 2, cy: c[1] + c[3] / 2, txt: num(val) });
          }
        }
      }
    }
    labels.sort((a, b) => b.pri - a.pri);
    const shown = [];
    const placed = [];
    for (const l of labels) {
      if (shown.length >= MAX_LABELS) break;
      const w = String(l.txt).length * 7 + 12, h = 16;
      const bx = [l.cx - w / 2, l.cy - h / 2, l.cx + w / 2, l.cy + h / 2];
      if (placed.some((p) => bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1])) continue;
      placed.push(bx); shown.push(l);
    }
    for (const l of shown) html += label(l.cls, l.cx, l.cy, l.txt, 'transform:translate(-50%,-50%)');
    return { html, shown: shown.length, extra: labels.length - shown.length };
  }

  // ---------- T: typography ----------
  let astaLoaded = false;
  function fontName(cs) {
    const first = cs.fontFamily.split(',')[0].trim().replace(/["']/g, '');
    if (/^Asta/i.test(first)) return astaLoaded ? 'Asta' : 'fallback';
    return first;
  }
  function trackingEm(cs, size) {
    if (cs.letterSpacing === 'normal') return '0em';
    const v = Math.round((px(cs.letterSpacing) / size) * 1000) / 1000;
    return (v < 0 ? '−' + Math.abs(v) : String(v)) + 'em';
  }
  function limitGroups(list, keyOf) {
    const count = new Map();
    for (const it of list) { const k = keyOf(it); count.set(k, (count.get(k) || 0) + 1); }
    const seen = new Map(), out = [];
    for (const it of list) {
      const k = keyOf(it), total = count.get(k), n = seen.get(k) || 0;
      seen.set(k, n + 1);
      if (total > GROUP_LIMIT) {
        if (n >= GROUP_SHOWN) continue;
        if (n === 0) it.times = total;
      }
      out.push(it);
    }
    return out;
  }
  function drawT(items, vw, vh) {
    try { astaLoaded = [...document.fonts].some((f) => /Asta/i.test(f.family) && f.status === 'loaded'); } catch { astaLoaded = false; }
    let list = [];
    for (const it of items) {
      const { el, r, cs } = it;
      if (!hasOwnText(el)) continue;
      const size = px(cs.fontSize);
      if (size <= 0 || !visible(el)) continue;
      const lh = cs.lineHeight === 'normal' ? 'normal' : num(px(cs.lineHeight));
      const cls = [...el.classList].filter((c) => TYPE_CLASSES.has(c)).join(' ');
      const sig = `${num(size)}/${lh} · ${cs.fontWeight} · ${trackingEm(cs, size)}`;
      list.push({ it, size, sig, cls, font: fontName(cs), key: `${el.localName}|${el.className}|${sig}|${el.parentElement ? el.parentElement.className : ''}` });
    }
    list = limitGroups(list, (x) => x.key);
    list.sort((a, b) => b.size - a.size);
    const shown = list.slice(0, MAX_LABELS);
    let html = '';
    for (const x of shown) {
      const r = x.it.r;
      const txt = `${x.sig}${x.cls ? ' · ' + x.cls : ''} · ${x.font}${x.times ? ` · ×${x.times}` : ''}`;
      const y = r.top - 15 >= 0 ? r.top - 15 : r.top + 1;
      html += `<i class="tb" style="left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px"></i>`;
      html += label('lt', Math.min(Math.max(r.left, 0), vw - 60), y, esc(txt));
    }
    return { html, shown: shown.length, extra: list.length - shown.length };
  }

  // ---------- K: colours ----------
  function drawK(items, vw, vh) {
    if (!tokenMap) buildTokens();
    let list = [];
    for (const it of items) {
      const { el, r, cs } = it;
      const lines = [];
      if (hasOwnText(el) && px(cs.fontSize) > 0 && visible(el)) {
        const c = parseColor(cs.color);
        if (c[3] > 0.05) lines.push(['text', c]);
      }
      const bg = parseColor(cs.backgroundColor);
      if (bg[3] > 0.05 && visible(el)) lines.push(['bg', bg]);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (px(cs[`border${side}Width`]) >= 1 && cs[`border${side}Style`] !== 'none') {
          const c = parseColor(cs[`border${side}Color`]);
          if (c[3] > 0.05) { lines.push(['border', c]); break; }
        }
      }
      if (!lines.length) continue;
      list.push({ it, lines, area: r.width * r.height, key: `${el.localName}|${el.className}|${lines.map((l) => l[0] + colorKey(l[1])).join('|')}|${el.parentElement ? el.parentElement.className : ''}` });
    }
    list = limitGroups(list, (x) => x.key);
    list.sort((a, b) => b.area - a.area);
    const shown = list.slice(0, MAX_LABELS);
    let html = '';
    for (const x of shown) {
      const r = x.it.r;
      const inner = x.lines.map(([kind, c]) => {
        const tok = tokenFor(c, kind);
        return `<span class="kl"><i class="sw" style="background:${fmtColor(c)}"></i>${kind} ${esc(fmtColor(c))}${tok ? ' · ' + esc(tok) : ''}</span>`;
      }).join('') + (x.times ? `<span class="kl">×${x.times}</span>` : '');
      let y = r.bottom + 1;
      if (y > vh - 16 * x.lines.length - 4) y = Math.max(r.top, 0) + 1;
      html += label('lk', Math.min(Math.max(r.left, 2), vw - 120), y, inner);
    }
    return { html, shown: shown.length, extra: list.length - shown.length };
  }

  // ---------- update loop ----------
  const drawers = { s: drawS, t: drawT, k: drawK };
  const lastHtml = { s: '', t: '', k: '' };
  let pending = false, lastRun = 0, timer = 0, mutTimer = 0;
  function update() {
    pending = false;
    if (!st.s && !st.t && !st.k) return;
    const t0 = performance.now();
    const vw = document.documentElement.clientWidth, vh = innerHeight;
    const items = collect(vw, vh);
    const notes = [];
    for (const m of MODES) {
      if (!st[m.id]) continue;
      const res = drawers[m.id](items, vw, vh);
      stats.labels[m.id] = res.shown; stats.extra[m.id] = res.extra;
      if (res.extra > 0) notes.push(`${m.id.toUpperCase()} +${res.extra}`);
      if (res.html !== lastHtml[m.id]) { layers[m.id].innerHTML = res.html; lastHtml[m.id] = res.html; }
    }
    more.hidden = !notes.length;
    more.textContent = notes.join(' · ');
    const dt = performance.now() - t0;
    stats.lastMs = dt; stats.runs++; stats.avgMs += (dt - stats.avgMs) / stats.runs;
    lastRun = performance.now();
  }
  // rAF throttle, at most ~30 fps
  function request() {
    if (pending || (!st.s && !st.t && !st.k)) return;
    pending = true;
    const wait = Math.max(0, 33 - (performance.now() - lastRun));
    clearTimeout(timer);
    timer = setTimeout(() => requestAnimationFrame(update), wait);
  }
  function requestDebounced() { clearTimeout(mutTimer); mutTimer = setTimeout(request, 150); }

  addEventListener('scroll', request, { passive: true, capture: true });
  addEventListener('resize', request);
  addEventListener('load', request);
  addEventListener('transitionend', requestDebounced, true);
  try { document.fonts.ready.then(() => { colorCache.clear(); request(); }); } catch { /* ignore */ }
  const mo = new MutationObserver(requestDebounced);
  const startObserve = () => document.body && mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  if (document.body) startObserve(); else addEventListener('DOMContentLoaded', startObserve, { once: true });

  // ---------- modes + keys ----------
  function setMode(id, on) {
    st[id] = !!on;
    store.set(MODES.find((m) => m.id === id).key, on ? '1' : '0');
    layers[id].hidden = !on;
    buttons[id].classList.toggle('on', !!on);
    if (!on) { layers[id].innerHTML = ''; lastHtml[id] = ''; stats.labels[id] = 0; stats.extra[id] = 0; }
    if (on && id === 'k') tokenMap = null; // rebuild: stylesheets may have changed (HMR)
    if (!st.s && !st.t && !st.k) { more.hidden = true; clearTimeout(timer); pending = false; }
    else request();
  }
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const m = MODES.find((x) => x.code === e.code);
    if (!m) return;
    const t = e.composedPath()[0];
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (blocked()) return;
    e.preventDefault();
    setMode(m.id, !st[m.id]);
  }, true);

  for (const m of MODES) if (store.get(m.key, '0') === '1') setMode(m.id, true);
  return { state: st, stats, update, setMode, request };
}
