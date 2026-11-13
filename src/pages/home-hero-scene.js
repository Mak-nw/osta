// Home hero scene: white particles + rays <-> pill (three.js). Two stages, loop 20 s: (1) a sphere of points joined to the centre by thin rays -> (2) morph into a UNIFORM capsule (pill) that rolls around its own long axis and slowly precesses -> back to the sphere.
// The rays (thin lines, 1 device px, from the centre to the nodes) are always on in the sphere and fade out in the pill (there the frame is meridians + rings).
// The pill: dots spread evenly over the WHOLE capsule surface (cylinder + two hemispheres; grazing dots at the silhouette are brighter = a clear outline), 10 meridians end to end and 9 + 4 rings (equal steps along the cylinder, two on every cap). No halves, no seam: both ends have the same density and brightness.
// Rotation: the WHOLE capsule (dots + lines are rigid with the body) makes one full 360 deg turn about the vertical axis during the pill stage (t 6.5-16, ease-in-out, 9.5 s); a full turn = identity, so frame 20 == frame 0. The turn only shrinks the screen extent, so fit() stays valid. The sphere turns very slowly about the long axis (40 s/turn). Particle drift is barely visible (0.5% of the unit, 20 s period).
// Dots are pure white (token --text-on-accent), alpha up to 1.0 (back dots 0.6-0.75), lines white alpha <= 0.5 (quieter than the dots). Flat, hard-edged dots (no halos, no gradient sprites, no fills); the canvas is transparent: the blue of the hero (--surface-accent) shows through. No cursor reaction, no hover, no parallax.
// Time -> state is a pure function of (t mod 20); the shell/nodes/dust are built in pairs that are 180 deg images of each other around the long axis and the slow spin is pi per loop, so frame 20 == frame 0.
// The scene is centred on the page (x = centre of the hero) and on the H1 block (y) over the whole hero (>=1200) / centred in the area above the text (<=1199); fit() only shrinks its unit so it touches no title line, search or chips.
// Renders only while the hero is on screen and the tab is visible; prefers-reduced-motion = one static frame (t = 13.5, the pill turned ~26 deg towards the viewer). DPR <= 2 (<= 1.5 on tablet/mobile). No WebGL -> returns null.
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, BufferGeometry, BufferAttribute, ShaderMaterial, Points, LineSegments, Vector3, Color, SRGBColorSpace,
} from 'three';
import { capDpr } from '../utils/dpr.js';
import { tokenToRgb } from '../utils/css-color.js';

const LOOP = 20, STATIC_T = 13.5, MAX_DPR = 2;
const RC = 0.58, H = 0.82;            // capsule (sphere radius = 1 unit), long axis = x; same mapping as scenes/fiber-pill.html
const TILT = 0.42;                    // fixed tilt of the group (rad)
const SPIN = Math.PI / LOOP;          // rad/s around the long axis: pi per loop (40 s per turn)
const SPH = 0.82;                     // sphere radius vs the pill (pill half-length 1.4): the sphere phase is smaller, so the longer pill can be the biggest thing in the free zone
const R_SPHERE = 1.3 * SPH, R_PILL = RC * 1.18, AX_PILL = H * 1.18; // fit shapes (units): sphere radius incl. nodes; capsule radius + half axis (nodes sit up to 1.17x outside the capsule surface)
const MAX_UNIT = 280, MIN_UNIT = 40;
const A_CAP = RC / (2 * (RC + H));    // cap share of the sphere-map parameter t (t in 0..1 along the long axis; area-uniform: sphere dx = 2t - 1)
const pillAt = (t) => { t = ((t % LOOP) + LOOP) % LOOP; return t < 5 ? 0 : t < 8 ? (t - 5) / 3 : t < 15 ? 1 : t < 18 ? 1 - (t - 15) / 3 : 0; };
const smooth = (p) => p * p * (3 - 2 * p);
const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const TURN_A = 6.5, TURN_B = 16;   // one full 360 deg turn of the whole body about the vertical axis (ease-in-out, 9.5 s); a whole turn = identity, so frame 20 == frame 0

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function capPoint(dx, dy, dz) {       // sphere direction -> capsule surface point (long axis = x)
  const a = RC / (2 * (RC + H)), t = dx * 0.5 + 0.5; let x, rho;
  if (t < a) { const q = RC * (1 - t / a); x = -H - q; rho = Math.sqrt(Math.max(0, RC * RC - q * q)); }
  else if (t > 1 - a) { const q = RC * ((t - (1 - a)) / a); x = H + q; rho = Math.sqrt(Math.max(0, RC * RC - q * q)); }
  else { x = -H + (t - a) / (1 - 2 * a) * 2 * H; rho = RC; }
  const l = Math.hypot(dy, dz); let uy = 1, uz = 0; if (l > 1e-6) { uy = dy / l; uz = dz / l; }
  return [x, rho * uy, rho * uz];
}

