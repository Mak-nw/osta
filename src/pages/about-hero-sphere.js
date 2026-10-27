// About hero: three.js "contour sphere" (ported from scenes/contour-sphere.html).
// A sphere (R=3) with topographic iso-lines (marching squares over a scalar field of 44 sources + 16 waves, 46 levels, every 3rd dashed), slowly spinning,
// with a screen-fixed SVG HUD (limb rings, crosshair, ticks) drawn in container coordinates. Transparent canvas (the hero surface shows through);
// the back hemisphere is hidden by a depth-only mask sphere (colorWrite: false). Lines and HUD = token --accent (read from computed style); HUD strokes <= 1px.
// The field / contour build is chunked (time budget per slice) so no long task blocks the main thread. The levels appear one after another once, when the
// hero first enters the viewport; then slow spin + a slight camera sway (pointer parallax only while the cursor is over the container). Renders only while
// on screen and the tab is visible; prefers-reduced-motion = one static final frame. No WebGL -> returns null (the caller keeps the fallback photo).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Color, MathUtils, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments,
  Mesh, SphereGeometry, MeshBasicMaterial,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const FOV = 45, SR = 3.0, MAX_DPR = 2, RING_FRAC = 0.42;   // RING_FRAC = limb radius / container height
const GW = 360, GH = 180, NL = 46, NSRC = 44, NWAVE = 16, SLICE_MS = 8;
// camera distance so that the limb circle has radius RING_FRAC * H: rp/H = 0.5 / tan(fov/2) * SR / sqrt(D^2 - SR^2)
const CAM_D = Math.sqrt(SR * SR + ((0.5 / Math.tan(MathUtils.degToRad(FOV / 2))) * SR / RING_FRAC) ** 2);

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ease = (t) => 1 - (1 - t) ** 3;
const SVGNS = 'http://www.w3.org/2000/svg';

