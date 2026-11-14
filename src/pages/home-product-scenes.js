// Home Products cards: three looping three.js scenes (API molecule, Excipients cubes, Food Grade sprout) in the hero language: DOTS + THIN LINES (1 device px) over flat fills.
// Main objects (centre sphere, white cube pieces, leaves) = flat white fill (--il-fill) with thin --il-bg (card blue) edges; secondary objects (outer nodes, other cube pieces, grains, soil, stem, bonds) = NO fill, thin white outline (--il-soft at 70%, an opaque pre-mixed colour so coinciding lines never get brighter);
// they use a depth-only occluder (no colour) so lines behind them stay hidden. White round dots sit at the vertices / on the contours. Fills are pushed back / shrunk a hair so edges never z-fight with them.
// Every node also has a screen-facing silhouette ring drawn without depth test, so each ball always has a visible outer contour.
// Built on src/utils/il-scene.js: ONE shared WebGLRenderer (offscreen canvas) + 2D copy per card, token probe, observers, reduced-motion frame and destroy() live in the engine; this file holds only the three scene factories.
// Seamless loop: every motion is a function of phase = 2*PI*t/PERIOD with integer harmonics only, so the state at t = PERIOD equals t = 0 (no start, no end).
// Renders only cards on screen and while the tab is visible; prefers-reduced-motion = one static frame; DPR <= 2; destroy() frees everything. No WebGL -> returns null.
import { createIlScene, perspCamera } from '../utils/il-scene.js';

const PERIOD = 24, STATIC_PHASE = 0.9, TAU = Math.PI * 2;
const LINE_ALPHA = 0.7;    // line opacity over the card background (lines are 1 device px: native GL lines)
const FILL = 0.68;         // scene diameter as a share of the art-zone's smaller side

// Each factory takes the engine kit and returns { root, R (scene radius), update(phase) }.
// Materials: white outline = lineMat(LINE_ALPHA) (opaque pre-mix), card-blue thin edges = lineMat(0), silhouette rings = lineMat(LINE_ALPHA, { depth: false }).
const mats = (K) => ({ line: K.lineMat(LINE_ALPHA), ink: K.lineMat(0), sil: K.lineMat(LINE_ALPHA, { depth: false }) });

// small point-sphere: screen-facing silhouette ring (always visible outer contour) + 3 great circles + 6 axis dots + centre dot
// filled = white flat sphere with card-blue great circles; otherwise outline-only (white great circles over a depth-only occluder)
const ball = (K, filled) => {
  const c = K.cache, m = mats(K);
  c.ringGeo ||= K.track(K.geoOf(K.circle(1, 32)));
  c.sphereGeo ||= K.track(new K.SphereGeometry(1, 24, 16));
  c.ballDotGeo ||= K.track(K.geoOf([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, 0, 0]]));
  const g = new K.Group();
  const body = new K.Mesh(c.sphereGeo, filled ? K.fillMat : K.occluder); body.scale.setScalar(K.shrink); g.add(body);
  const sil = K.loopOf(c.ringGeo, m.sil); sil.renderOrder = 2; g.add(sil); (c.billboards ||= []).push({ obj: sil, parent: g });
  const lm = filled ? m.ink : m.line;
  const a = K.loopOf(c.ringGeo, lm), b = K.loopOf(c.ringGeo, lm); a.rotation.x = Math.PI / 2; b.rotation.y = Math.PI / 2;
  g.add(a, b, K.dotsGeo(c.ballDotGeo));
  return g;
};

