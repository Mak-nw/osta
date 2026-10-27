// Services hero: three.js "trajectories" scene (ported from scenes/archive-trajectories.html).
// ~45 thin lines (rays, parabolas, long shallow curves) grow from one source at the lower left and run out through the edges of the strip;
// x / + markers sit on the lines, small HTML labels (ISO country codes only, no numbers) appear together with the line being drawn.
// Transparent canvas (the hero surface shows through), colour = --accent, no gradients/masks/shadows. The draw-in starts once, when the strip first
// enters the viewport; then a slight camera sway (clock only, no cursor reaction); once a line is fully drawn a small dot travels along it from the source to its end (loop with a pause). Renders only while on screen and the tab is
// visible; prefers-reduced-motion = one static final frame (no dots). No WebGL -> returns null (the strip is hidden by the caller).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Color, MathUtils, BufferGeometry, BufferAttribute, ShaderMaterial, Points, LineBasicMaterial, Line, LineSegments, QuadraticBezierCurve3,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const DESIGN_ASPECT = 16 / 5; // frame the scene was drawn for (desktop strip); a narrower host widens the FOV so the whole scene stays in view
const CAM_D = 10, FOV = 45, MAX_DPR = 2, MAX_LABELS = 14, DOT_PX = 5, MAX_DOTS = 30, MIN_DOTS = 16, FADE = 0.08;
// ISO codes only; no CIS countries and no UA
const CODES = ['DE', 'NL', 'BE', 'FR', 'IT', 'ES', 'PL', 'CH', 'AT', 'GB', 'SE', 'TR', 'IN', 'CN', 'JP', 'KR', 'US', 'BR', 'AE', 'CA', 'MX', 'IE', 'NO', 'FI', 'PT', 'GR', 'AR', 'CL', 'CO'];

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ease = (t) => 1 - (1 - t) ** 3;

