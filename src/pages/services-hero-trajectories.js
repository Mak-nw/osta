// Services hero (light surface): TRAJECTORIES of supply — ~45 thin lines (18 long near-straight rays, 7 rays leaning left, 15 parabolic arcs, 5 long shallow curves) fan out from ONE source
// (lower left of the drawing); markers sit on the lines with small ISO country codes next to some of them, and small dots travel along the lines from the source to their ends.
// Same subject, generator (seed 2026, same draw order), line counts / distribution, marker and travelling-dot logic as before the restyle; only the STYLE follows the new illustration
// language (restyle-spec A3): native 1 device px solid lines, flat dots in place of the x / + markers and for the travelling dots (and a dot at the source), ink = token --accent
// (main lines alpha 1, ~30 % secondary lines 0.6), transparent canvas, no frame / mask / cursor reaction / camera sway. The drawing is FITTED WHOLE into the zone (it used to run off the
// edges of a wide strip) with a >= 7 % margin and its ink centre on the centre of the zone. Shell (tokens, fit, IO / visibility pause, reduced-motion static frame, capDpr, destroy)
// = utils/il-hero.js. Motion: dots travel with a pause, an integer number of trips per PERIOD (frame 0 == frame T); reduced motion = static lines + markers, no dots.
import { initHeroScene, TAU } from '../utils/il-hero.js';
import { whenPageLoaded } from '../utils/hero-poster.js';

const PERIOD = 60, MAX_LABELS = 14, MAX_DOTS = 30, MIN_DOTS = 16, PAD = 0.07;
// ISO codes only; no CIS countries and no UA
const CODES = ['DE', 'NL', 'BE', 'FR', 'IT', 'ES', 'PL', 'CH', 'AT', 'GB', 'SE', 'TR', 'IN', 'CN', 'JP', 'KR', 'US', 'BR', 'AE', 'CA', 'MX', 'IE', 'NO', 'FI', 'PT', 'GR', 'AR', 'CL', 'CO'];
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const bez = (p0, p1, p2, n) => Array.from({ length: n + 1 }, (_, k) => { const t = k / n, a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t * t; return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1], a * p0[2] + b * p1[2] + c * p2[2]]; });
const FAR = 1000;   // a hidden dot is parked behind the camera clip

