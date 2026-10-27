// Home hero scene: three.js "fiber pill" (ported from scenes/fiber-pill.html).
// Wavy comet lines on a sphere that every ~5 s morph into a capsule ("pill") and back; a LineLoop outline of the silhouette; hover = a local zone around
// the cursor where the lines bend away. Transparent canvas (the hero surface shows through); lines + outline = token --accent (read from computed style;
// the ShaderMaterial gets the sRGB value because it writes gl_FragColor without colour-space conversion, the LineBasicMaterial uses three colour management).
// Orthographic camera (VIEW_H = 3.1 for aspect >= 1, grows for narrower containers so the silhouette is never cut off); the camera never moves, the group sways.
// Renders only while the hero is on screen and the tab is visible; prefers-reduced-motion = one static frame (t = 2.5, sphere, no morph/hover).
// Cursor is tracked relative to the scene container (pointer listened on the hero). No WebGL -> returns null (the caller hides the container).
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Vector2, Vector3, Color, SRGBColorSpace, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  ShaderMaterial, LineSegments, LineBasicMaterial, LineLoop, Sphere, DynamicDrawUsage, Clock,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const VIEW_H = 3.1, MAX_DPR = 2;
const RC = 0.58, H = 0.82;                       // capsule: cap radius, half cylinder length (sphere radius = 1)
const HOLD = 5, MORPH = 1.1, LOOP = 2 * (HOLD + MORPH);
const STATIC_T = 2.5;
const SEGS = 220, NT = 130, NB = 72, TILT = 1.05, ARC = 90, WIN = 1.25;

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const morphAt = (t) => {
  t = ((t % LOOP) + LOOP) % LOOP;
  if (t < HOLD) return 0;
  if (t < HOLD + MORPH) return ease((t - HOLD) / MORPH);
  if (t < 2 * HOLD + MORPH) return 1;
  return 1 - ease((t - 2 * HOLD - MORPH) / MORPH);
};
const densityAt = (t) => {
  t = ((t % LOOP) + LOOP) % LOOP;
  let best = 0;
  for (const c of [HOLD + MORPH / 2, LOOP - MORPH / 2]) {
    const d = ((t - c + LOOP / 2) % LOOP + LOOP) % LOOP - LOOP / 2;
    if (Math.abs(d) < WIN) best = Math.max(best, Math.cos(Math.PI * d / (2 * WIN)) ** 2);
  }
  return best;
};

function capPoint(dx, dy, dz) {
  const a = RC / (2 * (RC + H));
  const t = dx * 0.5 + 0.5;
  let x, rho;
  if (t < a) { const q = RC * (1 - t / a); x = -H - q; rho = Math.sqrt(Math.max(0, RC * RC - q * q)); }
  else if (t > 1 - a) { const q = RC * ((t - (1 - a)) / a); x = H + q; rho = Math.sqrt(Math.max(0, RC * RC - q * q)); }
  else { x = -H + ((t - a) / (1 - 2 * a)) * 2 * H; rho = RC; }
  const l = Math.hypot(dy, dz);
  let uy = 1, uz = 0;
  if (l > 1e-6) { uy = dy / l; uz = dz / l; }
  return [x, rho * uy, rho * uz];
}