const SCENES = {
  api: (K) => {
    const { Group, Vector3, LineSegments, BufferGeometry, Float32BufferAttribute, track } = K; const { line: lineMat } = mats(K);
    const ball_ = (f) => ball(K, f);
    const root = new Group(); const spin = new Group(); root.add(spin);
    const nodes = [[0, 0, 0, 0.42], [1.25, 0.7, 0.2, 0.3], [-1.15, 0.9, 0.5, 0.32], [0.3, -1.25, 0.8, 0.28], [-0.7, -0.85, -0.95, 0.32], [0.95, 0.1, -1.15, 0.26], [-0.2, 1.4, -0.85, 0.24]];
    const bonds = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [2, 6], [1, 5], [3, 4]];
    const sp = [];
    // vertical float per node: [amplitude, integer harmonic, phase]; centre node moves least
    const fl = [[0.08, 1, 0], [0.26, 2, 0.6], [0.24, 3, 2.1], [0.27, 2, 3.7], [0.22, 3, 5.2], [0.25, 1, 1.3], [0.23, 2, 4.4]];
    nodes.forEach((n, i) => { const s = ball_(i === 0); s.position.set(n[0], n[1], n[2]); spin.add(s); sp.push(s); });
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
  },
  excipients: (K) => {
    const { Group, Mesh, LineSegments, BoxGeometry, EdgesGeometry, track, geoOf } = K; const { line: lineMat, ink: inkMat } = mats(K); const fillWhite = K.fillMat, occluder = K.occluder, SHRINK = K.shrink;
    const dotsGeo = (g) => K.dotsGeo(g);
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
  },
  food: (K) => {
    const { Group, track, geoOf } = K; const { line: lineMat, ink: inkMat } = mats(K); const fillWhite = K.fillMat; const Mesh = K.Mesh;
    const ball_ = (f) => ball(K, f);
    const lineSeg = (pts, m = lineMat) => K.segs(pts, m);
    const dots = (pts) => K.dots(pts, K.dot.fill);
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
      g.add(new Mesh(fg, fillWhite), lineSeg([...K.segsOf(outline, true), ...K.segsOf(rib)], inkMat), dots(outline.filter((_, i) => i % 2 === 0)), dots([rib[0], rib[N]]));
      g.position.set(...base); g.rotation.y = yaw; return g;
    };
    const stem = Array.from({ length: 21 }, (_, i) => { const u = i / 20; return [0.1 * Math.sin(u * Math.PI), -1.2 + 1.9 * u, 0]; });
    sway.add(lineSeg(K.segsOf(stem)), dots(stem.filter((_, i) => i % 4 === 0)));
    sway.add(leaf(0.75, [0.0, -0.15, 0], 1.45, 0.38, 0.5));
    sway.add(leaf(2.35, [0.0, 0.3, 0], 1.25, 0.34, -0.4));
    // soil: two concentric dotted rings on the ground plane
    const ring = (r, n) => K.circle(r, n).map(([x, y]) => [x, -1.2, y]);
    const r1 = ring(1.0, 64), r2 = ring(0.52, 40);
    root.add(lineSeg([...K.segsOf(r1, true), ...K.segsOf(r2, true)]), dots(r1.filter((_, i) => i % 4 === 0)), dots(r2.filter((_, i) => i % 5 === 0)));
    const grains = [[-1.5, -0.5, 0.4, 0], [1.55, -0.1, -0.3, 2], [1.0, -0.95, 1.0, 4]].map((q) => {
      const g = ball_(false); g.scale.setScalar(0.17); g.position.set(q[0], q[1], q[2]); root.add(g); return { g, q };
    });
    root.rotation.x = 0.28;
    return { root, R: 1.95, update: (p) => {
      spin.rotation.y = p; sway.rotation.z = 0.07 * Math.sin(2 * p);
      grains.forEach((o) => { o.g.position.y = o.q[1] + 0.12 * Math.sin(3 * p + o.q[3]); o.g.rotation.y = 2 * p; });
    } };
  },
};

// screen-facing silhouette rings: cancel the parent's world rotation each frame
const faceCamera = (it, K) => { const q = (K.cache.Q ||= new K.Quaternion()); (K.cache.billboards || []).forEach(({ obj, parent }) => { parent.getWorldQuaternion(q).invert(); obj.quaternion.copy(q); }); };

export function initHomeProductScenes(hosts) {
  hosts = [...hosts].filter(Boolean);
  if (!hosts.length) return null;
  return createIlScene({
    host: hosts[0], slots: hosts, scenes: SCENES, canvasClass: 'link-card__canvas', period: PERIOD, staticPhase: STATIC_PHASE, shrink: 0.965,
    camera: perspCamera({ fov: 30, fill: FILL }), beforeRender: faceCamera,
  });
}
