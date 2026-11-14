// Services page, Process block: the SAME scene as before the restyle (one commercial complex: office wing with 4 workstations + 2-storey block + logistics hall with 4 dock gates,
// a road with a truck, the same 30deg isometric camera), restyled to the site illustration language (src/utils/il-scene.js): ONE WebGL context, native 1 device-px lines,
// DOTS at vertices, the shared floor DOT FIELD under the objects (kit.floor(), FLOOR_Y / FLOOR_LIFT), NO dashes (routes = solid thin line + dot nodes), colours = local --il-* tokens.
// Stages (driven by setProgress 0..1 from services.js, each stage plays ONE time-based animation and holds its last frame):
// 1 request: dot travels along the route to the office entrance, charts appear on the monitors (office filled);
// 2 sourcing and samples: a small box office -> block entrance (office filled);
// 3 qualification: the box (x2) block -> dock gate 3, the gate opens (hall filled);
// 4 regular supply: dock 2 opens, truck parked at the road, 3 boxes slide to the trailer and are loaded (hall + truck filled).
// Reduced motion = static frame of stage 4. Units below are the ORIGINAL scene units (floor +-6); the whole scene is scaled by S to the engine floor field (+-140).
import {
  Matrix4, Quaternion, Euler, Vector2, Vector3, Shape, ExtrudeGeometry, CylinderGeometry, BoxGeometry, EdgesGeometry, MathUtils, LineBasicMaterial, OrthographicCamera,
  Mesh, LineSegments, Points, Group, BufferGeometry, Float32BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createIlScene } from '../utils/il-scene.js';

const PERIOD = 12;
const PITCH = MathUtils.degToRad(30);          // original camera: yaw 45deg, pitch 30deg
const S = 140 / 6;                              // scene units -> engine world units (floor field +-140 = +-6 units)
const CENTRE_DY = 5;                           // world-unit lift of the whole scene (identical in all stages)
const EDGE_ANGLE = 28;
const HALL = { x0: -2.0, x1: 1.55, z0: -4.5, z1: 0.5, h: 3.7 };
const OFF = { z0: 2.1, z1: 4.5 };
const BLK = { z0: 0.5, z1: 2.1, h: 3.1 };
const DOCKS = [-3.7, -2.6, -1.5, -0.4];
const ROAD_Z = DOCKS[2], SHELTER = 0.45, ROAD_END = 6;
const SHIFT = { x: -1.5, z: 0 };
const VIS_DX = 29.4;                            // screen-x shift in fit units (px / u): centres the SOLID ink (building + truck + floor line) on the box axis = page axis x = W/2 at every width (customer 2026-11-14)
const FOOT = { x0: HALL.x0, x1: HALL.x1 + 0.02 + SHELTER, z0: HALL.z0, z1: OFF.z1 };
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ph = (e, a, b) => smooth(clamp01((e - a) / (b - a)));
const V = (x, y, z) => new Vector3(x, y, z);
const VIEW = V(Math.SQRT1_2 * Math.cos(PITCH), Math.sin(PITCH), Math.SQRT1_2 * Math.cos(PITCH)).normalize();
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

// the original 30deg isometric camera (not the 35.26deg one of il-scene's isoCamera): same ratios, floor diamond = 87% of the canvas width
const procCamera = ({ spanW = 455, spanH = 257 } = {}) => ({
  create: () => { const c = new OrthographicCamera(-1, 1, 1, -1, 400, 1400); c.position.copy(VIEW).multiplyScalar(866); c.lookAt(0, 0, 0); return c; },
  fit: (c, it) => {
    const u = Math.min(it.W / it.d / spanW, it.H / it.d / spanH);
    const hw = it.W / it.d / (2 * u), hh = it.H / it.d / (2 * u);
    c.left = -hw - VIS_DX; c.right = hw - VIS_DX; c.top = hh; c.bottom = -hh; c.updateProjectionMatrix();
  },
});

