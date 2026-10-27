// Home Products cards: three looping three.js scenes (API molecule, Excipients cubes, Food Grade sprout) in the illustration language:
// fat 2px LineSegments2 outlines (--il-ink), main object = white flat fill (--il-fill), secondary objects = light-blue flat fill (--il-soft), free lines = --il-soft; tokens from CSS (.link-card__art in link-list.css), no lighting/shadows.
// ONE shared WebGLRenderer (offscreen canvas) renders each visible card and copies the frame into that card's 2D canvas, so Home keeps a single extra WebGL context.
// Seamless loop: every motion is a function of phase = 2*PI*t/PERIOD with integer harmonics only, so the state at t = PERIOD equals t = 0 (no start, no end).
// Renders only cards on screen and while the tab is visible; prefers-reduced-motion = one static frame; DPR <= 2; destroy() frees everything. No WebGL -> returns null.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh, SphereGeometry, CircleGeometry, BoxGeometry, EdgesGeometry, Vector3, DoubleSide,
} from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { capDpr } from '../utils/dpr.js';

const PERIOD = 24, MAX_DPR = 2, STATIC_PHASE = 0.9, TAU = Math.PI * 2;
const LINE_PX = 2; // outline width in screen px (customer decision for these three illustrations: fat lines, ~2px)

const geoOf = (pts) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3)); return g; };
const circle = (r, n = 48) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [Math.cos(a) * r, Math.sin(a) * r, 0]; });
// polyline -> flat segment pairs for LineSegments2 (closed = also join last to first)
const pairs = (pts, closed = false) => { const out = []; const n = pts.length; for (let i = 0; i < n - 1; i++) out.push(...pts[i], ...pts[i + 1]); if (closed) out.push(...pts[n - 1], ...pts[0]); return out; };