const VERT = `
  attribute vec3 aSA; attribute vec3 aCA; attribute vec4 aL; attribute float aM; attribute float aR;
  uniform float uM, uT, uD, uHov, uTb, uZR; uniform vec2 uCur;
  varying float vA;
  vec3 patchBase(int i){
    if (i == 0) return vec3(1.0, 0.25, 0.35);
    if (i == 1) return vec3(-1.0, -0.3, 0.2);
    if (i == 2) return vec3(0.0, 1.0, -0.4);
    return vec3(0.3, -0.5, -1.0);
  }
  void main(){
    vec3 p = mix(aSA, aCA, uM);
    float seg = 0.82 * uM;
    vec3 c0 = vec3(clamp(p.x, -seg, seg), 0.0, 0.0);
    vec3 n0 = normalize(p - c0 + 1e-5);
    vec2 dv = (modelViewMatrix * vec4(p, 1.0)).xy - uCur;
    float d = length(dv);
    float wZ = uHov * (1.0 - smoothstep(0.0, uZR, d));
    if (wZ > 0.001) {
      vec3 od = vec3(dv / (d + 1e-3), 0.0) * mat3(modelViewMatrix);
      vec3 tg = od - n0 * dot(od, n0);
      float amp = wZ * (0.10 + 0.03 * sin(d * 15.0 - uT * 3.5)) * smoothstep(0.0, 0.08, d);
      vec3 q = p + tg * amp;
      vec3 cq = vec3(clamp(q.x, -seg, seg), 0.0, 0.0);
      p = cq + normalize(q - cq + 1e-5) * length(p - c0);
    }
    vec3 c = vec3(clamp(p.x, -seg, seg), 0.0, 0.0);
    vec3 no = normalize(p - c + 1e-5);
    vec3 nv = normalize(normalMatrix * no);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float k = aL.w;
    float wl = smoothstep(-0.02, 0.12, nv.z) * (1.0 - smoothstep(0.45, 0.72, nv.z));
    float pt = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec3 b = normalize(patchBase(i) + 0.45 * vec3(sin(uT * 0.13 + fi * 1.7), cos(uT * 0.11 + fi * 2.3), sin(uT * 0.09 + fi * 3.1)));
      pt = max(pt, smoothstep(0.78, 0.95, dot(no, b)));
    }
    float visU = smoothstep(aR, aR + 0.28, uD) * wl * pt;
    float visH = smoothstep(aR * 0.8, aR * 0.8 + 0.3, wZ * 1.4) * smoothstep(0.0, 0.3, nv.z)
               * mix(1.0, 0.45 + 0.55 * sin(uT * 2.5 + aL.y * 60.0), wZ);
    float vis = aR < 0.0 ? 1.0 : max(visU, visH);
    float len = min(aM * (1.0 + 0.5 * uD) * (1.0 + 0.8 * wZ), 0.85) * (aR < 0.0 ? 1.0 : mix(0.3, 1.0, vis));
    float x = fract(k * aL.x - aL.z * k * (uT + 2.0 * wZ * uTb) - aL.y);
    float comet = smoothstep(0.0, 0.7 * len, x) * (1.0 - smoothstep(0.82 * len, len, x));
    float front = mix(0.07 + 0.12 * uD, 1.0, smoothstep(-0.14, 0.22, nv.z));
    float rim = 0.8 + (0.4 + 0.3 * uD) * (1.0 - clamp(nv.z, 0.0, 1.0));
    vA = comet * front * rim * vis * (1.0 + 0.5 * uD) * (1.0 + 0.7 * wZ);
  }`;
const FRAG = `
  uniform vec3 uInk; varying float vA;
  void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uInk, min(vA, 1.0)); }`;

