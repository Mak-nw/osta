// Services page, Process block: ONE detailed isometric 3D scene in the line + fill style of the Home service models
// (orthographic 30deg camera; thin LineSegments2 edges; the ACTIVE part = flat white fill with ink edges, the rest = thin outline only).
// Parts: (a) office wing (cut-away, workstations with monitor, keyboard, mouse, chair) + 2-storey block, (b) warehouse hangar
// (gable roof, sectional gate, windows, dock, pallets), (c) truck (cab, trailer, wheels) on a marked road. Trees are decoration.
// Every part merges all its solids into ONE occluder mesh + ONE edge object (few draw calls). Shapes are rounded (RoundedBoxGeometry, bevelled
// cylinders), lines are depth-tested against the occluders with polygonOffset (no torn lines), DPR <= 2, MSAA + alphaToCoverage.
// Driven by the ACTIVE STAGE of the sticky Process block (setProgress 0..1 -> stage; each stage plays ONE time-based animation and holds its last frame):
// 1 order -> office (dot on the route, charts appear on the monitors), 2 small box office -> block, 3 big box block -> warehouse gate,
// 4 gate open, 3 big boxes loaded into the truck. Reduced motion = static final frame. Loaded lazily by services.js; returns null without WebGL.
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Mesh, Color, MathUtils, MeshBasicMaterial, EdgesGeometry, SphereGeometry, LatheGeometry,
  ExtrudeGeometry, Shape, Vector2, Vector3, Matrix4, Quaternion, Euler,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { capDpr } from '../utils/dpr.js';

const PITCH = MathUtils.degToRad(30);   // isometric: yaw 45deg, pitch 30deg
const LINE_PX = 0.5, GRID_PX = 0.4, GRID_ALPHA = 0.55;   // css px: every object line is the SAME width (x DPR once); active = white fill, never a thicker line
const GROUND = 6, FIT_W = 19.5, FIT_H = 11;
const EDGE_ANGLE = 28;
// ONE commercial complex: office wing (open cut-away, interior visible) + 2-storey office block + logistics hall (flat roof, dock shelters on the +x wall)
const HALL = { x0: -2.0, x1: 1.55, z0: -4.5, z1: 0.5, h: 3.7 };
const OFF = { z0: 2.1, z1: 4.5 };               // office wing (cut-away)
const BLK = { z0: 0.5, z1: 2.1, h: 3.1 };       // office block
const DOCKS = [-3.7, -2.6, -1.5, -0.4];              // z of the dock gates (+x wall)
const ROAD_Z = DOCKS[2], SHELTER = 0.45, ROAD_END = 6;
// geometric footprint of the buildings (office wing + block + hall incl. dock shelters) in scene units; its centre must equal the floor centre (0, 0)
const SHIFT = { x: -1.5, z: 0 };   // whole complex pushed toward the BACK edge (-x, away from the viewer): more free floor in front; z (long axis = left-right ends) stays centred
const FOOT = { x0: HALL.x0, x1: HALL.x1 + 0.02 + SHELTER, z0: HALL.z0, z1: OFF.z1 };

let tokenHost = document.documentElement;   // set to the scene host in initProcessScene: the section defines the light-on-blue --p3d-* tokens
const token = (name) => getComputedStyle(tokenHost).getPropertyValue(name).trim();
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const V = (x, y, z) => new Vector3(x, y, z);

// camera direction (from the target to the camera), used for silhouettes of cylinders / spheres and camera-facing glyphs
const VIEW = V(Math.SQRT1_2 * Math.cos(PITCH), Math.sin(PITCH), Math.SQRT1_2 * Math.cos(PITCH)).normalize();
const RIGHT = V(0, 1, 0).cross(VIEW).normalize();
const UP = VIEW.clone().cross(RIGHT).normalize();

const rb = (w, h, d, r = 0.03, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, r);
// cylinder with bevelled rim (axis = y)
const bevelCyl = (r, h, b0 = 0.025, seg = 28) => {
  const b = Math.min(b0, 0.012);   // tiny bevel: rim rings merge into one line
  const pts = [new Vector2(0, -h / 2)];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 2; i++) { const a = MathUtils.degToRad(a0 + ((a1 - a0) * i) / 2); pts.push(new Vector2(cx + b * Math.cos(a), cy + b * Math.sin(a))); } };
  arc(r - b, -h / 2 + b, -90, 0);
  arc(r - b, h / 2 - b, 0, 90);
  pts.push(new Vector2(0, h / 2));
  return new LatheGeometry(pts, seg);
};