const COMMON = `
uniform float uT, uPill, uSpin;
float e3(float x){ x = clamp(x, 0.0, 1.0); return x < 0.5 ? 4.0*x*x*x : 1.0 - pow(-2.0*x + 2.0, 3.0) / 2.0; }
float sc(float m){ return mix(0.97, 0.94, m); }   // overall size: sphere -3%, pill -6%
vec3 spinX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }`;
// kind (aR.x): 0 shell, 1 node (ray tip), 2 dust. aG: +1 / -1 = side of the 180-degree pair (mirrors the drift so frame 20 == frame 0).
// In the pill shell points and ray tips are spread evenly over the capsule surface; rim = grazing dots (silhouette) are brighter and a bit bigger.
const POINT_VERT = COMMON + `
const float K_SZ = 1.15;
attribute vec3 aC; attribute vec4 aR; attribute float aG; uniform float uPx; varying float vA; varying float vS;
void main(){
  float kind = aR.x; bool dust = kind > 1.5;
  float m = dust ? 0.0 : e3(uPill * 1.35 - aR.y * 0.35);
  vec3 p = mix(position, aC, m);
  vec3 dr = 0.005 * vec3(sin(0.314 * uT + aR.w * 40.0), sin(0.314 * uT + aR.z * 30.0), sin(0.314 * uT + aR.y * 20.0)) * (dust ? 2.0 : 1.0);   // barely visible drift: 0.5% of the unit, 20 s period
  p += vec3(dr.x, dr.y * aG, dr.z * aG);
  float ang = dust ? -uSpin : uSpin;
  p = spinX(p, ang) * sc(m);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float front = clamp((mv.z + 10.0) * 0.5 + 0.5, 0.0, 1.0);
  vec3 n = normalize(aC - vec3(clamp(aC.x, -0.82, 0.82), 0.0, 0.0) + vec3(1e-5));
  float nz = abs(normalize((modelViewMatrix * vec4(spinX(n, ang), 0.0)).xyz).z);
  float rim = (1.0 - smoothstep(0.1, 0.5, nz)) * m;
  float sz, a;
  if (kind < 1.5) {
    float body = 1.3 + 1.4 * aR.z * aR.z;
    float szS = kind < 0.5 ? 1.2 * body : 1.2 * (2.6 + 3.0 * aR.z);
    sz = mix(szS, 1.2 * body * K_SZ, m) * (1.0 + 0.25 * rim);
    float aS = kind < 0.5 ? mix(0.35, 0.9, front) * mix(0.8, 1.0, aR.w) : 0.9;
    float aP = max(mix(0.6, 1.0, front), rim);
    a = mix(aS, aP, m);
  } else { sz = 1.2 * (1.2 + aR.z); a = 0.3 + 0.2 * aR.z; }
  a = clamp(a, 0.0, 1.0); gl_PointSize = sz * uPx; vS = sz * uPx;
  vA = a;
}`;
const LINE_VERT = COMMON + `
attribute vec3 aC; attribute vec2 aE; attribute vec3 aF; attribute vec3 aFC; varying float vA;
void main(){
  float m = e3(uPill * 1.35 - aE.y * 0.35);
  vec3 foot = mix(aF, aFC, m), tip = mix(position, aC, m);
  vec3 p = aE.x < 0.5 ? foot : tip;
  vec4 mv = modelViewMatrix * vec4(spinX(p, uSpin) * sc(m), 1.0);
  gl_Position = projectionMatrix * mv;
  float front = clamp((mv.z + 10.0) * 0.5 + 0.5, 0.0, 1.0);
  vA = mix(0.2, 0.5, front) * mix(0.3, 1.0, aE.x) * (1.0 - smoothstep(0.35, 0.95, m));   // quieter at the hub where many rays overlap; rays hand over to the meridians late in the morph
}`;
// meridians / rings (lines): visible only in the pill; aE = line alpha
const RING_VERT = COMMON + `
attribute vec3 aC; attribute float aE; varying float vA;
void main(){
  float m = e3(uPill * 1.35 - 0.175);
  vec4 mv = modelViewMatrix * vec4(spinX(mix(position, aC, m), uSpin) * sc(m), 1.0);
  gl_Position = projectionMatrix * mv;
  float front = clamp((mv.z + 10.0) * 0.5 + 0.5, 0.0, 1.0);
  vA = aE * smoothstep(0.0, 0.3, m) * mix(0.75, 1.0, front);   // frame lines appear early, before the rays are gone
}`;
// flat disc: hard edge (discard beyond the radius) + a 1 device px antialiased rim; constant colour, no halo
const POINT_FRAG = `uniform vec3 uInk; varying float vA; varying float vS;
void main(){ vec2 d = gl_PointCoord - 0.5; float l = length(d); if (l > 0.5) discard; gl_FragColor = vec4(uInk, vA * clamp((0.5 - l) * vS, 0.0, 1.0)); }`;
const LINE_FRAG = 'uniform vec3 uInk; varying float vA; void main(){ gl_FragColor = vec4(uInk, vA); }';