export function initAboutHeroSphere(host) {
  if (!host) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const accent = new Color(getComputedStyle(host).getPropertyValue('--accent').trim());   // sRGB css string -> three colour management (no manual linear maths, no tone mapping)

  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.remove(); return null; }
  renderer.setClearColor(0x000000, 0);

  const hud = document.createElementNS(SVGNS, 'svg');
  hud.setAttribute('class', 'hero-sphere__hud');
  hud.setAttribute('aria-hidden', 'true');
  host.append(hud);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 3.2, 0.1, 100);
  const globe = new Group();
  scene.add(globe);
  globe.rotation.x = 0.38;
  const spin = new Group();
  globe.add(spin);
  const geos = [], mats = [];

  // depth-only mask: hides the back hemisphere, writes no colour (the hero surface shows through)
  const maskGeo = new SphereGeometry(SR * 0.997, 64, 48);
  const maskMat = new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  geos.push(maskGeo); mats.push(maskMat);
  globe.add(new Mesh(maskGeo, maskMat));

  /* ---------- scalar field (flat arrays for speed) ---------- */
  const R = rng(7731);
  const rr = (a, b) => a + (b - a) * R();
  const src = new Float32Array(NSRC * 5);     // cx, cy, cz, amp, k
  for (let i = 0; i < NSRC; i++) {
    const z = rr(-1, 1), a = rr(0, Math.PI * 2), s = Math.sqrt(1 - z * z), sig = rr(0.25, 0.45);
    src.set([s * Math.cos(a), z, s * Math.sin(a), (i % 2 ? -1 : 1) * rr(0.7, 1.3), 1 / (sig * sig)], i * 5);
  }
  const wav = new Float32Array(NWAVE * 5);    // wx, wy, wz, phase, amp
  for (let i = 0; i < NWAVE; i++) {
    const z = rr(-1, 1), a = rr(0, Math.PI * 2), s = Math.sqrt(1 - z * z), f = rr(3, 9);
    wav.set([s * Math.cos(a) * f, z * f, s * Math.sin(a) * f, rr(0, 6.28), rr(0.12, 0.3)], i * 5);
  }
  const field = (x, y, z) => {
    let v = 0;
    for (let i = 0; i < NSRC * 5; i += 5) v += src[i + 3] * Math.exp(src[i + 4] * (x * src[i] + y * src[i + 1] + z * src[i + 2] - 1));
    for (let i = 0; i < NWAVE * 5; i += 5) v += wav[i + 4] * Math.sin(wav[i] * x + wav[i + 1] * y + wav[i + 2] * z + wav[i + 3]);
    return v;
  };

  const grid = new Float32Array((GW + 1) * (GH + 1));
  let vmin = Infinity, vmax = -Infinity;
  const levels = [];
  const lonCos = new Float32Array(GW + 1), lonSin = new Float32Array(GW + 1);
  for (let i = 0; i <= GW; i++) { const lon = (i / GW) * Math.PI * 2; lonCos[i] = Math.cos(lon); lonSin[i] = Math.sin(lon); }

  const ll = (fi, fj, r, out) => {
    const lon = (fi / GW) * Math.PI * 2, lat = Math.PI / 2 - (fj / GH) * Math.PI, cl = Math.cos(lat);
    out.push(r * cl * Math.cos(lon), r * Math.sin(lat), r * cl * Math.sin(lon));
  };
  const buildLevel = (L) => {
    const lv = vmin + 0.03 * (vmax - vmin) + (L / (NL - 1)) * 0.94 * (vmax - vmin);
    const dashed = L % 3 === 1, pos = [], W1 = GW + 1;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const v0 = grid[j * W1 + i], v1 = grid[j * W1 + i + 1], v2 = grid[(j + 1) * W1 + i + 1], v3 = grid[(j + 1) * W1 + i];
      const cs = (v0 >= lv ? 1 : 0) | (v1 >= lv ? 2 : 0) | (v2 >= lv ? 4 : 0) | (v3 >= lv ? 8 : 0);
      if (cs === 0 || cs === 15) continue;
      if (dashed && (((i >> 1) + (j >> 1)) & 1)) continue;
      const t = (a, b) => (lv - a) / (b - a);
      const A = [i + t(v0, v1), j], B = [i + 1, j + t(v1, v2)], C = [i + t(v3, v2), j + 1], D = [i, j + t(v0, v3)];
      let pr;
      switch (cs) {
        case 1: case 14: pr = [[D, A]]; break;
        case 2: case 13: pr = [[A, B]]; break;
        case 3: case 12: pr = [[D, B]]; break;
        case 4: case 11: pr = [[B, C]]; break;
        case 5: pr = [[D, A], [B, C]]; break;
        case 6: case 9: pr = [[A, C]]; break;
        case 7: case 8: pr = [[D, C]]; break;
        case 10: pr = [[A, B], [D, C]]; break;
      }
      for (const [p, q] of pr) { ll(p[0], p[1], SR * 1.002, pos); ll(q[0], q[1], SR * 1.002, pos); }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const mat = new LineBasicMaterial({ color: accent, transparent: true, opacity: 0 });
    geos.push(geo); mats.push(mat);
    const obj = new LineSegments(geo, mat);
    spin.add(obj);
    // main lines = full token colour (opacity 1); ~20% secondary lines at 0.6
    levels.push({ mat, base: L % 5 === 2 ? 0.6 : 1, delay: 0.1 + L * 0.04, dur: 0.9 });
  };

  /* ---------- chunked build: field rows, then one contour level per step, within a time budget per slice ---------- */
  let built = false, lost = false, row = 0, level = 0, timer = 0;
  const step = () => {
    timer = 0;
    if (lost) return;
    const t0 = performance.now();
    while (performance.now() - t0 < SLICE_MS) {
      if (row <= GH) {
        const lat = Math.PI / 2 - (row / GH) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
        for (let i = 0; i <= GW; i++) {
          const v = field(cl * lonCos[i], sl, cl * lonSin[i]);
          grid[row * (GW + 1) + i] = v;
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
        row++;
      } else if (level < NL) buildLevel(level++);
      else { built = true; break; }
    }
    if (built) { onBuilt(); return; }
    timer = setTimeout(step, 0);
  };

  /* ---------- size, HUD ---------- */
  let W = 0, H = 0;
  const drawHud = () => {
    const cx = W / 2, cy = H / 2, rp = RING_FRAC * H, a = rp + 16, b = rp + 38;
    const ln = (x1, y1, x2, y2, sw, op) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${sw}"${op ? ` opacity="${op}"` : ''}/>`;
    const ring = (r, sw, op) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${sw}"${op ? ` opacity="${op}"` : ''}/>`;
    hud.setAttribute('viewBox', `0 0 ${W} ${H}`);
    hud.innerHTML = '<g>' + ring(rp, 1) + ring(rp - 5, 0.6, 0.7) + ring(rp + 7, 0.6, 0.7)
      + ln(cx - rp, cy, cx + rp, cy, 0.7, 0.8) + ln(cx, cy - rp, cx, cy + rp, 0.7, 0.8)
      + ln(cx - b, cy, cx - a, cy, 1) + ln(cx + a, cy, cx + b, cy, 1) + ln(cx, cy - b, cx, cy - a, 1) + ln(cx, cy + a, cx, cy + b, 1) + '</g>';
  };
  const resize = () => {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    renderer.setPixelRatio(capDpr(MAX_DPR));
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    camera.position.set(0, 0, CAM_D); camera.lookAt(0, 0, 0);
    drawHud();
    return true;
  };

  /* ---------- animation ---------- */
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const onMove = (e) => { const r = host.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1; };
  const onLeave = () => { mouse.x = 0; mouse.y = 0; };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);

  let raf = 0, started = false, onScreen = false, tStart = 0;
  const draw = (now = performance.now()) => {
    if (lost || !W) return;
    const reduced = reducedMq.matches, live = started && built && !reduced;
    const t = live ? (now - tStart) / 1000 : 0;
    if (live) {
      mouse.sx += (mouse.x - mouse.sx) * 0.04; mouse.sy += (mouse.y - mouse.sy) * 0.04;
      spin.rotation.y = t * 0.06;
      const yaw = Math.sin(t * 0.12) * 0.05 + mouse.sx * 0.06;
      const pitch = Math.cos(t * 0.09) * 0.03 + mouse.sy * 0.04;
      camera.position.set(Math.sin(yaw) * CAM_D, -Math.sin(pitch) * CAM_D, Math.cos(yaw) * Math.cos(pitch) * CAM_D);
    } else { spin.rotation.y = 0; camera.position.set(0, 0, CAM_D); }
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const l of levels) l.mat.opacity = l.base * (reduced ? 1 : live ? ease(Math.min(1, Math.max(0, (t - l.delay) / l.dur))) : 0);
    renderer.render(scene, camera);
    canvas.classList.add('is-ready');
    if (!reduced ? live : built) hud.classList.add('is-on');
  };
  const loop = (now) => { raf = requestAnimationFrame(loop); draw(now); };
  const sync = () => {
    const run = onScreen && built && started && !document.hidden && !reducedMq.matches;
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run && onScreen && built) draw();
  };
  function onBuilt() { if (started) tStart = performance.now(); sync(); }

  const ro = new ResizeObserver(() => { if (resize()) draw(); });
  ro.observe(host);
  const io = new IntersectionObserver((e) => {
    onScreen = e[e.length - 1].isIntersecting;
    if (onScreen && !started) { started = true; tStart = performance.now(); }
    sync();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (e) => { e.preventDefault(); lost = true; };
  canvas.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reducedMq.removeEventListener('change', sync);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
    renderer.dispose();
    canvas.remove(); hud.remove();
  };

  resize();
  timer = setTimeout(step, 0);
  host.__sphere = { levels, camera, spin, get built() { return built; }, get started() { return started; }, ringFrac: RING_FRAC, camD: CAM_D };
  return { levels: NL, destroy };
}
