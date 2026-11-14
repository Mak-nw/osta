/**
 * il-hero.js — shared shell of the inner-page HERO illustrations (About sphere, Services trajectories) on the LIGHT surface.
 * Same language as il-scene.js (DOTS + THIN LINES of 1 device px, no dashes, no fills, flat hard-edged dots, no cursor, calm seamless loop),
 * but ONE free-standing scene per canvas (the whole `.hero__media` art zone), orthographic and exactly centred, so it does not use the slot/offscreen-copy model of il-scene.js.
 * Colours: ink = token --accent, bg = token --surface (read through a probe span); every line / dot colour is an OPAQUE premix bg->ink by DEPTH alpha (kit.A0 near ... kit.A1 far, 1.0..0.35),
 * so crossings never get brighter and the transparent canvas shows the hero surface.
 *
 * initHeroScene({ host, build, period, staticPhase = 0, pad = 0.07, maxDpr = 2 }) -> { destroy(), draw(phase), kit } | null (no WebGL)
 *   host    the art zone element (canvas.hero__canvas is prepended; it fills the zone)
 *   build   (kit) => { root: Object3D, R: bounding radius (world units) of everything drawn, update(phase) }   (phase = 2*PI*t/period, integer harmonics only => frame 0 == frame T)
 *   The scene is fitted into the SMALLER side of the zone with `pad` margin on every side (R -> (0.5 - pad) * min(W, H)); the origin of the world = the centre of the zone.
 * kit: THREE classes (Group, Vector3, Mesh...), lines(pts, {a0,a1}) / dots(pts, px, {a0,a1}) factories (pts = [[x,y,z]...], lines = segment pairs), arc/seg helpers, TAU.
 */
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Color, Vector3, BufferGeometry, Float32BufferAttribute, LineSegments, Points, ShaderMaterial, Mesh, SphereGeometry, MeshBasicMaterial,
} from 'three';
import { capDpr } from './dpr.js';
import { whenPageLoaded, revealLive } from './hero-poster.js';

export const TAU = Math.PI * 2;
const CAM_D = 20;
const COMMON_V = 'varying float vA; uniform float uNear, uFar, uA0, uA1;\nfloat depthAlpha(vec4 mv){ return mix(uA0, uA1, clamp((-mv.z - uNear) / (uFar - uNear), 0.0, 1.0)); }';
const FRAG = 'uniform vec3 uInk, uBg; varying float vA; void main(){ DISCARD gl_FragColor = vec4(mix(uBg, uInk, vA), 1.0);\n#include <colorspace_fragment>\n }';

