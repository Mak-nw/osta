// About hero (light surface): the EARTH made of PARTICLES (customer decision 2026-11-13: new subject, replaces the contour sphere).
// Real continents (Natural Earth 110m land, public domain; baked by tools/gen-earth.cjs into src/data/earth-land.json — ~8k points of a Fibonacci lattice that fall on land, no runtime download):
// the ocean is empty, only flat hard-edged dots (device px, DPR-aware) outline and fill the land. HAMBURG (53.55N, 9.99E) is a very dense gaussian cloud + a core dot + a calm pulsing ring;
// from Hamburg thin great-circle ARCS (lifted above the surface, up to 0.18 R) run to world cities, small dots-"cargo" travel along them.
// Style = restyle language A3 (dots + 1 device px lines, no dashes / fills / labels / cursor parallax), ink = token --accent over --surface with depth alpha (front ~1, far side faint but visible).
// Shell / fit (smaller side of the art zone, pad 7 %, centred) / IO + visibility pause / reduced-motion static frame / capDpr / destroy() / webglcontextlost: utils/il-hero.js.
// Motion: the globe SWAYS (yaw +-35 deg around Hamburg's longitude, SWAY_PERIOD s) with a fixed axis pitch, so Hamburg / Europe never leave the frame; integer harmonics only => frame 0 == frame T.
import { initHeroScene, TAU } from '../utils/il-hero.js';
import land from '../data/earth-land.json';

const PERIOD = 48, SWAY = 35 * Math.PI / 180, PITCH = 0.32, SR = 1, LIFT = 1.003, ARC_MAX = 0.18;
const GLOBE_SCALE = 1.15, FIT_PAD = 0.07;   // customer 2026-11-13: globe +15 % (diameter). initHeroScene fits R into (0.5 - pad) * min side, so pad is derived from the scale.
const HAM = [53.55, 9.99], CLOUD = 900, CLOUD_SIGMA = 0.9, CLOUD_MAX = 2.3, RING_DEG = 4.2;
const CITIES = [[40.71, -74.01], [41.88, -87.63], [19.43, -99.13], [-23.55, -46.63], [6.52, 3.38], [-26.2, 28.05], [30.04, 31.24], [25.2, 55.27], [19.08, 72.88], [28.61, 77.21],
  [1.35, 103.82], [31.23, 121.47], [35.68, 139.69], [-33.87, 151.21], [41.01, 28.98], [-1.29, 36.82], [34.05, -118.24]];
const D2R = Math.PI / 180;
// lon 0 faces the camera (+z), east to the right (+x), north up (+y)
const xyz = (lat, lon, r = 1) => { const cl = Math.cos(lat * D2R); return [r * cl * Math.sin(lon * D2R), r * Math.sin(lat * D2R), r * cl * Math.cos(lon * D2R)]; };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function landPoints() {   // base64 little-endian Int16 pairs (lat*100, lon*100)
  const bin = atob(land.d), n = land.n, out = new Array(n);
  const i16 = (k) => { const v = bin.charCodeAt(k) | (bin.charCodeAt(k + 1) << 8); return v > 32767 ? v - 65536 : v; };
  for (let i = 0; i < n; i++) out[i] = xyz(i16(i * 4) / 100, i16(i * 4 + 2) / 100, SR * LIFT);
  return out;
}

