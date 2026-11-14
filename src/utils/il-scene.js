/**
 * il-scene.js — the ONE illustration engine of the site (hero language: DOTS + THIN LINES of 1 device px over flat fills).
 * Every new three.js illustration (Home, About, Services, Product ...) is built on this module; do not copy renderer / probe / observer code into pages.
 *
 * What the engine owns (rules IL1-IL11 of content/audit/restyle-spec.md):
 *  - ONE WebGLRenderer on an offscreen canvas per call (= per section); every visible slot is rendered into it and the frame is copied into that slot's own 2D canvas
 *    (so a section costs exactly one WebGL context, however many cards it has);
 *  - colours from CSS tokens --il-fill / --il-soft / --il-bg, read once with a probe span inside `host` (kit.fill / kit.soft / kit.bg);
 *  - pre-mixed opaque line colours (kit.lineMat(a) = bg lerp soft by a), native 1-device-px lines, flat round dots (Points + discard shader), white fill + occluder materials;
 *  - the floor dot field under the objects (kit.floor(), FLOOR_Y / FLOOR_LIFT: objects move, the camera never does);
 *  - IntersectionObserver (render only slots on screen), visibilitychange pause, prefers-reduced-motion = one static frame, ResizeObserver, capDpr, webglcontextlost -> stop, destroy().
 *
 * Usage:
 *   import { createIlScene, isoCamera, perspCamera } from '../utils/il-scene.js';
 *   const scenes = { eudra: (kit) => { const root = new kit.Group(); root.add(kit.floor()); ...; return { root, staticPhase, update(phase) {...} }; } };
 *   const il = createIlScene({ host: sectionEl, slots: artEls, scenes, canvasClass: 'x__canvas', period: 12, camera: isoCamera() });   // null without WebGL
 *   il.destroy();
 *
 * createIlScene(opts):
 *   host         Element   token root for the probe (a node inside the CSS scope that defines --il-*); default = first slot element
 *   slots        Element[] | {el, scene?}[]   art zones; the scene key = slot.scene || el.dataset.scene; slots without a matching factory are skipped
 *   scenes       { [key]: (kit, slot) => { root: Object3D, update(phase), staticPhase?, ...extra fields read by camera.fit (e.g. R) } }
 *   canvasClass  class of the 2D canvas appended to every slot (it gets `is-ready` after the first frame)
 *   period       seconds of one seamless loop (every motion = a function of phase = 2*PI*t/period with integer harmonics only)
 *   maxDpr       DPR cap (default 2; capDpr lowers it to 1.5 on <= 1199 px)
 *   staticPhase  phase of the reduced-motion / paused frame (a scene's own `staticPhase` wins)
 *   shrink       fill meshes are this share of their outline (default 0.97) so edges stay in front
 *   camera       { create(): Camera, fit(camera, item, sceneObj) } — use isoCamera() / perspCamera() or your own; fit() runs before each render
 *   beforeRender (item, kit) => void   optional hook after scene.updateMatrixWorld (e.g. billboards)
 * Returns { destroy(), draw(index, phase | 'static'), addSlot(el | {el, scene}), slots, kit, get running() } or null (no WebGL / nothing to draw).
 *
 * kit (given to every scene factory): THREE classes (Group, Mesh, Vector3, ...), colours fill/soft/bg + mix(a), materials lineMat(a, {depth}) / fillMat / occluder / dotMat(px, color) / dot.{fill,soft,mid,floor},
 *   helpers track(geo), geoOf(pts), segs(pts, mat), segsOf(polyline, closed), dots(pts, mat), floor(), solid(w,h,d,filled), loopOf(geo, mat), circle / circleXZ / rectXZ / corners,
 *   constants FLOOR_Y, FLOOR_LIFT, FIELD_N, FIELD_STEP, DOT_PX, FLOOR_DOT_PX, TAU, and `cache` (per-engine scratch object for geometries shared between factories).
 * Floor concept: ONE floor plane per section — world y = FLOOR_Y, whole scene shifted by FLOOR_LIFT (root.position.y = FLOOR_Y + FLOOR_LIFT), the same camera / scale for every slot,
 *   so the floor diamond sits at the same screen position in every card; centre of footprint = centre of floor.
 */