// distance from point to axis-aligned rect {l,t,r,b} (0 inside)
const dRect = (x, y, q) => Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y, 0, y - q.b));

export function initHomeHeroScene(host) {
  if (!host) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const [ir, ig, ib] = tokenToRgb('--text-on-accent', [255, 255, 255]);
  const ink = new Color(`rgb(${ir}, ${ig}, ${ib})`);
  const rgb = { r: 1, g: 1, b: 1 };
  ink.getRGB(rgb, SRGBColorSpace);                    // raw ShaderMaterial output: sRGB components as uniform
  const inkV = new Vector3(rgb.r, rgb.g, rgb.b);

  const lite = matchMedia('(max-width: 767px)').matches ? 2 : matchMedia('(max-width: 1199px)').matches ? 1 : 0;
  const [N_SHELL, N_RAYS, N_DUST] = [[4200, 170, 200], [2400, 120, 120], [1500, 90, 80]][lite];
  const N_SEAM = 0;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.remove(); return null; }
  renderer.setClearColor(0x000000, 0);

  /* ---------- geometry: shell + nodes + dust (each particle has a 180-degree twin around x) ---------- */
  const R = rng(7);
  const NP = N_SHELL + N_RAYS + N_DUST + N_SEAM;
  const aS = new Float32Array(NP * 3), aC = new Float32Array(NP * 3), aR = new Float32Array(NP * 4), aG = new Float32Array(NP);
  const rays = [];
  const dir = () => { let u = R() * 2 - 1; u = Math.sign(u) * Math.pow(Math.abs(u), 0.8); const th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u); return [u, s * Math.cos(th), s * Math.sin(th)]; };
  for (let k = 0; k < NP; k += 2) {
    const dust = k >= N_SHELL + N_RAYS, node = !dust && k >= N_SHELL;
    let d = dir(); const rr = [R(), R(), R()];
    const r = dust ? 1.25 + R() * 1.1 : node ? 1.0 + R() * 0.28 : 0.96 + R() * 0.08;
    const c = dust ? d : capPoint(d[0], d[1], d[2]);   // pill: the sphere map is area-uniform, so shell points and ray tips spread evenly over the whole capsule (the sphere positions aS are untouched)
    const rc = dust ? r : node ? 1.0 : r;
    for (let s = 0; s < 2; s++) {
      const i = k + s, sg = s ? -1 : 1;
      aS.set(dust ? [d[0] * r, d[1] * r * sg, d[2] * r * sg] : [d[0] * r * SPH, d[1] * r * SPH * sg, d[2] * r * SPH * sg], i * 3);
      aC.set([c[0] * rc, c[1] * rc * sg, c[2] * rc * sg], i * 3);
      aR.set([dust ? 2 : node ? 1 : 0, rr[0], rr[1], rr[2]], i * 4);
      aG[i] = sg;
      if (node) rays.push([i, rr[0]]);
    }
  }
  const pg = new BufferGeometry();
  pg.setAttribute('position', new BufferAttribute(aS, 3)); pg.setAttribute('aC', new BufferAttribute(aC, 3));
  pg.setAttribute('aR', new BufferAttribute(aR, 4)); pg.setAttribute('aG', new BufferAttribute(aG, 1));
  const L = rays.length * 2;
  const lS = new Float32Array(L * 3), lC = new Float32Array(L * 3), lE = new Float32Array(L * 2), fS = new Float32Array(L * 3), fC = new Float32Array(L * 3);
  rays.forEach(([k, rnd], i) => {
    const o = i * 2, cx = Math.max(-H, Math.min(H, aC[k * 3]));
    lS.set([0, 0, 0], o * 3); lC.set([cx * 0.85, 0, 0], o * 3); lE.set([0, rnd], o * 2);
    lS.set(aS.subarray(k * 3, k * 3 + 3), (o + 1) * 3); lC.set(aC.subarray(k * 3, k * 3 + 3), (o + 1) * 3); lE.set([1, rnd], (o + 1) * 2);
    fS.set([0, 0, 0], o * 3); fS.set([0, 0, 0], (o + 1) * 3); fC.set([cx * 0.85, 0, 0], o * 3); fC.set([cx * 0.85, 0, 0], (o + 1) * 3);
  });
  const lg = new BufferGeometry();
  lg.setAttribute('position', new BufferAttribute(lS, 3)); lg.setAttribute('aC', new BufferAttribute(lC, 3)); lg.setAttribute('aE', new BufferAttribute(lE, 2));
  lg.setAttribute('aF', new BufferAttribute(fS, 3)); lg.setAttribute('aFC', new BufferAttribute(fC, 3));

  const SEG = 96, rp = [], rcp = [], re = [];
  const ringAt = (t, al) => {   // transverse ring at the capsule parameter t (0..1 along the long axis)
    const dx = 2 * t - 1, q = Math.sqrt(Math.max(0, 1 - dx * dx));
    const pt = (j) => { const th = (j % SEG) / SEG * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th); return [[dx * SPH, q * c * SPH, q * sn * SPH], capPoint(dx, c, sn)]; };
    for (let i = 0; i < SEG; i++) { const a = pt(i), b = pt(i + 1); rp.push(...a[0], ...b[0]); rcp.push(...a[1], ...b[1]); re.push(al, al); }
  };
  const CYL = 8;   // 9 rings on the cylinder (incl. both joints), equal steps; + 2 on every hemisphere
  for (let k = 0; k <= CYL; k++) ringAt(A_CAP + (1 - 2 * A_CAP) * k / CYL, 0.5);
  [0.4, 0.75].forEach((f) => { ringAt(A_CAP * f, 0.45); ringAt(1 - A_CAP * f, 0.45); });
  const MER = 10, MSEG = 96;   // 10 meridians end to end (cap - cylinder - cap)
  for (let k = 0; k < MER; k++) {
    const th = k / MER * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
    const pt = (i) => { const dx = -Math.cos(Math.PI * i / MSEG), q = Math.sqrt(Math.max(0, 1 - dx * dx)); return [[dx * SPH, q * c * SPH, q * sn * SPH], capPoint(dx, c, sn)]; };
    for (let i = 0; i < MSEG; i++) { const a = pt(i), b = pt(i + 1); rp.push(...a[0], ...b[0]); rcp.push(...a[1], ...b[1]); re.push(0.55, 0.55); }
  }
  const rg = new BufferGeometry();
  rg.setAttribute('position', new BufferAttribute(new Float32Array(rp), 3)); rg.setAttribute('aC', new BufferAttribute(new Float32Array(rcp), 3)); rg.setAttribute('aE', new BufferAttribute(new Float32Array(re), 1));

  const U = { uT: { value: 0 }, uPill: { value: 0 }, uSpin: { value: 0 }, uPx: { value: 1 }, uInk: { value: inkV } };
  const base = { transparent: true, depthWrite: false, depthTest: false, uniforms: U };
  const pm = new ShaderMaterial({ ...base, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG });
  const lm = new ShaderMaterial({ ...base, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG });
  const rm = new ShaderMaterial({ ...base, vertexShader: RING_VERT, fragmentShader: LINE_FRAG });
  const lines = new LineSegments(lg, lm), pts = new Points(pg, pm), ringLines = new LineSegments(rg, rm);
  lines.frustumCulled = false; pts.frustumCulled = false; ringLines.frustumCulled = false;
  const grp = new Group(); grp.add(lines); grp.add(ringLines); grp.add(pts); grp.rotation.z = TILT;
  const scene = new Scene(); scene.add(grp);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 30); camera.position.set(0, 0, 10);

  /* ---------- fit: the scene sits at a FIXED centre (x = host centre = page centre; y = centre of the H1 block on desktop, host centre in the stacked layout) and only its unit is searched: the biggest unit (sphere circle + tilted capsule) that touches no content rect (binary search: the check is monotonic in u) ---------- */
  let W = 0, Hh = 0, started = false;
  const fit = () => {
    const hr = host.getBoundingClientRect();
    const rel = (r, m) => ({ l: r.left - hr.left - m, t: r.top - hr.top - m, r: r.right - hr.left + m, b: r.bottom - hr.top + m });
    const blocks = [];
    const hero = host.closest('.hero') || host.parentElement;
    const panel = hero.ownerDocument.querySelector('.header__panel');
    if (panel) blocks.push(rel(panel.getBoundingClientRect(), 12));
    let title = null;                                  // union of the H1 text lines (both phrases): the vertical axis of the composition
    const h1 = hero.querySelector('.hero__title');
    if (h1) {
      const parts = [...h1.querySelectorAll('.hero__title-part')];
      (parts.length ? parts : [h1]).forEach((part) => {   // each phrase separately: left and right phrases never merge into one block across the centre
        const g = document.createRange(); g.selectNodeContents(part);
        const lns = [];
        [...g.getClientRects()].filter((r) => r.width > 1 && r.height > 1).forEach((r) => {
          const ln = lns.find((l) => Math.abs(l.top - r.top) < r.height * 0.5);
          if (ln) { ln.left = Math.min(ln.left, r.left); ln.right = Math.max(ln.right, r.right); ln.bottom = Math.max(ln.bottom, r.bottom); } else lns.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        });
        lns.forEach((l) => blocks.push(rel(l, 12)));
        const pr = part.getBoundingClientRect();     // the box of the phrase (not the word glyphs: they move during the reveal animation) gives the axis
        title = title ? { top: Math.min(title.top, pr.top), bottom: Math.max(title.bottom, pr.bottom) } : { top: pr.top, bottom: pr.bottom };
      });
    }
    const search = hero.querySelector('.hero-search');
    if (search) blocks.push(rel(search.getBoundingClientRect(), 32));
    const cats = hero.querySelector('.hero-cats');     // the row container is wider than its chips: use the chips' union
    if (cats) { const rs = [...cats.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 1); if (rs.length) blocks.push(rel({ left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) }, 32)); }
    const ca = Math.cos(TILT), sa = Math.sin(TILT);
    const overlay = getComputedStyle(host).position === 'absolute';   // desktop: scene over the whole hero, centred on the H1 block; stacked layout: centred in its own box
    const x = W / 2, y = overlay && title ? (title.top + title.bottom) / 2 - hr.top : Hh / 2;
    const ok = (u) => {
      const rs = R_SPHERE * u, rp = R_PILL * u, ax = AX_PILL * u;
      const ex = Math.max(rs, ax * ca + rp), ey = Math.max(rs, ax * sa + rp);
      if (x - ex < 8 || x + ex > W - 8 || y - ey < 8 || y + ey > Hh - 8) return false;
      for (const q of blocks) {
        if (dRect(x, y, q) < rs) return false;
        for (let i = -4; i <= 4; i++) if (dRect(x + ax * ca * i / 4, y - ax * sa * i / 4, q) < rp) return false;
      }
      return true;
    };
    let u = MAX_UNIT;
    if (!ok(u)) { let lo = MIN_UNIT, hi = MAX_UNIT; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; } u = lo; }
    camera.left = -x / u; camera.right = (W - x) / u; camera.top = y / u; camera.bottom = -(Hh - y) / u;
    camera.updateProjectionMatrix();
    host.__heroScene && (host.__heroScene.fit = { unit: u, cx: Math.round(x + hr.left), cy: Math.round(y + hr.top) });
  };
  const resize = () => {
    W = host.clientWidth; Hh = host.clientHeight;
    if (!W || !Hh) return false;
    const dpr = capDpr(MAX_DPR);
    renderer.setPixelRatio(dpr); U.uPx.value = dpr;
    renderer.setSize(W, Hh, false);
    fit();
    return true;
  };

  /* ---------- timeline: sphere + rays 0-5 | to pill 5-8 | pill 8-15 (static frame t = 13.5) | back to sphere 15-18 | sphere 18-20 ---------- */
  const state = (t) => { t = ((t % LOOP) + LOOP) % LOOP; return { t, pill: pillAt(t) }; };
  let lost = false, fixedT = null, raf = 0, onScreen = false, t0 = 0, elapsed = 0;
  const draw = (T, still) => {
    if (lost || !W) return;
    const s = state(T);
    U.uT.value = s.t; U.uPill.value = s.pill;
    U.uSpin.value = SPIN * (((T % (2 * LOOP)) + 2 * LOOP) % (2 * LOOP));
    if (still) grp.rotation.set(0.12, 0.46, TILT);                                  // reduced motion: the pill turned ~26 deg towards the viewer
    else grp.rotation.set(0, 2 * Math.PI * easeIO((s.t - TURN_A) / (TURN_B - TURN_A)), TILT);   // rigid body: dots and lines turn together with the capsule
    renderer.render(scene, camera);
    canvas.classList.add('is-ready');
  };
  const frame = () => { raf = requestAnimationFrame(frame); draw(elapsed + (performance.now() - t0) / 1000, reducedMq.matches); };
  const sync = () => {
    const run = onScreen && !document.hidden && !reducedMq.matches && !lost && fixedT === null;
    if (run && !raf) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; elapsed += (performance.now() - t0) / 1000; }
    if (!run && onScreen && W) draw(fixedT !== null ? fixedT : reducedMq.matches ? STATIC_T : elapsed, fixedT === null && reducedMq.matches);
  };
  let refitRaf = 0;
  const refit = () => { cancelAnimationFrame(refitRaf); refitRaf = requestAnimationFrame(() => { if (resize() && !raf) sync(); }); };
  const ro = new ResizeObserver(() => { if (resize()) { started = true; sync(); if (!onScreen) draw(reducedMq.matches ? STATIC_T : elapsed, reducedMq.matches); } });
  ro.observe(host);
  const io = new IntersectionObserver((en) => { onScreen = en[en.length - 1].isIntersecting; sync(); });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (ev) => { ev.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  canvas.addEventListener('webglcontextlost', onLost);
  // layout shifts that change the free zone: fonts, language switch (title text), reveal animation of the title / search bar
  document.fonts && document.fonts.ready.then(refit);
  const h1El = (host.closest('.hero') || document).querySelector('.hero__title');
  const mo = h1El ? new MutationObserver(refit) : null;
  mo && mo.observe(h1El, { childList: true, subtree: true });
  const lateTimer = setTimeout(refit, 1600);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    cancelAnimationFrame(refitRaf); clearTimeout(lateTimer);
    raf = 0; lost = true;
    ro.disconnect(); io.disconnect(); mo && mo.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reducedMq.removeEventListener('change', sync);
    canvas.removeEventListener('webglcontextlost', onLost);
    pg.dispose(); lg.dispose(); rg.dispose(); pm.dispose(); lm.dispose(); rm.dispose();
    renderer.dispose();
    canvas.remove();
  };

  // debug hook (checks only): freeze the timeline at t seconds (null = live clock)
  host.__heroScene = {
    setT(t) { fixedT = t; if (t === null) sync(); else { if (raf) { cancelAnimationFrame(raf); raf = 0; } draw(t); } },
    get running() { return !!raf; },
    started: () => started, fit: null, counts: { shell: N_SHELL, rays: N_RAYS, dust: N_DUST },
  };
  resize();
  return { destroy };
}