export function initAboutHeroSphere(host) {
  return initHeroScene({
    host, period: PERIOD, staticPhase: 0, pad: 0.5 - (0.5 - FIT_PAD) * GLOBE_SCALE,
    build: (kit) => {
      const { Group } = kit;
      const root = new Group(), tilt = new Group(), spin = new Group();
      root.add(tilt); tilt.add(spin); tilt.rotation.x = PITCH;
      const hamYaw = -HAM[1] * D2R;
      const hv = xyz(HAM[0], HAM[1]);

      // faint 1 px silhouette (the limb), fixed to the screen, not part of the rotating globe
      const limb = []; for (let i = 0; i < 128; i++) { const a = i / 128 * TAU, b = (i + 1) / 128 * TAU; limb.push([Math.cos(a), Math.sin(a), 0], [Math.cos(b), Math.sin(b), 0]); }
      root.add(kit.lines(limb, { a0: 0.16, a1: 0.16 }));

      // continents: flat dots, depth alpha 1 near .. 0.28 far (back hemisphere faint but visible)
      spin.add(kit.dots(landPoints(), 1.4, { a0: 1, a1: 0.28 }));

      // Hamburg: gaussian cloud, a bit larger and brighter, a core marker, a pulsing ring
      const R = rng(5309), cloud = [];
      const lat0 = HAM[0] * D2R;
      for (let i = 0; i < CLOUD; i++) {
        let r = CLOUD_SIGMA * Math.sqrt(-2 * Math.log(1 - R() * 0.9999)); if (r > CLOUD_MAX) r = CLOUD_MAX * Math.sqrt(R());
        const a = R() * TAU;
        cloud.push(xyz(HAM[0] + r * Math.sin(a), HAM[1] + r * Math.cos(a) / Math.cos(lat0), SR * 1.004));
      }
      spin.add(kit.dots(cloud, 1.9, { a0: 1, a1: 0.5 }));
      spin.add(kit.dots([xyz(HAM[0], HAM[1], SR * 1.006)], 5.5, { a0: 1, a1: 0.7 }));
      // ring: a circle in the tangent plane at Hamburg, scaled about its centre (sin pulse, 6 per period)
      const ringG = new Group(); ringG.position.set(...hv.map((v) => v * SR * 1.004));
      const up = [-Math.sin(lat0) * Math.sin(HAM[1] * D2R), Math.cos(lat0), -Math.sin(lat0) * Math.cos(HAM[1] * D2R)];   // toward north
      const east = [Math.cos(HAM[1] * D2R), 0, -Math.sin(HAM[1] * D2R)];
      const rr = Math.sin(RING_DEG * D2R), ring = [];
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * TAU, b = (i + 1) / 64 * TAU;
        const p = (t) => [0, 1, 2].map((k) => rr * (Math.cos(t) * east[k] + Math.sin(t) * up[k]));
        ring.push(p(a), p(b));
      }
      ringG.add(kit.lines(ring, { a0: 0.9, a1: 0.4 })); spin.add(ringG);

      // delivery arcs: great circles Hamburg -> city, lifted (peak ~ length * 0.18 R), 1 device px; nodes at the ends; cargo dots on the arcs
      const hA = hv, segs = [], nodes = [], arcPts = [];
      const SEG = 48;
      CITIES.forEach((c) => {
        const b = xyz(c[0], c[1]), dot = Math.max(-1, Math.min(1, hA[0] * b[0] + hA[1] * b[1] + hA[2] * b[2])), ang = Math.acos(dot), so = Math.sin(ang), lift = ARC_MAX * ang / Math.PI;
        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const s = i / SEG, w0 = Math.sin((1 - s) * ang) / so, w1 = Math.sin(s * ang) / so, h = SR * (LIFT + lift * Math.sin(Math.PI * s));
          pts.push([0, 1, 2].map((k) => (hA[k] * w0 + b[k] * w1) * h));
        }
        for (let i = 0; i < SEG; i++) segs.push(pts[i], pts[i + 1]);
        arcPts.push(pts); nodes.push(xyz(c[0], c[1], SR * LIFT));
      });
      spin.add(kit.lines(segs, { a0: 0.85, a1: 0.3 }));
      spin.add(kit.dots(nodes, 3, { a0: 1, a1: 0.5 }));
      const cargo = [], cargoMeta = [];
      arcPts.forEach((pts, i) => { const k = 2 + (i % 2); [0, 0.5].forEach((o, j) => { if (j && i % 3) return; cargo.push([0, 0, 0]); cargoMeta.push([pts, k, (o + i * 0.137) % 1]); }); });
      const cargoObj = kit.dots(cargo, 3, { a0: 1, a1: 0.6 }); spin.add(cargoObj);
      const cpos = cargoObj.geometry.attributes.position;
      const lerpArc = (pts, s, out, o) => { const f = s * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i; for (let k = 0; k < 3; k++) out[o + k] = pts[i][k] * (1 - u) + pts[i + 1][k] * u; };

      return {
        root, R: SR * (1 + ARC_MAX * 0.65),
        update(phase) {
          spin.rotation.y = hamYaw + SWAY * Math.sin(phase);
          ringG.scale.setScalar(1 + 0.3 * Math.sin(phase * 6));
          cargoMeta.forEach(([pts, k, o], i) => lerpArc(pts, ((phase / TAU) * k + o) % 1, cpos.array, i * 3));
          cpos.needsUpdate = true;
        },
      };
    },
  });
}