export function initProcessScene(host) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let progress = 0, shown = 0, t0 = 0;
  const ownMats = [];

  const SCENES = {
    process: (K) => {
      const probe = document.createElement('span'); probe.style.display = 'none'; host.appendChild(probe);
      probe.style.backgroundColor = 'var(--il-ink)';
      const inkCss = getComputedStyle(probe).backgroundColor; probe.remove();
      const INK = inkCss && inkCss !== 'rgba(0, 0, 0, 0)' ? new K.Color(inkCss) : K.bg.clone();
      const inkLine = new LineBasicMaterial({ color: INK }); ownMats.push(inkLine);
      const offLine = K.lineMat(0.6), routeMat = K.lineMat(0.85);
      const inkDot = K.dotMat(K.DOT_PX, INK), offDot = K.dot.soft;

      class Part {
        constructor() { this.group = new Group(); this.occ = []; this.edge = []; this.dpts = []; this.extra = {}; }
        mat(p, r = [0, 0, 0]) { return new Matrix4().compose(V(...p), new Quaternion().setFromEuler(new Euler(...r)), V(1, 1, 1)); }
        solid(geo, p, r) {
          const m = this.mat(p, r);
          const og = geo.index ? geo.toNonIndexed() : geo.clone();
          og.deleteAttribute('normal'); og.deleteAttribute('uv'); og.applyMatrix4(m); this.occ.push(og);
          const eg = new EdgesGeometry(geo, EDGE_ANGLE); eg.applyMatrix4(m); this.edge.push(...eg.attributes.position.array); eg.dispose(); geo.dispose();
        }
        box(w, h, d, p, r, dots = false) {
          this.solid(new BoxGeometry(w, h, d), p, r);
          if (dots) { const m = this.mat(p, r); K.corners(w, h, d).forEach((c) => { const v = V(...c).applyMatrix4(m); this.dpts.push([v.x, v.y, v.z]); }); }
        }
        cyl(radius, h, p, r = [0, 0, 0]) {
          this.solid(new CylinderGeometry(radius, radius, h, 24), p, r);
          const q = new Quaternion().setFromEuler(new Euler(...r));
          const axis = V(0, 1, 0).applyQuaternion(q);
          const s = axis.clone().cross(VIEW).normalize().multiplyScalar(radius);
          const c = V(...p), a = axis.clone().multiplyScalar(h / 2);
          [1, -1].forEach((k) => { const lo = c.clone().sub(a).addScaledVector(s, k), hi = c.clone().add(a).addScaledVector(s, k); this.edge.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z); });
        }
        line(pts, into = this.edge) { for (let i = 1; i < pts.length; i++) into.push(...pts[i - 1], ...pts[i]); }
        rectX(x, zc, yc, w, h) { const a = zc - w / 2, b = zc + w / 2, c = yc - h / 2, d = yc + h / 2; this.line([[x, c, a], [x, c, b], [x, d, b], [x, d, a], [x, c, a]]); }
        rectZ(z, xc, yc, w, h) { const a = xc - w / 2, b = xc + w / 2, c = yc - h / 2, d = yc + h / 2; this.line([[a, c, z], [b, c, z], [b, d, z], [a, d, z], [a, c, z]]); }
        addExtra(name, pts) { this.extra[name] = pts; }
        build() {
          const flat = (arr) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(arr, 3)); return K.track(g); };
          this.occMesh = new Mesh(K.track(mergeGeometries(this.occ)), K.occluder); this.occMesh.renderOrder = -2; this.group.add(this.occMesh);
          const dedupe = (pts) => {
            const seen = new Set(), out = []; const k = (x, y, z) => `${Math.round(x * 40)},${Math.round(y * 40)},${Math.round(z * 40)}`;
            for (let i = 0; i < pts.length; i += 6) {
              const a = k(pts[i], pts[i + 1], pts[i + 2]), b = k(pts[i + 3], pts[i + 4], pts[i + 5]); const key = a < b ? `${a}|${b}` : `${b}|${a}`;
              if (a === b || seen.has(key)) continue; seen.add(key); for (let j = 0; j < 6; j++) out.push(pts[i + j]);
            }
            return out;
          };
          const mk = (pts) => { const o = new LineSegments(flat(dedupe(pts)), offLine); o.renderOrder = 1; o.frustumCulled = false; this.group.add(o); return o; };
          this.edgeObj = mk(this.edge);
          this.extraObj = {}; Object.entries(this.extra).forEach(([k, pts]) => { this.extraObj[k] = mk(pts); });
          this.dotObj = null;
          if (this.dpts.length) { this.dotObj = new Points(flat(this.dpts.flat()), offDot); this.dotObj.renderOrder = 3; this.dotObj.frustumCulled = false; this.group.add(this.dotObj); }
          return this;
        }
        set(on) {
          if (this.on === on) return; this.on = on;
          this.occMesh.material = on ? K.fillMat : K.occluder; this.occMesh.renderOrder = on ? 0 : -2;   // hole-occluders first, so a nearer inactive body hides the white fill behind it
          this.edgeObj.material = on ? inkLine : offLine;
          Object.values(this.extraObj).forEach((o) => { o.material = on ? inkLine : offLine; });
          if (this.dotObj) this.dotObj.material = on ? inkDot : offDot;
        }
      }

      const root = new K.Group(); root.position.y = K.FLOOR_Y + K.FLOOR_LIFT + CENTRE_DY;
      root.add(K.floor());                         // the shared floor dot field, UNDER the objects
      const sc = new Group(); sc.scale.setScalar(S); root.add(sc);
      const world = new Group(); world.position.set(SHIFT.x, 0, SHIFT.z); sc.add(world);
      const rectXZ = (x0, x1, z0, z1) => [[x0, 0.012, z0], [x1, 0.012, z0], [x1, 0.012, z1], [x0, 0.012, z1]];
      void rectXZ;
      const seg = (pts, m) => { const o = new LineSegments(K.track(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts.flat(), 3))), m); o.renderOrder = 1; o.frustumCulled = false; return o; };
      const pairs = (poly) => { const a = []; for (let i = 1; i < poly.length; i++) a.push(poly[i - 1], poly[i]); return a; };

      // ---- environment: plinth, road (solid kerb lines), pallets ----
      const env = new Part();
      env.box(FOOT.x1 - FOOT.x0 + 0.2, 0.12, FOOT.z1 - FOOT.z0 + 0.2, [(FOOT.x0 + FOOT.x1) / 2, 0.06, (FOOT.z0 + FOOT.z1) / 2], undefined, true);
      const xr = HALL.x1 + SHELTER + 0.2;
      world.add(seg([[xr, 0.012, ROAD_Z - 0.95], [ROAD_END, 0.012, ROAD_Z - 0.95], [xr, 0.012, ROAD_Z + 0.95], [ROAD_END, 0.012, ROAD_Z + 0.95], [xr, 0.012, ROAD_Z - 0.95], [xr, 0.012, ROAD_Z + 0.95]], offLine));
      const pallet = (x, z, n) => { env.box(0.85, 0.09, 0.85, [x, 0.045, z]); env.box(0.62, 0.42, 0.62, [x, 0.3, z]); if (n > 1) env.box(0.5, 0.32, 0.5, [x + 0.02, 0.67, z]); };
      pallet(-3.4, -1.6, 2); pallet(-3.6, -3.2, 1);
      env.build().set(false); world.add(env.group);

      // ---- (a) office: cut-away wing with 4 workstations + 2-storey block ----
      const office = new Part();
      const wzc = (OFF.z0 + OFF.z1) / 2;
      office.box(0.03, 1.7, OFF.z1 - OFF.z0, [HALL.x0 + 0.015, 0.97, wzc]);
      const chartBars = [], chartA = [], chartB = [];
      const chart = (xd, zd) => {
        const x = xd - 0.2 + 0.02, z0 = zd - 0.28, w = 0.56, y0 = 1.16;
        [0.12, 0.2, 0.15, 0.27, 0.22].forEach((h, i) => { const z = z0 + 0.05 + i * 0.11; chartBars.push(x, y0, z, x, y0 + h, z); });
        chartA.push(x, y0 + 0.02, z0, x, y0 + 0.02, z0 + w);
        const la = [0.18, 0.26, 0.21, 0.33, 0.3, 0.38], lb = [0.1, 0.14, 0.2, 0.17, 0.25, 0.28];
        la.forEach((v, i) => { if (i) chartA.push(x, y0 + la[i - 1], z0 + ((i - 1) / 5) * w, x, y0 + v, z0 + (i / 5) * w); });
        lb.forEach((v, i) => { if (i) chartB.push(x, y0 + lb[i - 1], z0 + ((i - 1) / 5) * w, x, y0 + v, z0 + (i / 5) * w); });
      };
      const workstation = (xd, zd) => {
        chart(xd, zd);
        office.box(0.7, 0.01, 1.05, [xd, 0.855, zd]);
        [-0.5, 0.5].forEach((dz) => office.box(0.62, 0.7, 0.03, [xd, 0.47, zd + dz]));
        office.box(0.05, 0.26, 0.05, [xd - 0.2, 1.02, zd]);
        office.box(0.03, 0.44, 0.72, [xd - 0.2, 1.32, zd]);
        const cx = xd + 0.9;
        office.cyl(0.21, 0.03, [cx, 0.15, zd]);
        office.box(0.44, 0.03, 0.46, [cx, 0.5, zd]);
        office.box(0.03, 0.46, 0.44, [cx + 0.2, 0.8, zd], [0, 0, -0.12]);
      };
      [-1.35, 0.35].forEach((xd) => [2.8, 3.9].forEach((zd) => workstation(xd, zd)));
      const bx = (HALL.x0 + HALL.x1) / 2, bw = HALL.x1 - HALL.x0, bz = (BLK.z0 + BLK.z1) / 2, bd = BLK.z1 - BLK.z0, xf = HALL.x1 + 0.055;
      office.box(bw, BLK.h, bd, [bx, 0.12 + BLK.h / 2, bz], undefined, true);
      [2.0, 2.7].forEach((y) => office.rectX(xf, bz, y, 1.3, 0.42));
      office.rectX(xf, bz - 0.1, 0.78, 0.7, 1.3);
      office.box(0.47, 0.01, 1.3, [HALL.x1 + 0.235, 1.65, bz - 0.1]);
      [-0.65, 0.45].forEach((dz) => office.box(0.05, 1.5, 0.05, [HALL.x1 + 0.44, 0.87, bz - 0.1 + dz * 0.95]));
      office.build(); world.add(office.group);
      const charts = [chartA, chartB, chartBars].map((pts) => { const o = new LineSegments(K.track(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3))), inkLine); o.renderOrder = 2; o.frustumCulled = false; o.visible = false; world.add(o); return o; });

      // ---- (b) logistics hall: flat roof with hatches + vent, cladding bands, high windows, 4 dock shelters with gates ----
      const wh = new Part();
      const hx = (HALL.x0 + HALL.x1) / 2, hw = HALL.x1 - HALL.x0, hz = (HALL.z0 + HALL.z1) / 2, hd = HALL.z1 - HALL.z0, hy = HALL.h;
      wh.box(hw, hy, hd, [hx, 0.12 + hy / 2, hz], undefined, true);
      const roofY = 0.12 + hy;
      [[-1.1, -3.3], [-1.1, -1.0]].forEach(([x, z]) => wh.box(0.6, 0.2, 0.6, [x, roofY + 0.1, z], undefined, true));
      wh.box(0.5, 0.35, 0.5, [0.6, roofY + 0.18, -2.3], undefined, true);
      const xw = HALL.x1 + 0.055, zw = HALL.z1 + 0.055;
      for (const y of [0.9, 2.3]) { wh.line([[xw, y, HALL.z0 + 0.05], [xw, y, HALL.z1 - 0.05]]); wh.line([[HALL.x0 + 0.05, y, zw], [HALL.x1 - 0.05, y, zw]]); }
      for (let z = HALL.z0 + 0.5; z < HALL.z1 - 0.3; z += 1.0) wh.rectX(xw, z, 3.2, 0.3, 0.4);
      for (let x = HALL.x0 + 0.6; x < HALL.x1 - 0.3; x += 1.1) wh.rectZ(zw, x, 3.2, 0.3, 0.4);
      const xs = HALL.x1 + SHELTER + 0.075;
      DOCKS.forEach((zg) => { wh.box(SHELTER, 1.85, 1.0, [HALL.x1 + SHELTER / 2 + 0.02, 0.12 + 0.925, zg], undefined, true); wh.rectX(xs, zg, 0.87, 0.85, 1.5); });
      const GATES = { 2: { closed: [], open: [] }, 3: { closed: [], open: [] } };
      DOCKS.forEach((zg, i) => { const g = GATES[i], sg = (y) => [xs, y, zg - 0.425, xs, y, zg + 0.425]; if (g) { g.closed.push(...sg(0.87)); g.open.push(...sg(1.45)); } else wh.edge.push(...sg(0.87)); });
      [2, 3].forEach((i) => { wh.addExtra(`c${i}`, GATES[i].closed); wh.addExtra(`o${i}`, GATES[i].open); });
      wh.build(); world.add(wh.group);
      const gate = (i, on) => { wh.extraObj[`o${i}`].visible = on; wh.extraObj[`c${i}`].visible = !on; };

      // ---- (c) truck: cab, trailer, wheels; cab faces +x ----
      const truck = new Part();
      const arcP = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
      const quadP = (p0, c, p1, n, from = 1) => { const o = []; for (let i = from; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } return o; };
      const bezP = (p0, c1, c2, p3, n, t0 = 0) => { const o = []; for (let i = Math.round(t0 * n) || 1; i <= n; i++) { const t = i / n, u = 1 - t; o.push([0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k])); } return o; };
      const WR = 0.27, ARC_R = 0.34, BODY_Y = 0.45;
      const archP = (cx) => { const dy = BODY_Y - WR, al = Math.atan2(dy, Math.sqrt(ARC_R * ARC_R - dy * dy)); return arcP(cx, WR, ARC_R, Math.PI - al, al, 26); };
      const rrect = (x0, y0, x1, y1, r, n = 3) => [...arcP(x1 - r, y0 + r, r, -Math.PI / 2, 0, n), ...arcP(x1 - r, y1 - r, r, 0, Math.PI / 2, n), ...arcP(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, n), ...arcP(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, n)];
      const prof = (pts, d) => { const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth: d, bevelEnabled: false, curveSegments: 1 }); g.translate(0, 0, -d / 2); truck.solid(g, [0, 0, 0]); };
      const AX_F = 1.12, AX_R = [-1.42, -0.67], TW = 0.95, CW = 0.92;
      truck.box(3.2, 0.1, 0.8, [-0.15, 0.4, 0]);
      const TR = 0.07;
      prof([[-1.8, BODY_Y], ...AX_R.flatMap(archP), [0.7, BODY_Y], ...arcP(0.7 - TR, 1.55 - TR, TR, 0, Math.PI / 2, 4), ...arcP(-1.8 + TR, 1.55 - TR, TR, Math.PI / 2, Math.PI, 4)], TW);
      [[-1.8 + TR, 3 * Math.PI / 4], [0.7 - TR, Math.PI / 4]].forEach(([cx, a]) => { const x = cx + TR * Math.cos(a), y = 1.55 - TR + TR * Math.sin(a); truck.line([[x, y, -TW / 2], [x, y, TW / 2]]); });
      const hood = [[1.66, 0.78], [1.66, 0.93], [1.5, 1.0], [1.32, 1.02]];
      prof([[0.76, BODY_Y], ...archP(AX_F), [1.66, BODY_Y], [1.66, 0.78], ...bezP(...hood, 10), [1.13, 1.375], ...quadP([1.13, 1.375], [1.085, 1.44], [1.0, 1.44], 6), [0.84, 1.44], ...quadP([0.84, 1.44], [0.76, 1.44], [0.76, 1.37], 4)], CW);
      prof([[0.74, 1.44], [0.74, 1.6], ...quadP([0.74, 1.6], [0.95, 1.62], [1.1, 1.44], 6)], 0.8);
      prof(rrect(1.58, 0.44, 1.7, 0.6, 0.05), 0.97);
      prof([[1.4, 0.44], [1.5, 0.365], [1.64, 0.365], [1.7, 0.4], [1.7, 0.44]], 0.76);
      truck.box(0.1, 0.1, 0.9, [-1.84, 0.45, 0]);
      truck.cyl(0.04, 0.7, [0.79, 1.1, 0.5]);
      [AX_F, ...AX_R].forEach((x) => [-0.385, 0.385].forEach((z) => { truck.cyl(WR, 0.2, [x, WR, z], [Math.PI / 2, 0, 0]); truck.cyl(0.12, 0.24, [x, WR, z], [Math.PI / 2, 0, 0]); }));
      const hm = bezP(...hood, 10).find((_, i) => i === 4), rm = quadP([1.13, 1.375], [1.085, 1.44], [1.0, 1.44], 6)[2];
      [hm, rm].forEach(([x, y]) => truck.line([[x, y, -CW / 2], [x, y, CW / 2]]));
      truck.line([[1.304, 1.058, -0.38], [1.304, 1.058, 0.38], [1.154, 1.328, 0.38], [1.154, 1.328, -0.38], [1.304, 1.058, -0.38]]);
      [-1, 1].forEach((k) => {
        const z = k * (CW / 2 + 0.002);
        truck.line([[0.84, 1.04, z], [1.28, 1.04, z], [1.115, 1.34, z], [0.84, 1.34, z], [0.84, 1.04, z]]);
        truck.line([[1.18, 1.12, k * CW / 2], [1.18, 1.12, k * 0.55]]); truck.line([[1.18, 1.2, k * 0.55], [1.18, 1.02, k * 0.55]]);
        truck.line([[-1.75, 1.2, k * TW / 2], [0.65, 1.2, k * TW / 2]]);
        truck.line([[-1.75, 0.9, k * TW / 2], [0.65, 0.9, k * TW / 2]]);
      });
      [-0.31, 0.31].forEach((z) => truck.rectX(1.662, z, 0.69, 0.16, 0.08));
      truck.rectX(1.662, 0, 0.69, 0.3, 0.14);
      // dots at the trailer roof corners and the cab nose (vertices of the outline)
      [[-1.8 + TR, 1.55], [0.7 - TR, 1.55]].forEach(([x, y]) => [-1, 1].forEach((k) => truck.dpts.push([x, y, k * TW / 2])));
      [[1.66, 0.78], [1.66, 0.44]].forEach(([x, y]) => [-1, 1].forEach((k) => truck.dpts.push([x, y, k * CW / 2])));
      truck.build();
      truck.group.scale.setScalar(0.75);
      world.add(truck.group);

      // ---- flows: ONE solid thin route line + dot nodes per stage (no dashes, no arrows) ----
      const wzr = wzc + 0.05, doorX = HALL.x1 + 0.2, xs0 = HALL.x1 + SHELTER + 0.075, bzd = bz - 0.1;
      const flow1 = [[-3.8, 0.02, 5.4], [2.8, 0.02, 5.4], [2.8, 0.02, wzr], [doorX, 0.02, wzr]];
      const flow2 = [[doorX, 0.02, wzr], [2.8, 0.02, wzr], [2.8, 0.02, bzd], [HALL.x1 + 0.8, 0.02, bzd]];
      const flow3 = [[HALL.x1 + 0.8, 0.02, bzd], [2.95, 0.02, bzd], [2.95, 0.02, DOCKS[3]], [xs0 + 0.55, 0.02, DOCKS[3]]];
      const TRUCK_X = 5.55, REAR = TRUCK_X - 1.42;
      const BX = [xs0 + 0.45, xs0 + 1.0, xs0 + 1.55];
      const flow4 = [[xs0 + 0.2, 0.02, ROAD_Z], [REAR + 0.1, 0.02, ROAD_Z]];
      const mkRoute = (poly) => {
        const g = new Group(); g.add(seg(pairs(poly), routeMat));
        const d = new Points(K.track(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(poly.flat(), 3))), K.dot.soft); d.renderOrder = 3; d.frustumCulled = false; g.add(d);
        g.visible = false; world.add(g); return g;
      };
      const routes = [flow1, flow2, flow3, flow4].map(mkRoute);
      const dotM = K.dotMat(7, K.fill);
      const dotObj = new Points(K.track(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))), dotM); dotObj.renderOrder = 4; dotObj.frustumCulled = false; world.add(dotObj);
      const mkBox = () => {
        const b = new Part();
        b.box(0.42, 0.32, 0.36, [0, 0.16, 0], undefined, true);
        b.rectZ(0.19, 0, 0.16, 0.2, 0.16); b.line([[-0.21, 0.32, 0], [0.21, 0.32, 0]]);
        b.build().set(true); b.group.visible = false; world.add(b.group); return b;
      };
      const parcel = mkBox();
      const big = [mkBox(), mkBox(), mkBox()]; big.forEach((b) => b.group.scale.setScalar(1.4));

      return {
        root, staticPhase: 0,
        update: () => {
          const final = reduced.matches, now = performance.now() / 1000;
          const stage = final ? 4 : Math.min(4, Math.floor(progress * 4) + 1);
          if (stage !== shown) { shown = stage; t0 = now; }
          const e = final ? 1e3 : now - t0;
          office.set(stage <= 2); wh.set(stage >= 3); truck.set(stage === 4);
          routes.forEach((r, i) => { r.visible = !final && stage === i + 1; });
          dotObj.visible = false; parcel.group.visible = false; big.forEach((b) => { b.group.visible = false; });
          gate(2, stage === 4); gate(3, !final && stage === 3);
          truck.group.position.set(TRUCK_X, 0, ROAD_Z);
          const done = [ph(e, 3.0, 3.6), ph(e, 3.6, 4.2), ph(e, 4.2, 4.8)];
          charts.forEach((c, i) => { c.visible = stage === 1 && done[i] > 0.5; });
          if (stage === 1) {
            const k = ph(e, 0.2, 2.8); dotObj.visible = k < 1;
            if (dotObj.visible) { const q = along(flow1, k); dotObj.position.set(q[0], 0.14, q[2]); }
          } else if (stage === 2) {
            const q = along(flow2, ph(e, 0.2, 2.6));
            parcel.group.visible = true; parcel.group.scale.setScalar(1); parcel.group.position.set(q[0], 0.02, q[2]);
          } else if (stage === 3) {
            const q = along(flow3, ph(e, 0.2, 3.0));
            parcel.group.visible = true; parcel.group.scale.setScalar(2); parcel.group.position.set(q[0], 0.02, q[2]);
          } else {
            big.forEach((b, i) => {
              const order = 2 - i, k = ph(e, 0.5 + order * 1.5, 2.1 + order * 1.5);
              const tx = REAR + 0.5 + (2 - order) * 0.55, x = BX[i] + (tx - BX[i]) * k, lift = ph(x, REAR - 0.3, REAR + 0.1);
              b.group.visible = true; b.group.position.set(x, 0.02 + lift * 0.4, ROAD_Z);
            });
          }
        },
      };
    },
  };

  const il = createIlScene({ host, slots: [{ el: host, scene: 'process' }], scenes: SCENES, canvasClass: 'process-scroll__canvas', period: PERIOD, maxDpr: 2, camera: procCamera() });
  if (!il) return null;
  host.classList.add('is-3d');
  const redraw = () => { if (!il.running) il.draw(0, 'static'); };
  reduced.addEventListener('change', redraw);
  return {
    setProgress(p) { progress = clamp01(p); redraw(); },
    draw: redraw,
    destroy() { reduced.removeEventListener('change', redraw); il.destroy(); ownMats.forEach((m) => m.dispose()); },
  };
}
