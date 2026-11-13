// Home Quality cards: two looping three.js scenes (EudraGMDP = archive stack + filled document with a solid seal ring and a check; GDP = a warehouse in the centre of a controlled zone, entry route on one side, exit route on the other)
// in the hero language: DOTS + THIN LINES (1 device px) over flat fills, drawn in an isometric orthographic view on the LIGHT band.
// ONE filled main object per scene (white --il-fill, thin --accent edges); everything else = outline only (--accent lines pre-mixed with the band colour, so crossing lines never get brighter) + dots; no halos, no extra colours.
// Both scenes use the same floor dot field and the same scale, so the two cards carry equal visual weight; GDP is point-symmetric about the card centre: the warehouse sits on the centre of the art zone, entry (+z) and exit (+x) routes mirror each other on screen.
// ONE shared WebGLRenderer (offscreen canvas) renders each visible card and copies the frame into that card's 2D canvas, so Home keeps a single extra WebGL context for Quality.
// Seamless loop: every motion is a function of phase = 2*PI*t/PERIOD with integer harmonics only. Renders only cards on screen and while the tab is visible; prefers-reduced-motion = one static frame; DPR <= 2; destroy() frees everything. No WebGL -> returns null.
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Color, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Points, ShaderMaterial,
  BoxGeometry, EdgesGeometry, Mesh, MeshBasicMaterial, DoubleSide, Vector3,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const PERIOD = 12, MAX_DPR = 2, TAU = Math.PI * 2;
const SHRINK = 0.97;                  // fill meshes are a hair smaller than their outline so edges stay in front
const FILL = 0.86;                    // share of the art zone taken by the scene's reference span
const SPAN_W = 400, SPAN_H = 262;     // reference span of both scenes (world units on screen): floor dot field + objects
const FIELD_N = 5, FIELD_STEP = 28;   // floor dot field (-140..140), identical in both scenes
const DOT_PX = 3, FLOOR_DOT_PX = 2;   // dot diameters in CSS px (x DPR)
// ONE shared floor plane for every scene: world y = FLOOR_Y (objects stand on it; their bottoms are at FLOOR_Y), the same camera / scale / FILL and the same vertical shift FLOOR_LIFT of the whole scene
// (objects are moved, the camera always looks at the origin), so the floor diamond sits at the same screen position in every card.
const FLOOR_Y = 0, FLOOR_LIFT = -34;

const geoOf = (pts) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3)); return g; };
const segsOf = (pts, closed = false) => { const out = []; const n = pts.length; for (let i = 0; i < n - 1; i++) out.push(pts[i], pts[i + 1]); if (closed) out.push(pts[n - 1], pts[0]); return out; };
const circleXZ = (cx, cz, r, y, n = 32) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; });
const rectXZ = (x0, z0, x1, z1, y) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
const corners = (w, h, d) => [-w / 2, w / 2].flatMap((x) => [-h / 2, h / 2].flatMap((y) => [-d / 2, d / 2].map((z) => [x, y, z])));