// ---------- part builder: merges solids into one occluder + one edge object ----------
class Part {
  constructor() { this.group = new Group(); this.occ = []; this.edge = []; this.acc = []; this.extra = {}; }
  mat(p, r = [0, 0, 0], s = [1, 1, 1]) {
    const q = r instanceof Quaternion ? r : new Quaternion().setFromEuler(new Euler(...r));
    return new Matrix4().compose(V(...p), q, V(...s));
  }
  solid(geo, p, r, { edges = true, s, angle = EDGE_ANGLE } = {}) {
    const m = this.mat(p, r, s);
    const og = geo.index ? geo.toNonIndexed() : geo.clone();
    og.deleteAttribute('normal'); og.deleteAttribute('uv');
    og.applyMatrix4(m);
    this.occ.push(og);
    if (edges) { const eg = new EdgesGeometry(geo, angle); eg.applyMatrix4(m); this.edge.push(...eg.attributes.position.array); }
  }
  box(w, h, d, p, r, rad = 0.03, seg = 1) { this.solid(rb(w, h, d, Math.min(rad, 0.006), 1), p, r); } // one chamfer facet, small radius: a single thin outline
  cyl(radius, h, p, r = [0, 0, 0], b = 0.025) {
    this.solid(bevelCyl(radius, h, b), p, r);
    const q = r instanceof Quaternion ? r : new Quaternion().setFromEuler(new Euler(...r));
    const axis = V(0, 1, 0).applyQuaternion(q);
    const s = axis.clone().cross(VIEW).normalize().multiplyScalar(radius);
    const c = V(...p), a = axis.clone().multiplyScalar(h / 2 - b);
    [1, -1].forEach((k) => {
      const lo = c.clone().sub(a).addScaledVector(s, k), hi = c.clone().add(a).addScaledVector(s, k);
      this.edge.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
    });
  }
  ball(radius, p, into = this.edge) {
    this.solid(new SphereGeometry(radius, 22, 14), p, undefined, { edges: false });
    this.ring(p, radius, into, 40, radius * 0.7);
  }
  ring(c, radius, into = this.edge, n = 40, off = 0) {
    const cc = V(...c).addScaledVector(VIEW, off);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const q = cc.clone().addScaledVector(RIGHT, Math.cos(a) * radius).addScaledVector(UP, Math.sin(a) * radius);
      if (prev) into.push(prev.x, prev.y, prev.z, q.x, q.y, q.z);
      prev = q;
    }
  }
  line(pts, into = this.edge) { for (let i = 1; i < pts.length; i++) into.push(...pts[i - 1], ...pts[i]); }
  rectX(x, zc, yc, w, h, into = this.edge) { const a = zc - w / 2, b = zc + w / 2, c = yc - h / 2, d = yc + h / 2; this.line([[x, c, a], [x, c, b], [x, d, b], [x, d, a], [x, c, a]], into); }
  rectZ(z, xc, yc, w, h, into = this.edge) { const a = xc - w / 2, b = xc + w / 2, c = yc - h / 2, d = yc + h / 2; this.line([[a, c, z], [b, c, z], [b, d, z], [a, d, z], [a, c, z]], into); }
  circleX(x, zc, yc, radius, n = 28) { const pts = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pts.push([x, yc + Math.sin(a) * radius, zc + Math.cos(a) * radius]); } this.line(pts); }
  // lines kept in a separate object (toggled / recoloured with the part)
  addExtra(name, pts) { this.extra[name] = pts; }
  build(mats) {
    this.occMesh = new Mesh(mergeGeometries(this.occ), mats.occ);
    this.group.add(this.occMesh);
    const dedupe = (pts) => { const seen = new Set(), out = []; const k = (x, y, z) => `${Math.round(x * 40)},${Math.round(y * 40)},${Math.round(z * 40)}`; for (let i = 0; i < pts.length; i += 6) { const a = k(pts[i], pts[i + 1], pts[i + 2]), b = k(pts[i + 3], pts[i + 4], pts[i + 5]); const key = a < b ? a + '|' + b : b + '|' + a; if (a === b || seen.has(key)) continue; seen.add(key); for (let j = 0; j < 6; j++) out.push(pts[i + j]); } return out; };
    const mk = (pts0, m) => { const pts = dedupe(pts0); const o = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), m); o.renderOrder = 1; this.group.add(o); return o; };
    this.edgeObj = mk(this.edge, mats.edge);
    this.accObj = this.acc.length ? mk(this.acc, mats.soft) : null;
    this.extraObj = {};
    Object.entries(this.extra).forEach(([k, pts]) => { this.extraObj[k] = mk(pts, mats.edge); });
    this.mats = mats;
    return this;
  }
  set(on) {
    const m = this.mats;
    this.occMesh.material = on ? m.fill : m.occ;
    this.edgeObj.material = on ? m.ink : m.edge;
    if (this.accObj) this.accObj.material = on ? m.strong : m.soft;
    Object.values(this.extraObj).forEach((o) => { o.material = on ? m.ink : m.edge; });
  }
}