export function initHeroScene({ host, build, period = 60, staticPhase = 0, pad = 0.07, maxDpr = 2 } = {}) {
  if (!host) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const probe = document.createElement('span'); probe.style.display = 'none'; host.appendChild(probe);
  const tok = (name) => { probe.style.backgroundColor = `var(${name})`; return new Color(getComputedStyle(probe).backgroundColor); };
  const ink = tok('--accent'), bg = tok('--surface'); probe.remove();

  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.remove(); return null; }
  renderer.setClearColor(0x061f52, 0);

  const shared = { uNear: { value: CAM_D - 2 }, uFar: { value: CAM_D + 2 }, uInk: { value: ink }, uBg: { value: bg } };
  const geos = [], mats = [], dotMats = [];
  const mat = (a0, a1, point, px) => {
    const m = new ShaderMaterial({
      uniforms: { ...shared, uA0: { value: a0 }, uA1: { value: a1 }, ...(point ? { uSize: { value: px } } : {}) },
      vertexShader: `${COMMON_V}\n${point ? 'uniform float uSize;' : ''} void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = depthAlpha(mv); ${point ? 'gl_PointSize = uSize;' : ''} gl_Position = projectionMatrix * mv; }`,
      fragmentShader: FRAG.replace('DISCARD', point ? 'if (length(gl_PointCoord - 0.5) > 0.5) discard;' : ''),
    });
    mats.push(m); if (point) dotMats.push([m, px]);
    return m;
  };
  const geoOf = (pts) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3)); geos.push(g); return g; };
  const lines = (pts, { a0 = 1, a1 = 0.35 } = {}) => { const o = new LineSegments(geoOf(pts), mat(a0, a1, false)); o.frustumCulled = false; return o; };
  const dots = (pts, px = 3, { a0 = 1, a1 = 0.35 } = {}) => { const o = new Points(geoOf(pts), mat(a0, a1, true, px)); o.frustumCulled = false; o.renderOrder = 2; return o; };
  /** a polyline [p0,p1,...] -> segment-pair list */
  const segsOf = (pl, closed = false) => { const out = []; for (let i = 0; i < pl.length - 1; i++) out.push(pl[i], pl[i + 1]); if (closed) out.push(pl[pl.length - 1], pl[0]); return out; };
  /** depth-only sphere (writes no colour): hides everything behind the near hemisphere, so a globe shows only its front side */
  const mask = (radius) => {
    const g = new SphereGeometry(radius, 64, 48), m = new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    geos.push(g); mats.push(m);
    const o = new Mesh(g, m); o.renderOrder = -1; return o;
  };
  const kit = { Group, Vector3, Color, lines, dots, segsOf, geoOf, mask, TAU, ink, bg, invalidate: () => {} };

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, CAM_D); camera.lookAt(0, 0, 0);
  const s = build(kit);
  scene.add(s.root);
  shared.uNear.value = CAM_D - s.R; shared.uFar.value = CAM_D + s.R;
  // fit: by default the bounding radius s.R goes into the smaller side; s.half = [hx, hy] (half extents of a flat drawing) fits the box instead (margin pad * min side everywhere)

  let W = 0, H = 0, sizedW = 0, sizedH = 0, dpr = 0, lost = false, raf = 0, onScreen = false, released = false, t0 = 0;   // released = the page is fully loaded and the poster handed over: the clock starts here
  const fit = () => {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    const nd = capDpr(maxDpr);
    if (nd !== dpr || W !== sizedW || H !== sizedH) { dpr = nd; renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); sizedW = W; sizedH = H; }   // reallocate the buffer only on a real size / DPR change
    const mn = Math.min(W, H);
    const unit = s.half ? Math.min((W / 2 - pad * mn) / s.half[0], (H / 2 - pad * mn) / s.half[1]) : (0.5 - pad) * mn / s.R;   // css px per world unit
    camera.left = -W / 2 / unit; camera.right = W / 2 / unit; camera.top = H / 2 / unit; camera.bottom = -H / 2 / unit;
    camera.updateProjectionMatrix();
    dotMats.forEach(([m, px]) => { m.uniforms.uSize.value = px * dpr; });
    return true;
  };
  const draw = (phase) => {
    if (lost || !W) return;
    s.update(phase);
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
  };
  const live = () => onScreen && released && !document.hidden && !reducedMq.matches;
  const phaseNow = () => (((performance.now() - t0) / 1000) % period) / period * TAU;
  const loop = () => { raf = requestAnimationFrame(loop); draw(phaseNow()); };
  const sync = () => {
    const run = live();
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run && onScreen) draw(staticPhase);
  };
  const ro = new ResizeObserver(() => { if (fit()) { if (live()) draw(phaseNow()); else draw(staticPhase); } });
  ro.observe(host);
  const io = new IntersectionObserver((e) => {
    onScreen = e[e.length - 1].isIntersecting;
    sync();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (e) => { e.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  canvas.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; lost = true; s.dispose?.();
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reducedMq.removeEventListener('change', sync);
    canvas.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
    renderer.dispose();
    canvas.remove(); delete host.__heroScene;
  };

  if (fit()) draw(staticPhase);   // frame 0 on the still invisible canvas (shader warm-up)
  whenPageLoaded().then(() => {
    if (lost) return;
    released = true; t0 = performance.now();
    if (fit()) draw(staticPhase);
    revealLive(host, canvas);
    sync();
  });
  kit.invalidate = () => { if (!lost && W && !raf) draw(live() ? phaseNow() : staticPhase); };   // geometry finished later (chunked build) -> repaint
  /** world point -> css px inside the zone (for HTML labels) */
  const project = (v) => { scene.updateMatrixWorld(true); const p = v.clone().project(camera); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H }; };
  const api = { destroy, draw, project, period, info: s, get size() { return [W, H]; }, kit, scene, camera, get running() { return !!raf; } };
  host.__heroScene = api;   // test / debug hook: draw(phase) renders a given phase (the loop is paused in tests by hiding or reduced motion)
  return api;
}