import {
  WebGLRenderer, Scene, OrthographicCamera, PerspectiveCamera, Group, Color, BufferGeometry, Float32BufferAttribute, BufferAttribute, LineBasicMaterial, LineSegments, LineLoop, Points, ShaderMaterial,
  BoxGeometry, EdgesGeometry, SphereGeometry, Mesh, MeshBasicMaterial, DoubleSide, Vector3, Quaternion,
} from 'three';
import { capDpr } from './dpr.js';

export const TAU = Math.PI * 2;
export const FLOOR_Y = 0, FLOOR_LIFT = -34;      // shared floor plane (see header)
export const FIELD_N = 5, FIELD_STEP = 28;       // floor dot field -140..140
export const DOT_PX = 3, FLOOR_DOT_PX = 2;       // dot diameters in CSS px (x DPR)

export const geoOf = (pts) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3)); return g; };
export const segsOf = (pts, closed = false) => { const out = []; const n = pts.length; for (let i = 0; i < n - 1; i++) out.push(pts[i], pts[i + 1]); if (closed) out.push(pts[n - 1], pts[0]); return out; };
export const circle = (r, n = 48) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [Math.cos(a) * r, Math.sin(a) * r, 0]; });
export const circleXZ = (cx, cz, r, y, n = 32) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; });
export const rectXZ = (x0, z0, x1, z1, y) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
export const corners = (w, h, d) => [-w / 2, w / 2].flatMap((x) => [-h / 2, h / 2].flatMap((y) => [-d / 2, d / 2].map((z) => [x, y, z])));

/** Isometric orthographic camera (looks at the origin from (1,1,1); x -> screen right-down, z -> screen left-down). The span (world units) is fitted into `fill` of the slot. */
export const isoCamera = ({ fill = 0.86, spanW = 400, spanH = 262 } = {}) => ({
  create: () => { const c = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000); c.position.set(500, 500, 500); c.lookAt(new Vector3(0, 0, 0)); return c; },
  fit: (c, it) => {
    const u = fill * Math.min(it.W / it.d / spanW, it.H / it.d / spanH);       // CSS px per world unit
    const hw = it.W / it.d / (2 * u), hh = it.H / it.d / (2 * u);
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh; c.updateProjectionMatrix();
  },
});
/** Perspective camera on the z axis; the scene (radius `s.R`) fills `fill` of the slot's smaller side. */
export const perspCamera = ({ fov = 30, fill = 0.68 } = {}) => {
  const tan = Math.tan((fov / 2) * Math.PI / 180);
  return {
    create: () => new PerspectiveCamera(fov, 1, 0.1, 50),
    fit: (c, it, s) => { c.aspect = it.W / it.H; c.updateProjectionMatrix(); c.position.set(0, 0, s.R / (fill * tan * Math.min(1, it.W / it.H))); },
  };
};

