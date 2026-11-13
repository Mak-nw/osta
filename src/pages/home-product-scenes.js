// Home Products cards: three looping three.js scenes (API molecule, Excipients cubes, Food Grade sprout) in the hero language: DOTS + THIN LINES (1 device px) over flat fills.
// Main objects (centre sphere, white cube pieces, leaves) = flat white fill (--il-fill) with thin --il-bg (card blue) edges; secondary objects (outer nodes, other cube pieces, grains, soil, stem, bonds) = NO fill, thin white outline (--il-soft at 70%, an opaque pre-mixed colour so coinciding lines never get brighter);
// they use a depth-only occluder (no colour) so lines behind them stay hidden. White round dots sit at the vertices / on the contours. Fills are pushed back / shrunk a hair so edges never z-fight with them.
// Every node also has a screen-facing silhouette ring drawn without depth test, so each ball always has a visible outer contour.
// ONE shared WebGLRenderer (offscreen canvas) renders each visible card and copies the frame into that card's 2D canvas, so Home keeps a single extra WebGL context.
// Seamless loop: every motion is a function of phase = 2*PI*t/PERIOD with integer harmonics only, so the state at t = PERIOD equals t = 0 (no start, no end).
// Renders only cards on screen and while the tab is visible; prefers-reduced-motion = one static frame; DPR <= 2; destroy() frees everything. No WebGL -> returns null.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, BufferGeometry, Float32BufferAttribute, BufferAttribute, LineBasicMaterial, LineSegments, LineLoop, Points, ShaderMaterial,
  BoxGeometry, EdgesGeometry, SphereGeometry, Mesh, MeshBasicMaterial, DoubleSide, Vector3, Quaternion,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const PERIOD = 24, MAX_DPR = 2, STATIC_PHASE = 0.9, TAU = Math.PI * 2;
const SHRINK = 0.965;       // fill meshes are a hair smaller than the outline so edges stay in front
const DOT_PX = 3;          // dot diameter in CSS px (scaled by DPR)
const LINE_ALPHA = 0.7;    // line opacity over the card background (lines are 1 device px: native GL lines)
const FILL = 0.68;         // scene diameter as a share of the art-zone's smaller side
const TAN = Math.tan((30 / 2) * Math.PI / 180);

const geoOf = (pts) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3)); return g; };
const circle = (r, n = 48) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [Math.cos(a) * r, Math.sin(a) * r, 0]; });
// polyline -> flat segment pairs (closed = also join last to first)
const pairs = (pts, closed = false) => { const out = []; const n = pts.length; for (let i = 0; i < n - 1; i++) out.push(...pts[i], ...pts[i + 1]); if (closed) out.push(...pts[n - 1], ...pts[0]); return out; };
const segGeo = (flat) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(flat, 3)); return g; };