export function initProcessScene(host) {
  tokenHost = host;
  let renderer;
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch { return null; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'process-scroll__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const hex = (v) => new Color(token(v)).getHex();
  const lineMat = (cssVar, px = LINE_PX, opacity = 1) => {
    const m = new LineMaterial({ color: hex(cssVar), linewidth: px, worldUnits: false, transparent: opacity < 1, opacity });
    m.userData.px = px;
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
    return m;
  };
  const ink = lineMat('--p3d-ink'), edge = lineMat('--p3d-edge'), soft = lineMat('--p3d-soft');
  const strong = lineMat('--p3d-ink', LINE_PX), gridMat = lineMat('--p3d-grid', GRID_PX, GRID_ALPHA);
  const mats = [ink, edge, soft, strong, gridMat];
  // occluder offset: slope factor 3 (was 6) - a bigger slope offset let the hidden vertical edge of every box leak out as a bright stub / dot at its top vertex
  const fill = new MeshBasicMaterial({ color: hex('--p3d-fill'), polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 6 });
  const occ = new MeshBasicMaterial({ color: hex('--p3d-occ'), polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 6 });
  const M = { ink, edge, soft, strong, fill, occ };
  // the truck and the office keep the original deeper offset (factor 6): their many near-coplanar lines (cab, arches, grille, trailer ribs, desk edges) need it
  const fillT = new MeshBasicMaterial({ color: hex('--p3d-fill'), polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 });
  const occT = new MeshBasicMaterial({ color: hex('--p3d-occ'), polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 });
  const MT = { ...M, fill: fillT, occ: occT };
  const dotMat = new MeshBasicMaterial({ color: hex('--p3d-route') });
  const segs = (pts, m) => { const o = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), m); o.renderOrder = 1; return o; };
  const dashMat = new LineMaterial({ color: hex('--p3d-route'), linewidth: LINE_PX, worldUnits: false, dashed: true, dashSize: 0.22, gapSize: 0.2 });
  dashMat.userData.px = LINE_PX; dashMat.polygonOffset = true; dashMat.polygonOffsetFactor = -1; dashMat.polygonOffsetUnits = -1;
  mats.push(dashMat);
  const dashSegs = (pts) => { const o = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), dashMat); o.computeLineDistances(); o.renderOrder = 1; return o; };
  const pl = (pts) => { const a = []; for (let i = 1; i < pts.length; i++) a.push(...pts[i - 1], ...pts[i]); return a; };

  const scene = new Scene();
  const world = new Group();   // everything except the floor grid; shifted toward the back edge
  world.position.set(SHIFT.x, 0, SHIFT.z);
  scene.add(world);
  // ground: diamond grid + outline
  const gp = [], G = GROUND, DIV = 6;
  for (let i = 0; i <= DIV; i++) { const t = -G + (i / DIV) * G * 2; gp.push(t, 0, -G, t, 0, G, -G, 0, t, G, 0, t); }
  scene.add(segs(gp, gridMat));
  scene.add(segs([-G, 0, -G, G, 0, -G, G, 0, -G, G, 0, G, G, 0, G, -G, 0, G, -G, 0, G, -G, 0, -G], soft));

  // ---------- environment: shared plinth, road with markings, kerbs, lamps, bollards, planters ----------
  const env = new Part();
  env.box(FOOT.x1 - FOOT.x0 + 0.2, 0.12, FOOT.z1 - FOOT.z0 + 0.2, [(FOOT.x0 + FOOT.x1) / 2, 0.06, (FOOT.z0 + FOOT.z1) / 2], undefined, 0.03);                         // common foundation of office + hall
  const xr = HALL.x1 + SHELTER + 0.2;
  const roadPts = [xr, 0.012, ROAD_Z - 0.95, ROAD_END, 0.012, ROAD_Z - 0.95, xr, 0.012, ROAD_Z + 0.95, ROAD_END, 0.012, ROAD_Z + 0.95, xr, 0.012, ROAD_Z - 0.95, xr, 0.012, ROAD_Z + 0.95];
  world.add(segs(roadPts, soft));
  const lamp = (x, z) => { env.cyl(0.04, 1.5, [x, 0.75, z], undefined, 0.01); env.box(0.12, 0.06, 0.28, [x, 1.52, z + 0.1], undefined, 0.02); };
  // exactly 3 lamps at the customer's floor points: screen (u, v) -> floor x = 6(u + v), z = 6(v - u); stored in world coords, minus the group shift
  [[-0.81, -0.06], [0.04, 0.79], [0.85, -0.03]].forEach(([u, v]) => lamp(6 * (u + v) - SHIFT.x, 6 * (v - u) - SHIFT.z));
  // planter outlines in front of the complex and along the west side
  const rectXZ = (x0, x1, z0, z1) => [x0, 0.012, z0, x1, 0.012, z0, x1, 0.012, z0, x1, 0.012, z1, x1, 0.012, z1, x0, 0.012, z1, x0, 0.012, z1, x0, 0.012, z0];
  // pallets with boxes beside the dock row (secondary: part of env, always outline)
  const pallet = (x, z, n) => {
    env.box(0.85, 0.09, 0.85, [x, 0.045, z], undefined, 0.02);
    env.box(0.62, 0.42, 0.62, [x, 0.3, z], undefined, 0.025);
    if (n > 1) env.box(0.5, 0.32, 0.5, [x + 0.02, 0.67, z], undefined, 0.025);
  };
  pallet(-3.4, -1.6, 2); pallet(-3.6, -3.2, 1);
  env.build(M); env.set(false);
  world.add(env.group);

  // ---------- (a) office: cut-away wing with 4 workstations + 2-storey block ----------
  const office = new Part();
  const wzc = (OFF.z0 + OFF.z1) / 2;
  office.box(0.03, 1.7, OFF.z1 - OFF.z0, [HALL.x0 + 0.015, 0.97, wzc], undefined, 0.01);   // west wall of the wing
  const chartBars = [], chartA = [], chartB = [];   // thin charts on the monitor faces (hidden outside stage 1)
  const chart = (xd, zd) => {
    const x = xd - 0.2 + 0.02, z0 = zd - 0.28, w = 0.56, y0 = 1.16;     // screen face x = xd - 0.2 + 0.015
    const hs = [0.12, 0.2, 0.15, 0.27, 0.22];
    hs.forEach((h, i) => { const z = z0 + 0.05 + i * 0.11; chartBars.push(x, y0, z, x, y0 + h, z); });
    chartA.push(x, y0 + 0.02, z0, x, y0 + 0.02, z0 + w);                    // baseline
    const la = [0.18, 0.26, 0.21, 0.33, 0.3, 0.38], lb = [0.1, 0.14, 0.2, 0.17, 0.25, 0.28];
    la.forEach((v, i) => { if (i) chartA.push(x, y0 + la[i - 1], z0 + ((i - 1) / 5) * w, x, y0 + v, z0 + (i / 5) * w); });
    lb.forEach((v, i) => { if (i) chartB.push(x, y0 + lb[i - 1], z0 + ((i - 1) / 5) * w, x, y0 + v, z0 + (i / 5) * w); });
  };
  const workstation = (xd, zd) => {
    chart(xd, zd);
    office.box(0.7, 0.01, 1.05, [xd, 0.855, zd], undefined, 0.004);                      // desk top
    [-0.5, 0.5].forEach((dz) => office.box(0.62, 0.7, 0.03, [xd, 0.47, zd + dz], undefined, 0.01));
    office.box(0.05, 0.26, 0.05, [xd - 0.2, 1.02, zd], undefined, 0.015);              // neck
    office.box(0.03, 0.44, 0.72, [xd - 0.2, 1.32, zd], undefined, 0.01);               // screen
    const cx = xd + 0.9;                                                               // chair
    office.cyl(0.21, 0.03, [cx, 0.15, zd], undefined, 0.01);
    office.box(0.44, 0.03, 0.46, [cx, 0.5, zd], undefined, 0.01);
    office.box(0.03, 0.46, 0.44, [cx + 0.2, 0.8, zd], [0, 0, -0.12], 0.01);
  };
  [-1.35, 0.35].forEach((xd) => [2.8, 3.9].forEach((zd) => workstation(xd, zd)));
  // 2-storey block: flat roof with parapet, strip windows, entrance with canopy
  const bx = (HALL.x0 + HALL.x1) / 2, bw = HALL.x1 - HALL.x0, bz = (BLK.z0 + BLK.z1) / 2, bd = BLK.z1 - BLK.z0, xf = HALL.x1 + 0.055;
  office.box(bw, BLK.h, bd, [bx, 0.12 + BLK.h / 2, bz], undefined, 0.03);
    [2.0, 2.7].forEach((y) => office.rectX(xf, bz, y, 1.3, 0.42));                         // strip windows (upper floor)
  office.rectX(xf, bz - 0.1, 0.78, 0.7, 1.3);   // entrance door
  office.box(0.47, 0.01, 1.3, [HALL.x1 + 0.235, 1.65, bz - 0.1], undefined, 0.004);          // entrance canopy
  [-0.65, 0.45].forEach((dz) => office.box(0.05, 1.5, 0.05, [HALL.x1 + 0.44, 0.87, bz - 0.1 + dz * 0.95], undefined, 0.01));
  office.build(MT);
  world.add(office.group);
  const charts = [chartA, chartB, chartBars].map((pts) => { const o = segs(pts, ink); o.visible = false; world.add(o); return o; });

  // ---------- (b) logistics hall: flat roof with parapet, hatches and ribs, cladding lines, high strip windows, dock shelters with sectional gates ----------
  const wh = new Part();
  const hx = (HALL.x0 + HALL.x1) / 2, hw = HALL.x1 - HALL.x0, hz = (HALL.z0 + HALL.z1) / 2, hd = HALL.z1 - HALL.z0, hy = HALL.h;
  wh.box(hw, hy, hd, [hx, 0.12 + hy / 2, hz], undefined, 0.03);
    const roofY = 0.12 + hy;
  [[-1.1, -3.3], [-1.1, -1.0]].forEach(([x, z]) => wh.box(0.6, 0.2, 0.6, [x, roofY + 0.1, z], undefined, 0.03));   // roof hatches
  wh.box(0.5, 0.35, 0.5, [0.6, roofY + 0.18, -2.3], undefined, 0.03);              // vent block
  const xw = HALL.x1 + 0.055, zw = HALL.z1 + 0.055;
  for (const y of [0.9, 2.3]) { wh.line([[xw, y, HALL.z0 + 0.05], [xw, y, HALL.z1 - 0.05]]); wh.line([[HALL.x0 + 0.05, y, zw], [HALL.x1 - 0.05, y, zw]]); } // two cladding bands
  for (let z = HALL.z0 + 0.5; z < HALL.z1 - 0.3; z += 1.0) wh.rectX(xw, z, 3.2, 0.3, 0.4);    // high narrow windows (dock side)
  for (let x = HALL.x0 + 0.6; x < HALL.x1 - 0.3; x += 1.1) wh.rectZ(zw, x, 3.2, 0.3, 0.4);    // (front end)
  const xs = HALL.x1 + SHELTER + 0.075;
  DOCKS.forEach((zg) => {
    wh.box(SHELTER, 1.85, 1.0, [HALL.x1 + SHELTER / 2 + 0.02, 0.12 + 0.925, zg], undefined, 0.03);   // dock shelter
    wh.rectX(xs, zg, 0.87, 0.85, 1.5);
  });
  const GATES = { 2: { closed: [], open: [] }, 3: { closed: [], open: [] } };   // docks 2 (shipping) and 3 (receiving from the block) can open
  DOCKS.forEach((zg, i) => {
    const g = GATES[i], seg = (y) => [xs, y, zg - 0.425, xs, y, zg + 0.425];
    if (g) { g.closed.push(...seg(0.87)); g.open.push(...seg(1.45)); } else wh.edge.push(...seg(0.87));
  });
  [2, 3].forEach((i) => { wh.addExtra('c' + i, GATES[i].closed); wh.addExtra('o' + i, GATES[i].open); });
  wh.build(M);
  world.add(wh.group);
  const gate = (i, on) => { wh.extraObj['o' + i].visible = on; wh.extraObj['c' + i].visible = !on; };

  // ---------- (c) truck: cab, trailer, wheels; cab faces +x ----------
  // body = extruded side profiles (x-y, across z): the outline of each profile is the ONLY line of that side, so wheel arches are real notches in the board contour
  const truck = new Part();
  const arcP = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const quadP = (p0, c, p1, n, from = 1) => { const o = []; for (let i = from; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } return o; };
  const bezP = (p0, c1, c2, p3, n, t0 = 0) => { const o = []; for (let i = Math.round(t0 * n) || 1; i <= n; i++) { const t = i / n, u = 1 - t; o.push([0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k])); } return o; };
  const WR = 0.27, ARC_R = 0.34, BODY_Y = 0.45;   // wheel radius, arch radius (wheel + 0.07: the gap reads as a clear arc), underside of the body
  const archP = (cx) => { const dy = BODY_Y - WR, al = Math.atan2(dy, Math.sqrt(ARC_R * ARC_R - dy * dy)); return arcP(cx, WR, ARC_R, Math.PI - al, al, 26); };   // left -> right over the wheel
  const rrect = (x0, y0, x1, y1, r, n = 3) => [...arcP(x1 - r, y0 + r, r, -Math.PI / 2, 0, n), ...arcP(x1 - r, y1 - r, r, 0, Math.PI / 2, n), ...arcP(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, n), ...arcP(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, n)];
  const prof = (pts, d) => { const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth: d, bevelEnabled: false, curveSegments: 1 }); g.translate(0, 0, -d / 2); truck.solid(g, [0, 0, 0]); };
  const AX_F = 1.12, AX_R = [-1.42, -0.67];                                              // front axle under the cab, rear tandem under the trailer
  const TW = 0.95, CW = 0.92;                                                            // trailer / cab width (z)
  truck.box(3.2, 0.1, 0.8, [-0.15, 0.4, 0], undefined, 0.03);                            // chassis
  // trailer: smooth box, softly rounded top corners (r 0.07), two arches over the tandem
  const TR = 0.07;
  prof([[-1.8, BODY_Y], ...AX_R.flatMap(archP), [0.7, BODY_Y], ...arcP(0.7 - TR, 1.55 - TR, TR, 0, Math.PI / 2, 4), ...arcP(-1.8 + TR, 1.55 - TR, TR, Math.PI / 2, Math.PI, 4)], TW);
  // end edges of the trailer roof: the rounded top corners are smooth (below EDGE_ANGLE), so their cross-width crease is drawn explicitly at the middle of each arc
  [[-1.8 + TR, 3 * Math.PI / 4], [0.7 - TR, Math.PI / 4]].forEach(([cx, a]) => { const x = cx + TR * Math.cos(a), y = 1.55 - TR + TR * Math.sin(a); truck.line([[x, y, -TW / 2], [x, y, TW / 2]]); });
  // cab: arch over the front wheel, vertical face, smooth hood curve, raked windscreen, rounded roof front
  const hood = [[1.66, 0.78], [1.66, 0.93], [1.5, 1.0], [1.32, 1.02]];
  const cab = [[0.76, BODY_Y], ...archP(AX_F), [1.66, BODY_Y], [1.66, 0.78], ...bezP(...hood, 10), [1.13, 1.375], ...quadP([1.13, 1.375], [1.085, 1.44], [1.0, 1.44], 6), [0.84, 1.44], ...quadP([0.84, 1.44], [0.76, 1.44], [0.76, 1.37], 4)];
  prof(cab, CW);
  prof([[0.74, 1.44], [0.74, 1.6], ...quadP([0.74, 1.6], [0.95, 1.62], [1.1, 1.44], 6)], 0.8);   // roof deflector (wedge)
  prof(rrect(1.58, 0.44, 1.7, 0.6, 0.05), 0.97);                                          // rounded bumper
  prof([[1.4, 0.44], [1.5, 0.365], [1.64, 0.365], [1.7, 0.4], [1.7, 0.44]], 0.76);        // lower spoiler
  truck.box(0.1, 0.1, 0.9, [-1.84, 0.45, 0], undefined, 0.03);                           // rear bar
  truck.cyl(0.04, 0.7, [0.79, 1.1, 0.5], undefined, 0.01);                               // exhaust stack behind the cab
  [AX_F, ...AX_R].forEach((x) => [-0.385, 0.385].forEach((z) => {
    truck.cyl(WR, 0.2, [x, WR, z], [Math.PI / 2, 0, 0], 0.012);
    truck.cyl(0.12, 0.24, [x, WR, z], [Math.PI / 2, 0, 0], 0.01);
  }));
  // cab details: key cross lines of the nose, windscreen on the slope, side window, headlights + grille, mirror; two trailer ribs
  const hm = bezP(...hood, 10).find((_, i) => i === 4), rm = quadP([1.13, 1.375], [1.085, 1.44], [1.0, 1.44], 6)[2];
  [hm, rm].forEach(([x, y]) => truck.line([[x, y, -CW / 2], [x, y, CW / 2]]));
  truck.line([[1.304, 1.058, -0.38], [1.304, 1.058, 0.38], [1.154, 1.328, 0.38], [1.154, 1.328, -0.38], [1.304, 1.058, -0.38]]);
  [-1, 1].forEach((k) => {
    const z = k * (CW / 2 + 0.002);
    truck.line([[0.84, 1.04, z], [1.28, 1.04, z], [1.115, 1.34, z], [0.84, 1.34, z], [0.84, 1.04, z]]);
    truck.line([[1.18, 1.12, k * CW / 2], [1.18, 1.12, k * 0.55]]); truck.line([[1.18, 1.2, k * 0.55], [1.18, 1.02, k * 0.55]]);   // mirror: arm + glass
    truck.line([[-1.75, 1.2, k * TW / 2], [0.65, 1.2, k * TW / 2]]);                    // trailer ribs
    truck.line([[-1.75, 0.9, k * TW / 2], [0.65, 0.9, k * TW / 2]]);
  });
  [-0.31, 0.31].forEach((z) => truck.rectX(1.662, z, 0.69, 0.16, 0.08));                  // headlights
  truck.rectX(1.662, 0, 0.69, 0.3, 0.14);                                                 // grille
  truck.build(MT);
  truck.group.scale.setScalar(0.75);
  world.add(truck.group);

  // ---------- flows: one route line per stage (thin dashed accent line, no arrows) ----------
  const wzr = wzc + 0.05, doorX = HALL.x1 + 0.2;                // office entrance (open side of the wing), block entrance
  const xs0 = HALL.x1 + SHELTER + 0.075, bzd = bz - 0.1;
  const flow1 = [[-3.8, 0.02, 5.4], [2.8, 0.02, 5.4], [2.8, 0.02, wzr], [doorX, 0.02, wzr]];   // from the left corner of the floor to the office entrance
  const flow2 = [[doorX, 0.02, wzr], [2.8, 0.02, wzr], [2.8, 0.02, bzd], [HALL.x1 + 0.8, 0.02, bzd]];   // office -> block
  const flow3 = [[HALL.x1 + 0.8, 0.02, bzd], [2.95, 0.02, bzd], [2.95, 0.02, DOCKS[3]], [xs0 + 0.55, 0.02, DOCKS[3]]];   // block -> warehouse gate (dock 3)
  const TRUCK_X = 5.55, REAR = TRUCK_X - 1.42;                  // truck parked on the road at dock 2, rear toward the gate
  const BX = [xs0 + 0.45, xs0 + 1.0, xs0 + 1.55];                 // 3 big boxes staged in front of the open gate (dock 2)
  const flow4 = [[xs0 + 0.2, 0.02, ROAD_Z], [REAR + 0.1, 0.02, ROAD_Z]];
  const mkRoute = (poly) => { const g = new Group(); g.add(dashSegs(pl(poly))); g.visible = false; world.add(g); return g; };
  const routes = [flow1, flow2, flow3, flow4].map(mkRoute);
  const dot = new Mesh(new SphereGeometry(0.13, 18, 12), dotMat);
  world.add(dot);
  const mkBox = () => {   // box = outline + tape line; one Part each so it can be filled white and moved independently
    const b = new Part();
    b.box(0.42, 0.32, 0.36, [0, 0.16, 0], undefined, 0.04);
    b.rectZ(0.19, 0, 0.16, 0.2, 0.16); b.line([[-0.21, 0.32, 0], [0.21, 0.32, 0]]);
    b.build(M); b.set(true); b.group.visible = false; world.add(b.group);
    return b;
  };
  const parcel = mkBox();                         // small box (stage 2), the same box at scale 2 (stage 3)
  const big = [mkBox(), mkBox(), mkBox()];        // 3 boxes of the shipment (stage 4), scale 1.4
  big.forEach((b) => b.group.scale.setScalar(1.4));
  const along = (pts, t) => {
    const Ls = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]); Ls.push(d); tot += d; }
    let s = clamp01(t) * tot;
    for (let i = 0; i < Ls.length; i++) {
      if (s <= Ls[i]) { const k = s / Ls[i]; return [0, 1, 2].map((j) => pts[i][j] + (pts[i + 1][j] - pts[i][j]) * k); }
      s -= Ls[i];
    }
    return pts[pts.length - 1];
  };

  const camera = new OrthographicCamera(-1, 1, 1, -1, 12, 50);
  // static camera aimed at the CENTRE OF THE FLOOR (0, 0, 0): the floor diamond is centred in the canvas; no pixel / bbox shifting
  const target = V(0, 0, 0);
  camera.position.copy(target).addScaledVector(VIEW, 30);
  camera.lookAt(target);
  const footC = { x: (FOOT.x0 + FOOT.x1) / 2 + SHIFT.x, z: (FOOT.z0 + FOOT.z1) / 2 + SHIFT.z };
  host.sceneLayout = { foot: { x0: FOOT.x0 + SHIFT.x, x1: FOOT.x1 + SHIFT.x, z0: FOOT.z0 + SHIFT.z, z1: FOOT.z1 + SHIFT.z }, ground: GROUND, footCentre: footC, floorCentre: { x: 0, z: 0 }, camera, target };
  console.info('[process-3d] footprint x', FOOT.x0, FOOT.x1, 'z', FOOT.z0, FOOT.z1, 'centre', footC.x.toFixed(3), footC.z.toFixed(3), 'floor centre 0,0');

  // projected vertical extent (camera view-space y) of the bbox corners of the floor, the buildings (roof + vent) and the truck
  camera.updateMatrixWorld(true);
  const extentPts = [];
  [-GROUND, GROUND].forEach((x) => [-GROUND, GROUND].forEach((z) => extentPts.push(V(x, 0, z))));
  truck.group.position.set(TRUCK_X, 0, ROAD_Z);
  world.updateMatrixWorld(true);
  // REAL vertices of every building / truck / environment solid (roof hatches and vent included), in scene coordinates
  [env, office, wh, truck].forEach((part) => {
    const pos = part.occMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) extentPts.push(V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(part.occMesh.matrixWorld));
  });
  const viewY = extentPts.map((p) => p.clone().applyMatrix4(camera.matrixWorldInverse).y);
  const extentMid = (Math.max(...viewY) + Math.min(...viewY)) / 2;
  host.sceneLayout.extent = { top: Math.max(...viewY), bottom: Math.min(...viewY), mid: extentMid };

  // ---------- stage animations: time-based, played once on entering the stage, the last frame is held ----------
  const DUR = [4.8, 2.8, 3.2, 5.4];                // seconds per stage (stage 1: dot 2.6 + charts)
  const ph = (e, a, b) => smooth(clamp01((e - a) / (b - a)));   // eased 0..1 between a and b seconds
  let stageShown = 0, t0 = 0, progress = 0, visible = false, lost = false, raf = 0;
  const apply = () => {
    const final = reduced.matches;
    const stage = final ? 4 : Math.min(4, Math.floor(progress * 4) + 1);
    if (stage !== stageShown) { stageShown = stage; t0 = performance.now(); }
    const e = final ? 1e3 : (performance.now() - t0) / 1000;
    office.set(final || stage <= 2);
    wh.set(final || stage >= 3);
    truck.set(final || stage === 4);
    routes.forEach((r, i) => { r.visible = !final && stage === i + 1; });
    // clean reset: every stage-specific object is hidden first, then only the active stage shows its own
    dot.visible = false; parcel.group.visible = false; big.forEach((b) => { b.group.visible = false; });
    gate(2, final || stage === 4); gate(3, !final && stage === 3);
    truck.group.position.set(TRUCK_X, 0, ROAD_Z);
    const done = [ph(e, 3.0, 3.6), ph(e, 3.6, 4.2), ph(e, 4.2, 4.8)];   // stage 1: baseline+line A, line B, bars
    charts.forEach((c, i) => { c.visible = stage === 1 && done[i] > 0.5; });
    if (stage === 1) {
      const k = ph(e, 0.2, 2.8);
      dot.visible = k < 1;
      if (dot.visible) { const q = along(flow1, k); dot.position.set(q[0], 0.14, q[2]); }
    } else if (stage === 2) {
      const q = along(flow2, ph(e, 0.2, 2.6));
      parcel.group.visible = true; parcel.group.scale.setScalar(1); parcel.group.position.set(q[0], 0.02, q[2]);
    } else if (stage === 3) {
      const q = along(flow3, ph(e, 0.2, 3.0));
      parcel.group.visible = true; parcel.group.scale.setScalar(2); parcel.group.position.set(q[0], 0.02, q[2]);
    } else if (stage === 4) {
      // box 2 (nearest the truck) goes first, then 1, then 0; each slides to the rear of the trailer, lifts and rolls in (hidden by the trailer)
      big.forEach((b, i) => {
        const order = 2 - i, k = ph(final ? 1e3 : e, 0.5 + order * 1.5, 2.1 + order * 1.5);
        const tx = REAR + 0.5 + (2 - order) * 0.55;
        const x = BX[i] + (tx - BX[i]) * k, lift = ph(x, REAR - 0.3, REAR + 0.1);
        b.group.visible = true;
        b.group.position.set(x, 0.02 + lift * 0.4, ROAD_Z);
      });
    }
  };

  const frame = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    const aspect = w / h;
    const halfH = Math.max(FIT_H / 2, FIT_W / 2 / aspect), halfW = halfH * aspect;
    // vertical centring of the whole composition: the projected extent (floor + buildings + truck) is centred in the canvas (same top / bottom margin)
    Object.assign(camera, { left: -halfW, right: halfW, top: halfH + extentMid, bottom: -halfH + extentMid });
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    mats.forEach((m) => { m.resolution.set(w * pr, h * pr); m.linewidth = m.userData.px * pr; });
    return true;
  };
  const draw = () => {
    if (lost || !frame()) return;
    apply();
    renderer.render(scene, camera);
    host.classList.add('is-3d');
    cancelAnimationFrame(raf);
    // keep rendering only while the active stage animation is still playing
    if (!reduced.matches && (visible || host.isConnected) && !document.hidden && (performance.now() - t0) / 1000 < DUR[stageShown - 1] + 0.1) raf = requestAnimationFrame(draw);
  };
  const resize = () => {
    renderer.setPixelRatio(capDpr(2));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    draw();
  };
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) draw(); }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
  reduced.addEventListener('change', draw);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; host.classList.remove('is-3d'); });

  try { resize(); } catch { canvas.remove(); return null; }
  // scroll-driven: render on demand (no continuous loop)
  return { setProgress(p) { progress = clamp01(p); if (visible || reduced.matches) draw(); }, draw };
}