export function initHomeProductScenes(hosts) {
  hosts = [...hosts].filter(Boolean);
  if (!hosts.length) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  // all colours come from CSS: local illustration tokens --il-fill / --il-ink / --il-soft on .link-card__art (link-list.css)
  const probe = document.createElement('span'); probe.style.display = 'none'; hosts[0].appendChild(probe);
  const tok = (name) => { probe.style.backgroundColor = `var(${name})`; return new Color(getComputedStyle(probe).backgroundColor); };
  const cFill = tok('--il-fill'), cInk = tok('--il-ink'), cSoft = tok('--il-soft'); probe.remove();

  const gl = document.createElement('canvas');
  let renderer;
  try { renderer = new WebGLRenderer({ canvas: gl, antialias: true, alpha: true }); } catch { return null; }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  const lineMats = [];
  const lineMat = (color) => {
    const m = new LineMaterial({ color, linewidth: LINE_PX, worldUnits: false });
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
    lineMats.push(m); return m;
  };
  const mInk = lineMat(cInk), mSoft = lineMat(cSoft);
  // flat fills (no lighting, no shadows), pushed back with polygonOffset so edges stay on top and hidden lines are occluded
  const fillMat = (color) => new MeshBasicMaterial({ color, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const fillWhite = fillMat(cFill), fillSoft = fillMat(cSoft);
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const lineObj = (flat, m) => { const o = new LineSegments2(track(new LineSegmentsGeometry().setPositions(flat)), m); o.renderOrder = 1; return o; };
  const loop = (pts, m = mInk) => lineObj(pairs(pts, true), m);
  const strip = (pts, m = mInk) => lineObj(pairs(pts), m);
  const segs = (flat, m = mInk) => lineObj(flat, m);
  // sphere drawn as three great circles over a flat fill; geometries shared between all spheres
  let sphereGeo, circGeo;
  const sphere = (r, fm = fillWhite) => {
    sphereGeo ||= track(new SphereGeometry(1, 28, 18)); circGeo ||= track(new LineSegmentsGeometry().setPositions(pairs(circle(1), true)));
    const g = new Group();
    const ring = () => { const o = new LineSegments2(circGeo, mInk); o.renderOrder = 1; return o; };
    const a = ring(), b = ring(), c = ring(); b.rotation.x = Math.PI / 2; c.rotation.y = Math.PI / 2;
    g.add(new Mesh(sphereGeo, fm), a, b, c); g.scale.setScalar(r); return g;
  };

  /* ---------- scenes: each returns { root, update(phase) } ---------- */
  const molecule = () => {
    const root = new Group(); const spin = new Group(); root.add(spin);
    const nodes = [[0, 0, 0, 0.42], [1.25, 0.7, 0.2, 0.3], [-1.15, 0.9, 0.5, 0.32], [0.3, -1.25, 0.8, 0.28], [-0.7, -0.85, -0.95, 0.32], [0.95, 0.1, -1.15, 0.26], [-0.2, 1.4, -0.85, 0.24]];
    const bonds = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [2, 6], [1, 5], [3, 4]];
    const sp = []; const bl = [];
    // vertical float per node: [amplitude, integer harmonic, phase]; centre node moves least
    const fl = [[0.08, 1, 0], [0.26, 2, 0.6], [0.24, 3, 2.1], [0.27, 2, 3.7], [0.22, 3, 5.2], [0.25, 1, 1.3], [0.23, 2, 4.4]];
    nodes.forEach((n, i) => { const s = sphere(1, i === 0 ? fillWhite : fillSoft); s.position.set(n[0], n[1], n[2]); spin.add(s); sp.push(s); });
    // bond = unit line along +z, oriented/stretched between node surfaces every frame so it follows the nodes
    const unit = track(new LineSegmentsGeometry().setPositions([0, 0, 0, 0, 0, 1]));
    const Z = new Vector3(0, 0, 1), A = new Vector3(), Bv = new Vector3(), D = new Vector3();
    bonds.forEach(([i, j]) => { const o = new LineSegments2(unit, mSoft); o.renderOrder = 1; o.frustumCulled = false; spin.add(o); bl.push({ o, i, j }); });
    root.rotation.x = 0.35;
    return { root, update: (p) => {
      spin.rotation.y = p;
      sp.forEach((s, i) => { s.scale.setScalar(nodes[i][3] * (1 + 0.12 * Math.sin(2 * p + i * 1.1))); s.position.y = nodes[i][1] + fl[i][0] * Math.sin(fl[i][1] * p + fl[i][2]); });
      bl.forEach(({ o, i, j }) => {
        A.copy(sp[i].position); Bv.copy(sp[j].position); D.subVectors(Bv, A); const len = D.length(); D.divideScalar(len);
        const ra = sp[i].scale.x, rb = sp[j].scale.x;
        o.position.copy(A).addScaledVector(D, ra); o.quaternion.setFromUnitVectors(Z, D); o.scale.set(1, 1, Math.max(0.001, len - ra - rb));
      });
    } };
  };

  // Excipients: a levitating 3x3x3 cube built of 27 equal small cubes. Pieces only translate (never scale/overlap) into 3 point-symmetric forms and back.
  // Piece at lattice cell g in {-1,0,1}^3 sits at g * CUBE * f(class); class = |g|_1 (0 centre, 1 face, 2 edge, 3 corner). All factors f >= 1 =>
  // two pieces always differ by >= CUBE on some axis, so they touch at most by faces and never intersect. Opposite cells share class and colour => point symmetry.
  // Timeline in seconds of PERIOD: idle, 3 x [expand, hold, collapse, breath], idle (state at the end = state at the start).
  const cubes = () => {
    const root = new Group(); const spin = new Group(); root.add(spin);
    const box = track(new BoxGeometry(1, 1, 1)); const edge = track(new LineSegmentsGeometry().setPositions(new EdgesGeometry(box).attributes.position.array));
    const CUBE = 0.44;                               // edge of one piece (main cube edge = 3 * CUBE, constant)
    const pieces = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const cls = Math.abs(x) + Math.abs(y) + Math.abs(z);
      const g = new Group(); const l = new LineSegments2(edge, mInk); l.renderOrder = 1; g.add(new Mesh(box, cls % 2 ? fillSoft : fillWhite), l);
      g.scale.setScalar(CUBE); spin.add(g); pieces.push({ g, q: [x, y, z], cls });
    }
    // per-class spread factors [centre, face, edge, corner]: exploded lattice / octahedral star / vertex shell
    const forms = [[1, 1.6, 1.6, 1.6], [1, 2.9, 1.5, 1], [1, 1, 1.35, 1.8]];
    const E = 2, H = 2, B = 0.5, S = 2.25;           // expand, hold, collapse (=E), breath, leading idle (seconds)
    const seg = E + H + E + B;
    const ss = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
    const amount = (t, i) => { const u = t - S - i * seg; if (u < 0 || u > seg) return 0; return u < E ? ss(u / E) : u < E + H ? 1 : u < E + H + E ? 1 - ss((u - E - H) / E) : 0; };
    root.rotation.x = 0.4; root.scale.setScalar(1.28);
    return { root, staticPhase: 0, update: (p) => {
      const t = (p / TAU) * PERIOD; let tot = 0; const f = [1, 1, 1, 1];
      forms.forEach((fm, i) => { const e = amount(t, i); tot = Math.max(tot, e); for (let c = 0; c < 4; c++) f[c] += (fm[c] - 1) * e; });
      pieces.forEach((o) => { const k = CUBE * f[o.cls]; o.g.position.set(o.q[0] * k, o.q[1] * k, o.q[2] * k); });
      spin.rotation.y = p; spin.position.y = 0.1 * Math.sin(6 * p) * (1 - tot);   // levitation bob fades out while a form is open (keeps it centred)
    } };
  };

  const sprout = () => {
    const root = new Group(); const spin = new Group(); const sway = new Group(); root.add(spin); spin.add(sway);
    const leaf = (dirAng, base, L, W, yaw) => {
      const up = [], down = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, w = W * Math.pow(Math.sin(Math.PI * u), 0.85);
        const c = [Math.cos(dirAng) * L * u, Math.sin(dirAng) * L * u];
        const n = [-Math.sin(dirAng), Math.cos(dirAng)];
        up.push([c[0] + n[0] * w, c[1] + n[1] * w, 0.2 * u * u]);
        down.push([c[0] - n[0] * w, c[1] - n[1] * w, 0.2 * u * u]);
      }
      const idx = []; for (let i = 0; i < 16; i++) { idx.push(i, 17 + i, i + 1, i + 1, 17 + i, 18 + i); }
      const fg = track(new BufferGeometry()); fg.setAttribute('position', new Float32BufferAttribute([...up, ...down].flat(), 3)); fg.setIndex(idx);
      const outline = loop([...up, ...down.slice().reverse().slice(1, -1)], mInk);
      const rib = strip(Array.from({ length: 17 }, (_, i) => { const u = i / 16; return [Math.cos(dirAng) * L * u, Math.sin(dirAng) * L * u, 0.2 * u * u]; }), mInk);
      const g = new Group(); g.add(new Mesh(fg, fillWhite), outline, rib); g.position.set(...base); g.rotation.y = yaw; return g;
    };
    sway.add(strip(Array.from({ length: 21 }, (_, i) => { const u = i / 20; return [0.1 * Math.sin(u * Math.PI), -1.2 + 1.9 * u, 0]; }), mSoft));
    sway.add(leaf(0.75, [0.0, -0.15, 0], 1.45, 0.38, 0.5));
    sway.add(leaf(2.35, [0.0, 0.3, 0], 1.25, 0.34, -0.4));
    root.add(loop(circle(1.0, 64).map(([x, y]) => [x, -1.2, y]), mInk));
    const soil = new Mesh(track(new CircleGeometry(1.0, 64)), fillSoft); soil.rotation.x = -Math.PI / 2; soil.position.y = -1.2; root.add(soil);
    const grains = [[-1.5, -0.5, 0.4, 0], [1.55, -0.1, -0.3, 2], [1.0, -0.95, 1.0, 4]].map((q) => {
      const g = new Group(); const s = sphere(1, fillSoft); s.scale.set(0.13, 0.22, 0.13); g.add(s); g.position.set(q[0], q[1], q[2]); root.add(g); return { g, q };
    });
    root.rotation.x = 0.28;
    return { root, update: (p) => {
      spin.rotation.y = p; sway.rotation.z = 0.07 * Math.sin(2 * p);
      grains.forEach((o) => { o.g.position.y = o.q[1] + 0.12 * Math.sin(3 * p + o.q[3]); o.g.rotation.y = 2 * p; });
    } };
  };
  const factories = { api: molecule, excipients: cubes, food: sprout };

  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 13.1);
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
    lineMats.forEach((m) => { m.resolution.set(it.W, it.H); m.linewidth = LINE_PX * it.d; });
    it.s.update(phase === STATIC_PHASE && it.s.staticPhase !== undefined ? it.s.staticPhase : phase);
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
    geos.forEach((g) => g.dispose()); lineMats.forEach((m) => m.dispose()); fillWhite.dispose(); fillSoft.dispose(); renderer.dispose();
    items.forEach((it) => it.canvas.remove());
  };
  return { destroy, get running() { return !!raf; } };
}