export function createIlScene({ host, slots, scenes, canvasClass = 'il-canvas', period = 12, maxDpr = 2, staticPhase = 0, shrink = 0.97, camera: camDef, beforeRender } = {}) {
  const defs = [...(slots || [])].filter(Boolean).map((s) => (s instanceof Element ? { el: s } : s));
  if (!defs.length || !camDef) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  // all colours come from CSS: local --il-* tokens on the art zone (probe span inside `host`)
  const probeHost = host || defs[0].el;
  const probe = document.createElement('span'); probe.style.display = 'none'; probeHost.appendChild(probe);
  // computed colours may come back as `color(srgb ...)` (color-mix tokens), which THREE.Color cannot parse (it silently stays white): normalise through a 1x1 canvas -> rgb bytes
  const px = document.createElement('canvas'); px.width = px.height = 1; const pctx = px.getContext('2d', { willReadFrequently: true });
  const tok = (name) => {
    probe.style.backgroundColor = `var(${name})`;
    pctx.clearRect(0, 0, 1, 1); pctx.fillStyle = '#000'; pctx.fillStyle = getComputedStyle(probe).backgroundColor; pctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data; return new Color(`rgb(${r},${g},${b})`);
  };
  const fill = tok('--il-fill'), soft = tok('--il-soft'), bg = tok('--il-bg'); probe.remove();
  const mix = (a) => bg.clone().lerp(soft, a);   // opaque pre-mixed line colour = soft at opacity a over the background (crossing lines never get brighter)

  const gl = document.createElement('canvas');
  let renderer;
  try { renderer = new WebGLRenderer({ canvas: gl, antialias: true, alpha: true }); } catch { return null; }
  renderer.setClearColor(0x061f52, 0);
  renderer.setPixelRatio(1);

  const mats = [], geos = [], dotMats = [];
  const track = (g) => { geos.push(g); return g; };
  const lineCache = new Map();
  const lineMat = (a, { depth = true } = {}) => {
    const k = `${Math.round(a * 20) / 20}|${depth}`;
    if (!lineCache.has(k)) { const m = new LineBasicMaterial({ color: mix(Math.round(a * 20) / 20), ...(depth ? {} : { depthTest: false, depthWrite: false }) }); mats.push(m); lineCache.set(k, m); }
    return lineCache.get(k);
  };
  const fillMat = new MeshBasicMaterial({ color: fill, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const occluder = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });   // depth-only: hides lines / dots behind it
  mats.push(fillMat, occluder);
  const dotMat = (px, color) => {
    const m = new ShaderMaterial({
      uniforms: { uSize: { value: px }, uColor: { value: color } }, transparent: true, depthWrite: false,
      vertexShader: 'uniform float uSize; void main(){ gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor, 1.0 - smoothstep(0.38, 0.5, d)); }',
    });
    mats.push(m); dotMats.push([m, px]); return m;
  };
  const memo = (f) => { let v; return () => (v ||= f()); };
  const dot = {};
  Object.defineProperties(dot, {
    fill: { get: memo(() => dotMat(DOT_PX, fill)) }, soft: { get: memo(() => dotMat(DOT_PX, soft)) },
    mid: { get: memo(() => dotMat(DOT_PX - 0.5, mix(0.7))) }, floor: { get: memo(() => dotMat(FLOOR_DOT_PX, mix(0.32))) },
  });

  const segs = (pts, m = lineMat(1)) => { const o = new LineSegments(track(geoOf(pts)), m); o.frustumCulled = false; o.renderOrder = 1; return o; };
  const loopOf = (geo, m = lineMat(1)) => { const o = new LineLoop(geo, m); o.renderOrder = 1; o.frustumCulled = false; return o; };
  const dots = (pts, m = dot.soft) => { const o = new Points(track(geoOf(pts)), m); o.renderOrder = 3; o.frustumCulled = false; return o; };
  const dotsGeo = (geo, m = dot.fill) => { const o = new Points(geo, m); o.renderOrder = 3; o.frustumCulled = false; return o; };
  const floor = (n = FIELD_N, step = FIELD_STEP) => { const pts = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) pts.push([i * step, 0, j * step]); return dots(pts, dot.floor); };
  // filled box (white fill + edges + visible corner dots); centre at the group origin, size w x h x d
  const boxGeo = {};
  const solid = (w, h, d, filled = true, edgeMat = lineMat(1), dotM = dot.soft) => {
    const key = `${w}|${h}|${d}`; const bg_ = boxGeo[key] ||= { box: track(new BoxGeometry(w, h, d)), edge: null };
    bg_.edge ||= track(new EdgesGeometry(bg_.box));
    const g = new Group();
    const body = new Mesh(bg_.box, filled ? fillMat : occluder); body.scale.setScalar(shrink); g.add(body);
    const e = new LineSegments(bg_.edge, edgeMat); e.renderOrder = 1; e.frustumCulled = false; g.add(e);
    const d8 = new Points(track(geoOf(corners(w, h, d))), dotM); d8.renderOrder = 3; d8.frustumCulled = false; g.add(d8);
    return g;
  };

  const kit = {
    Group, Mesh, Vector3, Quaternion, Color, BufferGeometry, Float32BufferAttribute, BufferAttribute, LineSegments, LineLoop, Points, BoxGeometry, EdgesGeometry, SphereGeometry,
    fill, soft, bg, mix, lineMat, fillMat, occluder, dotMat, dot, track, geoOf, segs, segsOf, loopOf, dots, dotsGeo, floor, solid, circle, circleXZ, rectXZ, corners, shrink,
    FLOOR_Y, FLOOR_LIFT, FIELD_N, FIELD_STEP, DOT_PX, FLOOR_DOT_PX, TAU,
    cache: {},   // per-engine scratch for scene factories (shared geometries etc.; disposed through kit.track)
  };

  const camera = camDef.create();
  const items = [];
  let lost = false, raf = 0; const t0 = performance.now();
  const resize = (it) => {
    const w = it.el.clientWidth, h = it.el.clientHeight; if (!w || !h) return false;
    const d = capDpr(maxDpr);
    it.d = d; it.W = Math.round(w * d); it.H = Math.round(h * d); it.canvas.width = it.W; it.canvas.height = it.H; return true;
  };
  const draw = (it, phase) => {
    if (lost || !it.W) return;
    if (gl.width !== it.W || gl.height !== it.H) renderer.setSize(it.W, it.H, false);
    camDef.fit(camera, it, it.s);
    dotMats.forEach(([m, px]) => { m.uniforms.uSize.value = px * it.d; });
    it.s.update(phase === 'static' ? (it.s.staticPhase ?? staticPhase) : phase);
    it.scene.updateMatrixWorld(true);
    if (beforeRender) beforeRender(it, kit);
    renderer.render(it.scene, camera);
    it.ctx.clearRect(0, 0, it.W, it.H);
    it.ctx.drawImage(gl, 0, 0);
    it.canvas.classList.add('is-ready');
  };
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const phase = (((performance.now() - t0) / 1000) % period) / period * TAU;
    items.forEach((it) => { if (it.onScreen) draw(it, phase); });
  };
  const sync = () => {
    const run = items.some((i) => i.onScreen) && !document.hidden && !reducedMq.matches;
    if (run && !raf) raf = requestAnimationFrame(frame);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run) items.forEach((it) => { if (it.onScreen) draw(it, 'static'); });
  };
  const find = (el) => items.find((i) => i.el === el);
  const ro = new ResizeObserver((en) => { en.forEach((e) => { const it = find(e.target); if (it && resize(it) && !raf) draw(it, 'static'); }); });
  const io = new IntersectionObserver((en) => { en.forEach((e) => { const it = find(e.target); if (it) it.onScreen = e.isIntersecting; }); sync(); });
  const addSlot = (def) => {
    const d = def instanceof Element ? { el: def } : def;
    const make = scenes[d.scene || d.el.dataset.scene]; if (!make) return null;
    const scene = new Scene(); const s = make(kit, d); scene.add(s.root);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); canvas.className = canvasClass;
    d.el.appendChild(canvas);
    const it = { el: d.el, scene, s, canvas, ctx: canvas.getContext('2d'), onScreen: false, W: 0, H: 0, d: 1 };
    items.push(it); resize(it); ro.observe(it.el); io.observe(it.el);
    return it;
  };
  defs.forEach(addSlot);
  if (!items.length) { ro.disconnect(); io.disconnect(); renderer.dispose(); return null; }
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (ev) => { ev.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  gl.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf); raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync); reducedMq.removeEventListener('change', sync); gl.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); renderer.dispose();
    items.forEach((it) => it.canvas.remove());
  };
  // `draw(i, phase)` is a test / debug hook (no-op in production use)
  return { destroy, addSlot, draw: (i, phase) => draw(items[i], phase), slots: items, kit, get running() { return !!raf; } };
}