export function initHomeProductScenes(hosts) {
  hosts = [...hosts].filter(Boolean);
  if (!hosts.length) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  // all colours come from CSS: local illustration tokens on .link-card__art (link-list.css)
  const probe = document.createElement('span'); probe.style.display = 'none'; hosts[0].appendChild(probe);
  const tok = (name) => { probe.style.backgroundColor = `var(${name})`; return new Color(getComputedStyle(probe).backgroundColor); };
  const cDot = tok('--il-fill'), cLine = tok('--il-soft'), cBg = tok('--il-bg'); probe.remove();
  cLine.set(cBg.clone().lerp(cLine, LINE_ALPHA));

  const gl = document.createElement('canvas');
  let renderer;
  try { renderer = new WebGLRenderer({ canvas: gl, antialias: true, alpha: true }); } catch { return null; }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  const lineMat = new LineBasicMaterial({ color: cLine });                       // white outline (70% pre-mixed), depth-tested
  const inkMat = new LineBasicMaterial({ color: cBg });                         // card-blue thin edges on white fills
  const silMat = new LineBasicMaterial({ color: cLine, depthTest: false, depthWrite: false });   // silhouette rings: always visible
  const fillWhite = new MeshBasicMaterial({ color: cDot, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const occluder = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const dotMat = new ShaderMaterial({
    uniforms: { uSize: { value: DOT_PX }, uColor: { value: cDot } }, transparent: true, depthWrite: false,
    vertexShader: 'uniform float uSize; void main(){ gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor, 1.0 - smoothstep(0.38, 0.5, d)); }',
  });
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const lineSeg = (flat, m = lineMat) => { const o = new LineSegments(track(segGeo(flat)), m); o.renderOrder = 1; o.frustumCulled = false; return o; };
  const loopOf = (geo, m = lineMat) => { const o = new LineLoop(geo, m); o.renderOrder = 1; o.frustumCulled = false; return o; };
  const dots = (pts) => { const o = new Points(track(geoOf(pts)), dotMat); o.renderOrder = 3; o.frustumCulled = false; return o; };
  const dotsGeo = (geo) => { const o = new Points(geo, dotMat); o.renderOrder = 3; o.frustumCulled = false; return o; };

  // small point-sphere: screen-facing silhouette ring (always visible outer contour) + 3 great circles + 6 axis dots + centre dot
  let ringGeo, ballDotGeo, sphereGeo;
  const billboards = [];
  // filled = white flat sphere with card-blue great circles; otherwise outline-only (white great circles over a depth-only occluder)
  const ball = (filled) => {
    ringGeo ||= track(geoOf(circle(1, 32)));
    sphereGeo ||= track(new SphereGeometry(1, 24, 16));
    ballDotGeo ||= track(geoOf([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, 0, 0]]));
    const g = new Group();
    const body = new Mesh(sphereGeo, filled ? fillWhite : occluder); body.scale.setScalar(SHRINK); g.add(body);
    const sil = loopOf(ringGeo, silMat); sil.renderOrder = 2; g.add(sil); billboards.push({ obj: sil, parent: g });
    const m = filled ? inkMat : lineMat;
    const a = loopOf(ringGeo, m), b = loopOf(ringGeo, m); a.rotation.x = Math.PI / 2; b.rotation.y = Math.PI / 2;
    g.add(a, b, dotsGeo(ballDotGeo));
    return g;
  };
  const Q = new Quaternion();
  const faceCamera = () => billboards.forEach(({ obj, parent }) => { parent.getWorldQuaternion(Q).invert(); obj.quaternion.copy(Q); });

  /* ---------- scenes: each returns { root, R (scene radius), update(phase) } ---------- */
  const molecule = () => {
    const root = new Group(); const spin = new Group(); root.add(spin);
    const nodes = [[0, 0, 0, 0.42], [1.25, 0.7, 0.2, 0.3], [-1.15, 0.9, 0.5, 0.32], [0.3, -1.25, 0.8, 0.28], [-0.7, -0.85, -0.95, 0.32], [0.95, 0.1, -1.15, 0.26], [-0.2, 1.4, -0.85, 0.24]];
    const bonds = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [2, 6], [1, 5], [3, 4]];
    const sp = [];
    // vertical float per node: [amplitude, integer harmonic, phase]; centre node moves least
    const fl = [[0.08, 1, 0], [0.26, 2, 0.6], [0.24, 3, 2.1], [0.27, 2, 3.7], [0.22, 3, 5.2], [0.25, 1, 1.3], [0.23, 2, 4.4]];
    nodes.forEach((n, i) => { const s = ball(i === 0); s.position.set(n[0], n[1], n[2]); spin.add(s); sp.push(s); });
    // bonds: one dynamic segment buffer, endpoints on the node surfaces, updated every frame
    const bg = track(new BufferGeometry()); const bpos = new Float32BufferAttribute(new Float32Array(bonds.length * 6), 3); bg.setAttribute('position', bpos);
    const bl = new LineSegments(bg, lineMat); bl.renderOrder = 1; bl.frustumCulled = false; spin.add(bl);
    const A = new Vector3(), Bv = new Vector3(), D = new Vector3();
    root.rotation.x = 0.35;
    return { root, R: 1.95, update: (p) => {
      spin.rotation.y = p;
      sp.forEach((s, i) => { s.scale.setScalar(nodes[i][3] * (1 + 0.12 * Math.sin(2 * p + i * 1.1))); s.position.y = nodes[i][1] + fl[i][0] * Math.sin(fl[i][1] * p + fl[i][2]); });
      bonds.forEach(([i, j], k) => {
        A.copy(sp[i].position); Bv.copy(sp[j].position); D.subVectors(Bv, A).normalize();
        const ra = sp[i].scale.x, rb = sp[j].scale.x;
        bpos.setXYZ(k * 2, A.x + D.x * ra, A.y + D.y * ra, A.z + D.z * ra); bpos.setXYZ(k * 2 + 1, Bv.x - D.x * rb, Bv.y - D.y * rb, Bv.z - D.z * rb);
      });
      bpos.needsUpdate = true;
    } };
  };

  // Excipients: a levitating 3x3x3 cube built of 27 equal small cubes drawn as wireframes with a dot at each corner. Pieces only translate (never scale) into 3 point-symmetric forms and back.
  // Piece at lattice cell g in {-1,0,1}^3 sits at g * CUBE * f(class); class = |g|_1 (0 centre, 1 face, 2 edge, 3 corner). All factors f >= 1 => pieces never intersect.
  // Lines have no depth test and a pre-mixed opaque colour: where edges of touching pieces coincide they look like one line (never doubled, never hidden).
  // Timeline in seconds of PERIOD: idle, 3 x [expand, hold, collapse, breath], idle (state at the end = state at the start).
  const cubes = () => {
    const root = new Group(); const spin = new Group(); root.add(spin);
    const box = track(new BoxGeometry(1, 1, 1)); const edge = track(new EdgesGeometry(box));
    const cornerGeo = track(geoOf([-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z])))));
    const CUBE = 0.44;                               // edge of one piece (main cube edge = 3 * CUBE, constant)
    const pieces = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const cls = Math.abs(x) + Math.abs(y) + Math.abs(z);
      const filled = cls % 2 === 0;
      const g = new Group(); const l = new LineSegments(edge, filled ? inkMat : lineMat); l.renderOrder = 1; l.frustumCulled = false;
      const body = new Mesh(box, filled ? fillWhite : occluder); body.scale.setScalar(SHRINK);
      g.add(body, l, dotsGeo(cornerGeo));
      g.scale.setScalar(CUBE); spin.add(g); pieces.push({ g, q: [x, y, z], cls });
    }
    // per-class spread factors [centre, face, edge, corner]: exploded lattice / octahedral star / vertex shell
    const forms = [[1, 1.6, 1.6, 1.6], [1, 2.9, 1.5, 1], [1, 1, 1.35, 1.8]];
    const E = 2, H = 2, B = 0.5, S = 2.25;           // expand, hold, collapse (=E), breath, leading idle (seconds)
    const seg = E + H + E + B;
    const ss = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
    const amount = (t, i) => { const u = t - S - i * seg; if (u < 0 || u > seg) return 0; return u < E ? ss(u / E) : u < E + H ? 1 : u < E + H + E ? 1 - ss((u - E - H) / E) : 0; };
    root.rotation.x = 0.4; root.scale.setScalar(1.28);
    return { root, R: 2.3, staticPhase: 0, update: (p) => {
      const t = (p / TAU) * PERIOD; let tot = 0; const f = [1, 1, 1, 1];
      forms.forEach((fm, i) => { const e = amount(t, i); tot = Math.max(tot, e); for (let c = 0; c < 4; c++) f[c] += (fm[c] - 1) * e; });
      pieces.forEach((o) => { const k = CUBE * f[o.cls]; o.g.position.set(o.q[0] * k, o.q[1] * k, o.q[2] * k); });
      spin.rotation.y = p; spin.position.y = 0.1 * Math.sin(6 * p) * (1 - tot);   // levitation bob fades out while a form is open (keeps it centred)
    } };
  };

  const sprout = () => {
    const root = new Group(); const spin = new Group(); const sway = new Group(); root.add(spin); spin.add(sway);
    const leaf = (dirAng, base, L, W, yaw) => {
      const N = 16, up = [], down = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, w = W * Math.pow(Math.sin(Math.PI * u), 0.85);
        const c = [Math.cos(dirAng) * L * u, Math.sin(dirAng) * L * u];
        const n = [-Math.sin(dirAng), Math.cos(dirAng)];
        up.push([c[0] + n[0] * w, c[1] + n[1] * w, 0.2 * u * u]);
        down.push([c[0] - n[0] * w, c[1] - n[1] * w, 0.2 * u * u]);
      }
      const outline = [...up, ...down.slice().reverse().slice(1, -1)];
      const rib = Array.from({ length: N + 1 }, (_, i) => { const u = i / N; return [Math.cos(dirAng) * L * u, Math.sin(dirAng) * L * u, 0.2 * u * u]; });
      const g = new Group();
      const idx = []; for (let i = 0; i < N; i++) idx.push(i, N + 1 + i, i + 1, i + 1, N + 1 + i, N + 2 + i);
      const fg = track(geoOf([...up, ...down])); fg.setIndex(idx);
      g.add(new Mesh(fg, fillWhite), lineSeg([...pairs(outline, true), ...pairs(rib)], inkMat), dots(outline.filter((_, i) => i % 2 === 0)), dots([rib[0], rib[N]]));
      g.position.set(...base); g.rotation.y = yaw; return g;
    };
    const stem = Array.from({ length: 21 }, (_, i) => { const u = i / 20; return [0.1 * Math.sin(u * Math.PI), -1.2 + 1.9 * u, 0]; });
    sway.add(lineSeg(pairs(stem)), dots(stem.filter((_, i) => i % 4 === 0)));
    sway.add(leaf(0.75, [0.0, -0.15, 0], 1.45, 0.38, 0.5));
    sway.add(leaf(2.35, [0.0, 0.3, 0], 1.25, 0.34, -0.4));
    // soil: two concentric dotted rings on the ground plane
    const ring = (r, n) => circle(r, n).map(([x, y]) => [x, -1.2, y]);
    const r1 = ring(1.0, 64), r2 = ring(0.52, 40);
    root.add(lineSeg([...pairs(r1, true), ...pairs(r2, true)]), dots(r1.filter((_, i) => i % 4 === 0)), dots(r2.filter((_, i) => i % 5 === 0)));
    const grains = [[-1.5, -0.5, 0.4, 0], [1.55, -0.1, -0.3, 2], [1.0, -0.95, 1.0, 4]].map((q) => {
      const g = ball(false); g.scale.setScalar(0.17); g.position.set(q[0], q[1], q[2]); root.add(g); return { g, q };
    });
    root.rotation.x = 0.28;
    return { root, R: 1.95, update: (p) => {
      spin.rotation.y = p; sway.rotation.z = 0.07 * Math.sin(2 * p);
      grains.forEach((o) => { o.g.position.y = o.q[1] + 0.12 * Math.sin(3 * p + o.q[3]); o.g.rotation.y = 2 * p; });
    } };
  };
  const factories = { api: molecule, excipients: cubes, food: sprout };

  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  const items = hosts.map((host) => {
    const make = factories[host.dataset.scene]; if (!make) return null;
    const scene = new Scene(); const s = make(); scene.add(s.root);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); canvas.className = 'link-card__canvas';
    host.appendChild(canvas);
    return { host, scene, s, canvas, ctx: canvas.getContext('2d'), onScreen: false, W: 0, H: 0, d: 1 };
  }).filter(Boolean);
  if (!items.length) { renderer.dispose(); return null; }

  const resize = (it) => {
    const w = it.host.clientWidth, h = it.host.clientHeight; if (!w || !h) return false;
    const d = capDpr(MAX_DPR);
    it.d = d; it.W = Math.round(w * d); it.H = Math.round(h * d); it.canvas.width = it.W; it.canvas.height = it.H; return true;
  };
  let lost = false, raf = 0; const t0 = performance.now();
  const draw = (it, phase) => {
    if (lost || !it.W) return;
    if (gl.width !== it.W || gl.height !== it.H) { renderer.setSize(it.W, it.H, false); camera.aspect = it.W / it.H; camera.updateProjectionMatrix(); }
    dotMat.uniforms.uSize.value = DOT_PX * it.d;
    camera.position.set(0, 0, it.s.R / (FILL * TAN * Math.min(1, it.W / it.H)));   // scene fills FILL of the art zone's smaller side
    it.s.update(phase === STATIC_PHASE && it.s.staticPhase !== undefined ? it.s.staticPhase : phase);
    it.scene.updateMatrixWorld(true); faceCamera();
    renderer.render(it.scene, camera);
    it.ctx.clearRect(0, 0, it.W, it.H);
    it.ctx.drawImage(gl, 0, 0);
    it.canvas.classList.add('is-ready');
  };
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const phase = (((performance.now() - t0) / 1000) % PERIOD) / PERIOD * TAU;
    items.forEach((it) => { if (it.onScreen) draw(it, phase); });
  };
  const sync = () => {
    const run = items.some((i) => i.onScreen) && !document.hidden && !reducedMq.matches;
    if (run && !raf) raf = requestAnimationFrame(frame);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run) items.forEach((it) => { if (it.onScreen) draw(it, STATIC_PHASE); });
  };
  const ro = new ResizeObserver((en) => { en.forEach((e) => { const it = items.find((i) => i.host === e.target); if (it && resize(it) && !raf) draw(it, STATIC_PHASE); }); });
  const io = new IntersectionObserver((en) => { en.forEach((e) => { const it = items.find((i) => i.host === e.target); if (it) it.onScreen = e.isIntersecting; }); sync(); });
  items.forEach((it) => { resize(it); ro.observe(it.host); io.observe(it.host); });
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (ev) => { ev.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  gl.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf); raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync); reducedMq.removeEventListener('change', sync); gl.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose()); [lineMat, inkMat, silMat, fillWhite, occluder, dotMat].forEach((m) => m.dispose()); renderer.dispose();
    items.forEach((it) => it.canvas.remove());
  };
  return { destroy, get running() { return !!raf; } };
}