export function initHeroTrajectories(host) {
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  let layer = null, onResize = null, ro = null, shown = false;   // shown: the poster has been handed over; the ISO labels (not part of the poster) fade in then
  const api = initHeroScene({
    host, period: PERIOD, staticPhase: 0, pad: PAD,
    build: (kit) => {
      const { Group } = kit;
      const R = rng(2026), rr = (a, b) => a + (b - a) * R();
      /* ---------- trajectories (local coords, source at origin): same generator and draw order as the original ---------- */
      const lines = [], leftLines = [];
      const addLine = (pts, opacity) => { const l = { pts, n: pts.length, faint: opacity < 1 }; lines.push(l); return l; };
      const op = () => { const faint = R() < 0.3, v = rr(0.5, 0.7); return faint ? v : 1; };
      const ray = (a, L, bend, zE, n) => {
        const end = [Math.cos(a) * L, Math.sin(a) * L, zE];
        const mid = [end[0] * 0.5 - Math.sin(a) * bend, end[1] * 0.5 + Math.cos(a) * bend, end[2] * 0.5];
        return bez([0, 0, 0], mid, end, n);
      };
      for (let i = 0; i < 18; i++) {   // long near-straight rays fanning up/right
        const a = (4 + (i / 17) * 76 + rr(-1.2, 1.2)) * Math.PI / 180;
        const L = rr(22, 30), bend = rr(-1.6, 1.6), zE = rr(-3, 2), d1 = rr(0, 1.4), d2 = rr(1.8, 3);
        addLine(ray(a, L, bend, zE, 180), op());
      }
      for (let i = 0; i < 7; i++) {    // rays leaning left
        const a = (95 + i * 3.3 + rr(-1, 1)) * Math.PI / 180, L = rr(12, 18), bend = rr(-0.8, 0.8), zE = rr(-2, 2), d1 = rr(0, 1.2), d2 = rr(1.8, 2.8);
        leftLines.push(addLine(ray(a, L, bend, zE, 140), op()));
      }
      for (let i = 0; i < 15; i++) {   // high parabolic arcs
        const Rg = i < 5 ? rr(3, 7) : rr(6, 17), A = rr(2.2, 9), zE = rr(-3, 2), pts = [], N = 160;
        for (let k = 0; k <= N; k++) {
          const u = (k / N) * 1.12, x = u * Rg, y = 4 * A * u * (1 - u);
          if (y < -0.6) break;
          pts.push([x, y, zE * (k / N)]);
        }
        const o = op(); rr(0.1, 1.6); rr(2, 3.4);
        addLine(pts, o);
      }
      for (let i = 0; i < 5; i++) {    // long shallow curves toward the lower right
        const a = rr(0.5, 10) * Math.PI / 180, L = rr(24, 32), bend = rr(-1.2, 0.8);
        const end = [Math.cos(a) * L, Math.sin(a) * L - rr(0, 0.5), rr(-2, 2)];
        const mid = [end[0] * 0.5, end[1] * 0.5 + bend, end[2] * 0.5];
        const o = op(); rr(0.2, 1.6); rr(2.2, 3.6);
        addLine(bez([0, 0, 0], mid, end, 160), o);
      }

      /* ---------- marker candidates (original draw order; the final choice is made in px after the fit) ---------- */
      const candidates = [];
      for (let i = 0; i < 4; i++) { rr(9, 14); candidates.push({ line: leftLines[(i * 2) % 7], t: 0.1 + i * 0.13, left: true }); }
      for (let i = 0; i < 90; i++) {
        const line = lines[Math.floor(R() * lines.length)];
        const t = Math.min(0.92, 0.04 + R() ** 1.7 * 0.9);   // biased toward the source
        R(); rr(8, 16);
        candidates.push({ line, t, left: false });
      }
      for (const c of candidates) c.p = c.line.pts[Math.min(c.line.n - 1, Math.round(c.t * (c.line.n - 1)))];

      /* ---------- travelling dots (original selection logic) ---------- */
      for (const l of lines) {   // cumulative arc length per line
        const cum = new Float32Array(l.n);
        for (let k = 1; k < l.n; k++) cum[k] = cum[k - 1] + Math.hypot(l.pts[k][0] - l.pts[k - 1][0], l.pts[k][1] - l.pts[k - 1][1], l.pts[k][2] - l.pts[k - 1][2]);
        l.cum = cum; l.len = cum[l.n - 1];
      }
      const dots = [];
      const addDot = (l, second) => {
        const sp = Math.min(0.5, Math.max(0.2, rr(0.25, 0.5) * rr(0.85, 1.15)));
        const travel = 1 / sp, pause = rr(0.6, 2.2), cyc = travel + pause, n = Math.max(1, Math.round(PERIOD / cyc));
        dots.push({ l, n, share: travel / cyc, off: second ? 0.5 : (dots.length * 0.618) % 1 });   // n trips per PERIOD, travelling for `share` of each trip
      };
      const medLen = lines.map((l) => l.len).sort((a, b) => a - b)[Math.floor(lines.length / 2)];
      for (const l of lines) if (dots.length < MAX_DOTS && R() < 0.6) addDot(l, false);
      for (const l of [...dots.map((d) => d.l)]) if (dots.length < MAX_DOTS && l.len > medLen && R() < 0.4) addDot(l, true);
      for (const l of lines) { if (dots.length >= MIN_DOTS) break; if (!dots.some((d) => d.l === l)) addDot(l, false); }

      /* ---------- centre the drawing: the ink centre (coverage of the lines on a fine grid) goes to the origin, then fit the half extents about it ---------- */
      const CELL = 0.2, cov = new Set(); let sx = 0, sy = 0;
      for (const l of lines) for (let k = 0; k < l.n - 1; k++) for (let q = 0; q < 4; q++) {
        const x = l.pts[k][0] + (l.pts[k + 1][0] - l.pts[k][0]) * q / 4, y = l.pts[k][1] + (l.pts[k + 1][1] - l.pts[k][1]) * q / 4, ix = Math.floor(x / CELL), iy = Math.floor(y / CELL), key = ix * 100000 + iy;
        if (!cov.has(key)) { cov.add(key); sx += x; sy += y; }
      }
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const l of lines) for (const p of l.pts) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); }
      const covx = sx / cov.size, covy = sy / cov.size, bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2;
      // the ink centre may sit at most 2.5 % of the drawing's width / height off the origin (= the zone centre); inside that the origin moves toward the bbox centre = bigger drawing
      let cx = covx, cy = covy, hx = 0, hy = 0;
      for (let it = 0; it < 6; it++) {
        hx = Math.max(bx1 - cx, cx - bx0); hy = Math.max(by1 - cy, cy - by0);
        cx = covx + Math.max(-0.05 * hx, Math.min(0.05 * hx, bcx - covx)); cy = covy + Math.max(-0.05 * hy, Math.min(0.05 * hy, bcy - covy));
      }
      hx = Math.max(bx1 - cx, cx - bx0); hy = Math.max(by1 - cy, cy - by0);
      const root = new Group(), world = new Group();
      root.add(world); world.position.set(-cx, -cy, 0);

      /* ---------- scene objects ---------- */
      const seg = (sel) => lines.filter(sel).flatMap((l) => kit.segsOf(l.pts));
      world.add(kit.lines(seg((l) => !l.faint), { a0: 1, a1: 1 }));
      world.add(kit.lines(seg((l) => l.faint), { a0: 0.6, a1: 0.6 }));
      world.add(kit.dots([[0, 0, 0]], 7, { a0: 1, a1: 1 }));                       // the source
      const markers = kit.dots(candidates.map((c) => c.p), 4, { a0: 1, a1: 1 });    // the drawn count is set by layout()
      markers.geometry.setDrawRange(0, 0);
      world.add(markers);
      const tdots = kit.dots(dots.map(() => [0, 0, FAR]), 4, { a0: 1, a1: 1 });
      world.add(tdots);
      const arr = tdots.geometry.attributes.position.array;

      return {
        root, R: Math.hypot(hx, hy), half: [hx, hy], candidates, markers, world, MAX: candidates.length,
        update(phase) {
          const reduced = reducedMq.matches;
          dots.forEach((d, i) => {
            const u = (((d.n * phase / TAU + d.off) % 1) + 1) % 1, l = d.l;
            if (reduced || u > d.share) { arr[i * 3 + 2] = FAR; return; }
            const target = (u / d.share) * l.len, cum = l.cum;
            let lo = 0, hi = l.n - 1;
            while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= target) lo = m; else hi = m; }
            const sg = cum[hi] - cum[lo], f = sg > 0 ? (target - cum[lo]) / sg : 0, p0 = l.pts[lo], p1 = l.pts[hi];
            for (let c = 0; c < 3; c++) arr[i * 3 + c] = p0[c] + (p1[c] - p0[c]) * f;
          });
          tdots.geometry.attributes.position.needsUpdate = true;
        },
      };
    },
  });
  if (!api) return null;

  /* ---------- markers + ISO labels: chosen in px after the fit (spacing as in the original: 40 px markers, 96 px labelled), all strictly inside the zone ---------- */
  const info = api.info;
  layer = document.createElement('div');
  layer.className = 'hero-scene__labels';
  layer.setAttribute('aria-hidden', 'true');
  host.append(layer);
  const layout = () => {
    const [W, H] = api.size;
    if (!W || !H) return;
    const mn = Math.min(W, H), m = PAD * mn, taken = [], boxes = [], order = [];
    layer.textContent = '';
    let labeled = 0;
    for (const c of info.candidates) {
      const pt = api.project(new api.kit.Vector3(...c.p).add(info.world.position));
      if (pt.x < m || pt.x > W - m || pt.y < m || pt.y > H - m) continue;
      if (taken.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < (c.left ? 28 : labeled < MAX_LABELS ? Math.max(48, 0.13 * mn) : Math.max(16, 0.055 * mn)))) continue;
      const bx = [pt.x + 8, pt.y - 9, pt.x + 8 + 22, pt.y + 9];
      if (labeled < MAX_LABELS && bx[2] <= W - m && !boxes.some((q) => bx[0] < q[2] + 6 && q[0] < bx[2] + 6 && bx[1] < q[3] + 6 && q[1] < bx[3] + 6)) {
        boxes.push(bx);
        const el = document.createElement('span');
        el.className = shown ? 'hero-scene__label is-on' : 'hero-scene__label';
        el.textContent = CODES[labeled];
        el.style.transform = `translate(${bx[0].toFixed(1)}px, ${(pt.y - 10).toFixed(1)}px)`;
        layer.append(el);
        labeled++;
      }
      taken.push(pt); order.push(c);
    }
    // marker dots: the chosen ones first in the buffer, then drawRange
    const posAttr = info.markers.geometry.attributes.position, a = posAttr.array;
    order.forEach((c, i) => { a[i * 3] = c.p[0]; a[i * 3 + 1] = c.p[1]; a[i * 3 + 2] = c.p[2]; });
    info.markers.geometry.setDrawRange(0, order.length);
    posAttr.needsUpdate = true;
    api.kit.invalidate();
  };
  layout();
  whenPageLoaded().then(() => requestAnimationFrame(() => { shown = true; layer.querySelectorAll('.hero-scene__label').forEach((el) => el.classList.add('is-on')); }));
  onResize = () => layout();
  ro = new ResizeObserver(onResize); ro.observe(host);
  const destroy0 = api.destroy;
  api.destroy = () => { ro.disconnect(); layer.remove(); destroy0(); };
  return api;
}