export function initHomeQualityScenes(hosts) {
  hosts = [...hosts].filter(Boolean);
  if (!hosts.length) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  // all colours come from CSS: local illustration tokens on .quality-card__art
  const probe = document.createElement('span'); probe.style.display = 'none'; hosts[0].appendChild(probe);
  const tok = (name) => { probe.style.backgroundColor = `var(${name})`; return new Color(getComputedStyle(probe).backgroundColor); };
  const cFill = tok('--il-fill'), cInk = tok('--il-soft'), cBg = tok('--il-bg'); probe.remove();
  const mix = (a) => cBg.clone().lerp(cInk, a);   // opaque pre-mixed line colour = ink at opacity a over the band

  const gl = document.createElement('canvas');
  let renderer;
  try { renderer = new WebGLRenderer({ canvas: gl, antialias: true, alpha: true }); } catch { return null; }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);

  const mats = [];
  const lineCache = new Map();
  const lineMat = (a) => { const k = Math.round(a * 20) / 20; if (!lineCache.has(k)) { const m = new LineBasicMaterial({ color: mix(k) }); mats.push(m); lineCache.set(k, m); } return lineCache.get(k); };
  const inkMat = lineMat(1);
  const fillMat = new MeshBasicMaterial({ color: cFill, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const occluder = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  mats.push(fillMat, occluder);
  const dotMat = (px, color) => {
    const m = new ShaderMaterial({
      uniforms: { uSize: { value: px }, uColor: { value: color } }, transparent: true, depthWrite: false,
      vertexShader: 'uniform float uSize; void main(){ gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor, 1.0 - smoothstep(0.38, 0.5, d)); }',
    });
    mats.push(m); return m;
  };
  const dotInk = dotMat(DOT_PX, cInk), dotMid = dotMat(DOT_PX - 0.5, mix(0.7)), dotFloor = dotMat(FLOOR_DOT_PX, mix(0.32));
  const dotMats = [[dotInk, DOT_PX], [dotMid, DOT_PX - 0.5], [dotFloor, FLOOR_DOT_PX]];

  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const segs = (pts, m = inkMat) => { const o = new LineSegments(track(geoOf(pts)), m); o.frustumCulled = false; o.renderOrder = 1; return o; };
  const dots = (pts, m = dotInk) => { const o = new Points(track(geoOf(pts)), m); o.frustumCulled = false; o.renderOrder = 3; return o; };
  const floor = () => { const pts = []; for (let i = -FIELD_N; i <= FIELD_N; i++) for (let j = -FIELD_N; j <= FIELD_N; j++) pts.push([i * FIELD_STEP, 0, j * FIELD_STEP]); return dots(pts, dotFloor); };

  // filled box (white fill + accent edges + visible corner dots); centre c, size [w,h,d]
  const boxGeo = {};
  const solid = (w, h, d, filled = true, edgeMat = inkMat, dotM = dotInk) => {
    const key = `${w}|${h}|${d}`; const bg = boxGeo[key] ||= { box: track(new BoxGeometry(w, h, d)), edge: null };
    bg.edge ||= track(new EdgesGeometry(bg.box));
    const g = new Group();
    const body = new Mesh(bg.box, filled ? fillMat : occluder); body.scale.setScalar(SHRINK); g.add(body);
    const e = new LineSegments(bg.edge, edgeMat); e.renderOrder = 1; e.frustumCulled = false; g.add(e);
    const d8 = new Points(track(geoOf(corners(w, h, d))), dotM); d8.renderOrder = 3; d8.frustumCulled = false; g.add(d8);
    return g;
  };
  /* ---------- EudraGMDP: archive stack + filled document with a solid seal ring and a check ---------- */
  const eudra = () => {
    const root = new Group(); root.position.y = FLOOR_Y + FLOOR_LIFT;
    const W = 150, D = 108, SHEETS = 6, GAP = 8, T = 4, Y0 = 62, TOP = SHEETS * GAP - GAP;
    root.add(floor());
    // archive: 6 outlined sheets (opacity grows towards the top), corner dots at the three visible corners
    for (let k = 0; k < SHEETS; k++) {
      root.add(segs(segsOf(rectXZ(-W / 2, -D / 2, W / 2, D / 2, k * GAP), true), lineMat(0.2 + k * 0.07)));
      root.add(dots([[W / 2, k * GAP, -D / 2], [W / 2, k * GAP, D / 2], [-W / 2, k * GAP, D / 2]], dotMid));
    }
    // depth-only block inside the stack: floor dots behind it are never drawn over it (sheet edges lie on its faces)
    const blk = new Mesh(track(new BoxGeometry(W, TOP, D)), occluder); blk.position.y = TOP / 2; blk.scale.setScalar(SHRINK); root.add(blk);
    // thin solid lift guides from the stack's top corners to the document
    const guides = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].flatMap(([x, z]) => [[x, TOP, z], [x, Y0, z]]);
    root.add(segs(guides, lineMat(0.3)));
    // document: ONE filled object; text lines, seal ring and check lie on its top face
    const doc = new Group(); root.add(doc);
    const slab = solid(W, T, D); doc.add(slab);
    const yt = T / 2 + 0.3;
    const lines = [[-30, 40], [-14, 60], [2, 50], [18, 30]].flatMap(([z, len]) => [[-W / 2 + 16, yt, z * 0.9], [-W / 2 + 16 + len, yt, z * 0.9]]);
    doc.add(segs(lines, inkMat));
    // seal: solid thin ring + two-segment check, both built in the document's own plane (x, z of the slab, children of `doc`), so they project isometrically together with it (ellipse + check parallel to the sheet's sides)
    const sx = 38, sz = 20, sr = 22;
    doc.add(segs(segsOf(circleXZ(sx, sz, sr, yt, 64), true), inkMat));
    doc.add(segs(segsOf([[-5, 8], [4, 8], [4, -12]].map(([a, b]) => [sx + a, yt, sz + b])), inkMat));   // vertex at the screen-bottom; arms run along the sheet's own x / z sides
    return { root, staticPhase: Math.PI / 2, update: (p) => { doc.position.y = Y0 + T / 2 + 7 * Math.sin(p); } };
  };

  /* ---------- GDP: warehouse on the centre of a controlled zone; entry route on +z, exit route on +x (mirror images on screen) ---------- */
  const gdp = () => {
    const root = new Group(); root.position.y = FLOOR_Y + FLOOR_LIFT;
    const H = 56, WH = 96, Z = 88, RING = 150, DW = 18, DH = 30, DOORS = [-33, -9, 15];
    root.add(floor());
    // controlled zone: solid thin square + corner dots
    const zone = rectXZ(-Z, -Z, Z, Z, 0.2);
    root.add(segs(segsOf(zone, true), lineMat(0.65)), dots(zone, dotInk));
    // warehouse: ONE filled object, dock doors on the two visible faces; only vertex dots, no dots on the roof or walls
    const wh = solid(WH, H, WH); wh.position.y = H / 2; root.add(wh);
    const doors = [];
    DOORS.forEach((a) => {
      doors.push([a, 0.2, WH / 2 + 0.3], [a, DH, WH / 2 + 0.3], [a, DH, WH / 2 + 0.3], [a + DW, DH, WH / 2 + 0.3], [a + DW, DH, WH / 2 + 0.3], [a + DW, 0.2, WH / 2 + 0.3]);
      doors.push([WH / 2 + 0.3, 0.2, a], [WH / 2 + 0.3, DH, a], [WH / 2 + 0.3, DH, a], [WH / 2 + 0.3, DH, a + DW], [WH / 2 + 0.3, DH, a + DW], [WH / 2 + 0.3, 0.2, a + DW]);
    });
    root.add(segs(doors, inkMat));
    // routes: in along +z from the origin ring to the dock, out along +x from the dock to the destination ring; rings with a centre dot
    const inR = [[0, 0.2, RING], [0, 0.2, WH / 2]], outR = [[WH / 2, 0.2, 0], [RING, 0.2, 0]];
    root.add(segs([...inR, ...outR], lineMat(0.8)));
    root.add(segs([...segsOf(circleXZ(0, RING, 8, 0.2), true), ...segsOf(circleXZ(RING, 0, 8, 0.2), true)], lineMat(0.8)), dots([[0, 0.2, RING], [RING, 0.2, 0]], dotInk));
    // two parcels (outline + corner dots, hidden lines occluded) travel in / out; they grow from the ring and shrink into the dock / ring (seamless loop)
    const pk = () => { const g = solid(18, 16, 18, false); const o = new Group(); g.position.y = 8; o.add(g); root.add(o); return o; };
    const pin = pk(), pout = pk();
    const ease = (x) => x * x * (3 - 2 * x);
    const place = (o, f, axis, dist) => { const s = ease(Math.min(1, f / 0.1)) * ease(Math.min(1, (1 - f) / 0.1)); o.scale.setScalar(Math.max(s, 0.001)); o.position.set(axis === 'x' ? dist : 0, 0, axis === 'z' ? dist : 0); };
    return { root, staticPhase: Math.PI, update: (p) => {
      const f = p / TAU;
      place(pin, f, 'z', RING - 8 - (RING - 8 - 74) * f);          // from the ring to the dock (distance 142 -> 74)
      place(pout, f, 'x', 74 + (RING - 8 - 74) * f);                // from the dock to the ring
    } };
  };
  const factories = { eudra, gdp };

  // isometric orthographic camera: looks at the origin from (1, 1, 1); x -> screen right-down, z -> screen left-down
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  camera.position.set(500, 500, 500); camera.lookAt(new Vector3(0, 0, 0));
  const items = hosts.map((host) => {
    const make = factories[host.dataset.scene]; if (!make) return null;
    const scene = new Scene(); const s = make(); scene.add(s.root);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); canvas.className = 'quality-card__canvas';
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
    if (gl.width !== it.W || gl.height !== it.H) renderer.setSize(it.W, it.H, false);
    const u = FILL * Math.min(it.W / it.d / SPAN_W, it.H / it.d / SPAN_H);   // CSS px per world unit
    const hw = it.W / it.d / (2 * u), hh = it.H / it.d / (2 * u);              // frustum half-size in world units
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh; camera.updateProjectionMatrix();
    dotMats.forEach(([m, px]) => { m.uniforms.uSize.value = px * it.d; });
    it.s.update(phase === 'static' ? it.s.staticPhase : phase);
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
    if (!run) items.forEach((it) => { if (it.onScreen) draw(it, 'static'); });
  };
  const ro = new ResizeObserver((en) => { en.forEach((e) => { const it = items.find((i) => i.host === e.target); if (it && resize(it) && !raf) draw(it, 'static'); }); });
  const io = new IntersectionObserver((en) => { en.forEach((e) => { const it = items.find((i) => i.host === e.target); if (it) it.onScreen = e.isIntersecting; }); sync(); });
  items.forEach((it) => { resize(it); ro.observe(it.host); io.observe(it.host); });
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (ev) => { ev.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  gl.addEventListener('webglcontextlost', onLost);

  // test / debug hook: render a given phase of one scene (no-op in production use)
  const destroy = () => {
    if (raf) cancelAnimationFrame(raf); raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync); reducedMq.removeEventListener('change', sync); gl.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); renderer.dispose();
    items.forEach((it) => it.canvas.remove());
  };
  return { destroy, draw: (i, phase) => draw(items[i], phase), get running() { return !!raf; } };
}