export function initHomeHeroPill(host) {
  if (!host) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const hero = host.closest('.hero') || host;
  const accent = new Color(getComputedStyle(host).getPropertyValue('--accent').trim());
  const rgb = { r: 0, g: 0, b: 0 };
  accent.getRGB(rgb, SRGBColorSpace);            // sRGB components for the raw ShaderMaterial output
  const ink = new Vector3(rgb.r, rgb.g, rgb.b);

  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.remove(); return null; }
  renderer.setClearColor(0x000000, 0);

  const camera = new OrthographicCamera(-1, 1, 1, -1, -20, 20);
  camera.position.set(0, 0, 10);
  const scene = new Scene();
  const group = new Group();
  scene.add(group);

  /* ---------- wavy comet lines: bundle A (resting set + extra lines), bundle B (crossing, appears while transforming) ---------- */
  const sA = [], cA = [], lA = [], mA = [], rA = [];
  const R = rng(7), R2 = rng(31);
  const addLine = (pt, h0, r0, k, len, phase, speed, rank) => {
    const A = 0.075 * Math.sqrt(r0 + 0.05);
    const psi = 2.0 * h0 + (rank < 0 ? 0 : 0.7);
    let prev = null;
    for (let j = 0; j <= SEGS; j++) {
      const s = j / SEGS, th = s * Math.PI * 2;
      const h = h0 + A * (Math.sin(3 * th + psi) + 0.3 * Math.sin(5 * th + 2.1 * psi + 1.0));
      const v = pt(th, h, r0);
      if (prev) {
        [[prev.v, prev.s], [v, s]].forEach(([d, ss]) => {
          const c = capPoint(d.x, d.y, d.z);
          sA.push(d.x, d.y, d.z); cA.push(c[0], c[1], c[2]);
          lA.push(ss, phase, speed, k); mA.push(len); rA.push(rank);
        });
      }
      prev = { v, s };
    }
  };
  const ptA = (th, h, r0) => new Vector3(Math.cos(th) * r0, h, Math.sin(th) * r0).normalize();
  for (let n = 0; n < NT; n++) {
    const h0 = -0.97 + (1.94 * n) / (NT - 1), r0 = Math.sqrt(1 - h0 * h0);
    if (n % 3 === 0) {
      const i = n / 3, k = (i % 3 === 2) ? 2 : 1;
      const len = k === 1 ? 0.16 + 0.17 * R() : 0.3 + 0.2 * R();
      const phase = R(), speed = 0.085 * (1 + 0.22 * (R() - 0.5));
      addLine(ptA, h0, r0, k, len, phase, speed, -1);
    } else {
      const k = R2() < 0.3 ? 2 : 1;
      const len = k === 1 ? 0.16 + 0.17 * R2() : 0.3 + 0.2 * R2();
      addLine(ptA, h0, r0, k, len, R2(), 0.085 * (1 + 0.22 * (R2() - 0.5)), 0.02 + 0.7 * R2());
    }
  }
  const bax = new Vector3(Math.sin(TILT), Math.cos(TILT), 0);
  const be1 = new Vector3(0, 0, 1), be2 = new Vector3().crossVectors(bax, be1);
  const ptB = (th, h, r0) => new Vector3().addScaledVector(be1, Math.cos(th) * r0).addScaledVector(be2, Math.sin(th) * r0).addScaledVector(bax, h).normalize();
  for (let n = 0; n < NB; n++) {
    const h0 = -0.97 + (1.94 * (n + 0.5)) / NB, r0 = Math.sqrt(1 - h0 * h0);
    const k = R2() < 0.3 ? 2 : 1;
    const len = k === 1 ? 0.18 + 0.2 * R2() : 0.32 + 0.2 * R2();
    addLine(ptB, h0, r0, k, len, R2(), 0.085 * (1 + 0.22 * (R2() - 0.5)), 0.08 + 0.64 * R2());
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(sA.length), 3));
  geo.setAttribute('aSA', new Float32BufferAttribute(sA, 3));
  geo.setAttribute('aCA', new Float32BufferAttribute(cA, 3));
  geo.setAttribute('aL', new Float32BufferAttribute(lA, 4));
  geo.setAttribute('aM', new Float32BufferAttribute(mA, 1));
  geo.setAttribute('aR', new Float32BufferAttribute(rA, 1));
  geo.boundingSphere = new Sphere(new Vector3(), 10);

  const fiberMat = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uM: { value: 0 }, uT: { value: 0 }, uD: { value: 0 }, uHov: { value: 0 }, uTb: { value: 0 }, uZR: { value: 0.54 }, uCur: { value: new Vector2(1e3, 1e3) }, uInk: { value: ink } },
    vertexShader: VERT, fragmentShader: FRAG,
  });
  const fibers = new LineSegments(geo, fiberMat);
  fibers.frustumCulled = false;
  group.add(fibers);

  /* ---------- silhouette outline (stadium; circle when m = 0) ---------- */
  const olPos = new Float32Array((ARC * 2 + 2) * 3);
  const olGeo = new BufferGeometry();
  const olAttr = new BufferAttribute(olPos, 3);
  olAttr.setUsage(DynamicDrawUsage);
  olGeo.setAttribute('position', olAttr);
  const olMat = new LineBasicMaterial({ color: accent, transparent: true, opacity: 1, depthTest: false });
  const outline = new LineLoop(olGeo, olMat);
  outline.frustumCulled = false;
  scene.add(outline);
  const updateOutline = (m, hx, hy) => {
    const r = 1 + (RC - 1) * m, hl = Math.hypot(hx, hy), phi = hl > 1e-5 ? Math.atan2(hy, hx) : 0;
    let k = 0;
    for (let i = 0; i <= ARC; i++) { const a = phi - Math.PI / 2 + (i / ARC) * Math.PI; olPos[k++] = hx + Math.cos(a) * r; olPos[k++] = hy + Math.sin(a) * r; olPos[k++] = 0; }
    for (let i = 0; i <= ARC; i++) { const a = phi + Math.PI / 2 + (i / ARC) * Math.PI; olPos[k++] = -hx + Math.cos(a) * r; olPos[k++] = -hy + Math.sin(a) * r; olPos[k++] = 0; }
    olAttr.needsUpdate = true;
  };

  /* ---------- size ---------- */
  let W = 0, Hh = 0;
  const resize = () => {
    W = host.clientWidth; Hh = host.clientHeight;
    if (!W || !Hh) return false;
    renderer.setPixelRatio(capDpr(MAX_DPR));
    renderer.setSize(W, Hh, false);
    const aspect = W / Hh, halfH = (VIEW_H / 2) * Math.max(1, 1 / aspect);   // narrow container: grow the view so the silhouette stays inside
    camera.left = -halfH * aspect; camera.right = halfH * aspect; camera.top = halfH; camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    return true;
  };

  /* ---------- pointer (relative to the scene container) ---------- */
  const mouse = { x: 0, y: 0, sx: 0, sy: 0, wx: 1e3, wy: 1e3 };
  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    mouse.wx = mouse.x * camera.right; mouse.wy = -mouse.y * camera.top;
  };
  const onLeave = () => { mouse.x = mouse.y = 0; mouse.wx = mouse.wy = 1e3; };
  hero.addEventListener('pointermove', onMove);
  hero.addEventListener('pointerleave', onLeave);

  /* ---------- frame ---------- */
  const clock = new Clock();
  const axis = new Vector3();
  let hov = 0, tb = 0, fixedT = null, lost = false;
  const cur = { x: 1e3, y: 1e3 };
  const draw = (animated) => {
    if (lost || !W) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    const T = animated && fixedT === null ? clock.elapsedTime : (fixedT !== null ? fixedT : STATIC_T);
    const m = morphAt(T);
    if (animated) { mouse.sx += (mouse.x - mouse.sx) * 0.04; mouse.sy += (mouse.y - mouse.sy) * 0.04; } else { mouse.sx = mouse.sy = 0; }
    group.rotation.set(0.36 + Math.sin(T * 0.52) * 0.1 + mouse.sy * 0.12, 0.55 * Math.sin(T * 0.39) + mouse.sx * 0.15, 0.32 + 0.18 * Math.sin(T * 0.33 + 1.0), 'YXZ');
    group.updateMatrixWorld(true);
    axis.set(1, 0, 0).applyQuaternion(group.quaternion);
    const hx = axis.x * H * m, hy = axis.y * H * m, hl = Math.hypot(hx, hy), r = 1 + (RC - 1) * m;
    const ax = hl > 1e-5 ? hx / hl : 1, ay = hl > 1e-5 ? hy / hl : 0;
    let over = false;
    if (animated) {
      const tt = Math.max(-hl, Math.min(hl, mouse.wx * ax + mouse.wy * ay));
      over = Math.hypot(mouse.wx - tt * ax, mouse.wy - tt * ay) <= r;
    }
    hov += ((over ? 1 : 0) - hov) * (1 - Math.exp(-dt / 0.13));
    if (!animated) hov = 0;
    if (over) { const kk = 1 - Math.exp(-dt / 0.12); cur.x = cur.x > 900 ? mouse.wx : cur.x + (mouse.wx - cur.x) * kk; cur.y = cur.y > 900 ? mouse.wy : cur.y + (mouse.wy - cur.y) * kk; }
    tb += dt * hov;
    const u = fiberMat.uniforms;
    u.uM.value = m; u.uT.value = T; u.uD.value = densityAt(T); u.uHov.value = hov; u.uTb.value = tb;
    u.uZR.value = 0.27 * (2 * r + hl); u.uCur.value.set(cur.x, cur.y);
    updateOutline(m, hx, hy);
    renderer.render(scene, camera);
    canvas.classList.add('is-ready');
  };

  let raf = 0, onScreen = false;
  const loop = () => { raf = requestAnimationFrame(loop); draw(true); };
  const sync = () => {
    const run = onScreen && !document.hidden && !reducedMq.matches;
    if (run && !raf) { clock.getDelta(); raf = requestAnimationFrame(loop); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run && onScreen && W) draw(false);
  };
  const ro = new ResizeObserver(() => { if (resize()) { if (!raf) draw(false); } });
  ro.observe(host);
  const io = new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; sync(); });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (e) => { e.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  canvas.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reducedMq.removeEventListener('change', sync);
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    geo.dispose(); fiberMat.dispose(); olGeo.dispose(); olMat.dispose();
    renderer.dispose();
    canvas.remove();
  };

  resize();
  // debug hook (checks only): freeze the timeline at t seconds (null = live clock)
  host.__pill = { setT(t) { fixedT = t; if (!raf) draw(false); }, get running() { return !!raf; }, ink: ink.toArray(), accent: accent.getHexString() };
  return { destroy };
}