export function initHeroTrajectories(host) {
  if (!host) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const accent = new Color(getComputedStyle(host).getPropertyValue('--accent').trim());

  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.remove(); return null; }
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 3.2, 0.1, 100);
  const world = new Group();
  scene.add(world);

  const R = rng(2026);
  const rr = (a, b) => a + (b - a) * R();
  const geos = [], mats = [];

  /* ---------- trajectories (local coords, source at origin) ---------- */
  const lines = [];
  const addLine = (pts, opacity, delay, dur) => {
    const geo = new BufferGeometry().setFromPoints(pts);
    const mat = new LineBasicMaterial({ color: accent, transparent: true, opacity });
    geos.push(geo); mats.push(mat);
    const obj = new Line(geo, mat);
    world.add(obj);
    const l = { obj, pts, n: pts.length, delay, dur, prog: 0 };
    lines.push(l);
    return l;
  };
  const op = () => { const faint = R() < 0.3, v = rr(0.5, 0.7); return faint ? v : 1; };   // main lines = full token colour; <=30% secondary lines at 0.5-0.7
  const ray = (a, L, bend, zE, n, delay, dur) => {
    const end = new Vector3(Math.cos(a) * L, Math.sin(a) * L, zE);
    const mid = end.clone().multiplyScalar(0.5);
    mid.x += -Math.sin(a) * bend; mid.y += Math.cos(a) * bend; mid.z = end.z * 0.5;
    return addLine(new QuadraticBezierCurve3(new Vector3(), mid, end).getPoints(n), op(), delay, dur);
  };
  for (let i = 0; i < 18; i++) {   // long near-straight rays fanning up/right
    const a = (4 + (i / 17) * 76 + rr(-1.2, 1.2)) * Math.PI / 180;
    const L = rr(22, 30), bend = rr(-1.6, 1.6);
    ray(a, L, bend, rr(-3, 2), 180, rr(0, 1.4), rr(1.8, 3));
  }
  const leftLines = [];
  for (let i = 0; i < 7; i++) {    // rays leaning left, leaving through the left edge
    const a = (95 + i * 3.3 + rr(-1, 1)) * Math.PI / 180, L = rr(12, 18), bend = rr(-0.8, 0.8);
    leftLines.push(ray(a, L, bend, rr(-2, 2), 140, rr(0, 1.2), rr(1.8, 2.8)));
  }
  for (let i = 0; i < 15; i++) {   // high parabolic arcs
    const Rg = i < 5 ? rr(3, 7) : rr(6, 17), A = rr(2.2, 9), zE = rr(-3, 2), pts = [], N = 160;
    for (let k = 0; k <= N; k++) {
      const u = (k / N) * 1.12, x = u * Rg, y = 4 * A * u * (1 - u);
      if (y < -0.6) break;
      pts.push(new Vector3(x, y, zE * (k / N)));
    }
    addLine(pts, op(), rr(0.1, 1.6), rr(2, 3.4));
  }
  for (let i = 0; i < 5; i++) {    // long shallow curves toward the lower right
    const a = rr(0.5, 10) * Math.PI / 180, L = rr(24, 32), bend = rr(-1.2, 0.8);
    const end = new Vector3(Math.cos(a) * L, Math.sin(a) * L - rr(0, 0.5), rr(-2, 2));
    const mid = end.clone().multiplyScalar(0.5); mid.y += bend; mid.z = end.z * 0.5;
    addLine(new QuadraticBezierCurve3(new Vector3(), mid, end).getPoints(160), op(), rr(0.2, 1.6), rr(2.2, 3.6));
  }

  /* ---------- markers + labels ---------- */
  const candidates = [];
  for (let i = 0; i < 4; i++) candidates.push({ line: leftLines[(i * 2) % 7], t: 0.1 + i * 0.13, plus: i % 2 === 1, size: rr(9, 14), left: true });
  for (let i = 0; i < 90; i++) {
    const line = lines[Math.floor(R() * lines.length)];
    const t = Math.min(0.92, 0.04 + R() ** 1.7 * 0.9);   // biased toward the source
    candidates.push({ line, t, plus: R() < 0.4, size: rr(8, 16) });
  }
  const mk = (pairs) => { const g = new BufferGeometry().setFromPoints(pairs.map((p) => new Vector3(p[0], p[1], 0))); geos.push(g); return g; };
  const markerGeo = { x: mk([[-.5, -.5], [.5, .5], [-.5, .5], [.5, -.5]]), p: mk([[-.5, 0], [.5, 0], [0, -.5], [0, .5]]) };
  const markerMat = new LineBasicMaterial({ color: accent });
  mats.push(markerMat);

  /* ---------- moving dots (travel along line vectors) ---------- */
  for (const l of lines) {   // cumulative arc length per line
    const cum = new Float32Array(l.n);
    for (let k = 1; k < l.n; k++) cum[k] = cum[k - 1] + l.pts[k].distanceTo(l.pts[k - 1]);
    l.cum = cum; l.len = cum[l.n - 1];
  }
  const dots = [];
  const addDot = (l, second) => {
    const speed = rr(0.25, 0.5) * 1;                       // fraction of line length per second
    const sp = Math.min(0.5, Math.max(0.2, speed * rr(0.85, 1.15)));
    const travel = 1 / sp, pause = rr(0.6, 2.2);
    dots.push({ l, travel, period: travel + pause, offset: second ? (travel + pause) * 0.5 : 0, s: 0 });
  };
  const medLen = lines.map((l) => l.len).sort((a, b) => a - b)[Math.floor(lines.length / 2)];
  for (const l of lines) if (dots.length < MAX_DOTS && R() < 0.6) addDot(l, false);
  for (const l of [...dots.map((d) => d.l)]) if (dots.length < MAX_DOTS && l.len > medLen && R() < 0.4) addDot(l, true);
  for (const l of lines) { if (dots.length >= MIN_DOTS) break; if (!dots.some((d) => d.l === l)) addDot(l, false); }
  const dotPos = new Float32Array(dots.length * 3), dotAlpha = new Float32Array(dots.length);
  const dotGeo = new BufferGeometry();
  dotGeo.setAttribute('position', new BufferAttribute(dotPos, 3));
  dotGeo.setAttribute('alpha', new BufferAttribute(dotAlpha, 1));
  const dotMat = new ShaderMaterial({
    uniforms: { uSize: { value: DOT_PX }, uColor: { value: accent } },
    vertexShader: 'attribute float alpha; varying float vA; uniform float uSize; void main(){ vA = alpha; gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ if (vA <= 0.001 || length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(uColor, vA);\n#include <colorspace_fragment>\n }',
    transparent: true, depthTest: false, depthWrite: false,
  });
  geos.push(dotGeo); mats.push(dotMat);
  const dotObj = new Points(dotGeo, dotMat);
  dotObj.frustumCulled = false; dotObj.renderOrder = 10; dotObj.visible = false;
  world.add(dotObj);
  const updateDots = (t) => {
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i], l = d.l;
      let a = 0;
      const tt = t - (l.delay + l.dur) - d.offset;
      if (l.prog >= 1 && tt >= 0) {
        const k = tt % d.period;
        if (k <= d.travel) {
          const s = k / d.travel;
          a = Math.min(1, s / FADE, (1 - s) / FADE);
          const target = s * l.len, cum = l.cum;
          let lo = 0, hi = l.n - 1;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= target) lo = m; else hi = m; }
          const seg = cum[hi] - cum[lo], f = seg > 0 ? (target - cum[lo]) / seg : 0, p0 = l.pts[lo], p1 = l.pts[hi];
          dotPos[i * 3] = p0.x + (p1.x - p0.x) * f; dotPos[i * 3 + 1] = p0.y + (p1.y - p0.y) * f; dotPos[i * 3 + 2] = p0.z + (p1.z - p0.z) * f;
          d.s = s;
        }
      }
      dotAlpha[i] = a < 0 ? 0 : a;
    }
    dotGeo.attributes.position.needsUpdate = true; dotGeo.attributes.alpha.needsUpdate = true;
  };

  const layer = document.createElement('div');
  layer.className = 'hero-scene__labels';
  layer.setAttribute('aria-hidden', 'true');
  host.append(layer);

  let W = 1, H = 1, active = [];
  const tmp = new Vector3();
  const pointAt = (c) => c.line.pts[Math.min(c.line.n - 1, Math.round(c.t * (c.line.n - 1)))];
  const project = (v) => { const p = v.clone().project(camera); return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H }; };

  const layoutMarkers = () => {
    active.forEach((m) => { world.remove(m.mesh); m.el?.remove(); });
    active = [];
    camera.position.set(0, 0, CAM_D); camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const taken = [], boxes = [];
    let labeled = 0;
    for (const c of candidates) {
      const s = project(pointAt(c).clone().add(world.position));
      if (s.x < (c.left ? -30 : 24) || s.x > W - 150 || s.y < 24 || s.y > H - 24) continue;
      if (taken.some((q) => Math.hypot(q.x - s.x, q.y - s.y) < (c.left ? 70 : labeled < MAX_LABELS ? 96 : 40))) continue;
      let el = null;
      if (labeled < MAX_LABELS) {
        const bx = [s.x + c.size * 0.5 + 6, s.y - 10, s.x + c.size * 0.5 + 6 + 24, s.y + 10];
        const clash = boxes.some((q) => bx[0] < q[2] + 6 && q[0] < bx[2] + 6 && bx[1] < q[3] + 6 && q[1] < bx[3] + 6);
        if (!clash && bx[2] < W - 8 && bx[0] > 8) {
          boxes.push(bx);
          el = document.createElement('span');
          el.className = 'hero-scene__label';
          el.textContent = CODES[labeled];
          layer.append(el);
          labeled++;
        }
      }
      taken.push(s);
      const mesh = new LineSegments(c.plus ? markerGeo.p : markerGeo.x, markerMat);
      mesh.position.copy(pointAt(c));
      world.add(mesh);
      active.push({ c, mesh, el });
    }
  };

  const resize = () => {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    renderer.setPixelRatio(capDpr(MAX_DPR));
    renderer.setSize(W, H, false);
    dotMat.uniforms.uSize.value = DOT_PX * renderer.getPixelRatio();
    camera.aspect = W / H;
    camera.fov = camera.aspect < DESIGN_ASPECT * 0.98 ? MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(FOV / 2)) * DESIGN_ASPECT / camera.aspect)) : FOV;
    camera.updateProjectionMatrix();
    const visH = 2 * CAM_D * Math.tan(MathUtils.degToRad(camera.fov / 2)), visW = visH * camera.aspect;
    world.position.set(-visW / 2 + 0.18 * visW, -visH / 2 - 0.07 * visH, 0);
    layoutMarkers();
    return true;
  };

  /* ---------- animation ---------- */
  let raf = 0, started = false, onScreen = false, lost = false, t0 = 0;
  const draw = (now = performance.now()) => {
    if (lost || !W) return;
    const reduced = reducedMq.matches;
    const t = started && !reduced ? (now - t0) / 1000 : 0;
    if (!reduced && started) {
      const yaw = Math.sin(t * 0.12) * 0.07;
      const pitch = Math.cos(t * 0.09) * 0.035;
      camera.position.set(Math.sin(yaw) * CAM_D, -Math.sin(pitch) * CAM_D, Math.cos(yaw) * Math.cos(pitch) * CAM_D);
    } else camera.position.set(0, 0, CAM_D);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const l of lines) {
      l.prog = reduced ? 1 : started ? Math.min(1, Math.max(0, (t - l.delay) / l.dur)) : 0;
      l.obj.geometry.setDrawRange(0, Math.ceil(l.n * ease(l.prog)));
    }
    dotObj.visible = !reduced && started;
    if (dotObj.visible) updateDots(t);
    const pxToWorld = (2 * Math.tan(MathUtils.degToRad(camera.fov / 2))) / H;
    for (const m of active) {
      const drawn = ease(m.c.line.prog) >= m.c.t && m.c.line.prog > 0;
      m.mesh.visible = drawn;
      m.mesh.getWorldPosition(tmp);
      m.mesh.quaternion.copy(camera.quaternion);
      m.mesh.scale.setScalar(m.c.size * pxToWorld * tmp.distanceTo(camera.position));
      if (m.el) {
        const s = project(tmp);
        m.el.style.transform = `translate(${(s.x + m.c.size * 0.5 + 6).toFixed(1)}px, ${(s.y - 10).toFixed(1)}px)`;
        m.el.classList.toggle('is-on', drawn);
      }
    }
    renderer.render(scene, camera);
    canvas.classList.add('is-ready');
  };
  const loop = (now) => { raf = requestAnimationFrame(loop); draw(now); };
  const sync = () => {
    const run = onScreen && !document.hidden && !reducedMq.matches;
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run && onScreen) draw();
  };
  const ro = new ResizeObserver(() => { if (resize()) draw(); });
  ro.observe(host);
  const io = new IntersectionObserver((e) => {
    onScreen = e[e.length - 1].isIntersecting;
    if (onScreen && !started) { started = true; t0 = performance.now(); }
    sync();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (e) => { e.preventDefault(); lost = true; };
  canvas.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reducedMq.removeEventListener('change', sync);
    canvas.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
    renderer.dispose();
    canvas.remove(); layer.remove();
  };

  if (resize()) draw();
  host.__trajectories = { lines, get active() { return active; }, markerMat, camera, dots, dotObj, dotPos, dotAlpha, world, get started() { return started; } };
  return { lines: lines.length, markers: active.length, destroy };
}
