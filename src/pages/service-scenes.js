/**
 * service-scenes.js — the ONE definition of the four service illustrations (Manufacturer search, Regulatory documents, Samples, Specs & quality).
 * Shared by About and Services (the same .svc-card row, services-card-scenes.js): one component = one definition.
 *
 * Style = hero language: DOTS + THIN LINES (native GL lines, 1 device px, no dashes) over flat fills, isometric orthographic view.
 * The SAME four subjects as the original (git HEAD) models, only the rendering style changed:
 *   search    molecule (five white atoms, bonds from the centre) inside a tilted loupe ring
 *   documents fanned stack of four sheets; the top one is filled (ruled lines, stamp ring, check)
 *   samples   three slightly tilted test tubes in a row (white, with a collar on top and a liquid band of a different level in each)
 *   specs     hexagonal nut (filled) with an inscribed ring and a hex bore
 * ONE filled main object per model (white --il-fill, thin --il-bg edges); the rest = outline (--il-soft pre-mixed with --il-bg) + dots.
 * All four share the floor dot field (kit.floor(), FLOOR_Y / FLOOR_LIFT), the same camera / scale and are centred on the floor centre
 * (mass centre within 1% x / 6% y of the art zone, the same floor position in every slot); each turns slowly about its own vertical axis.
 *
 * API (everything is meant for createIlScene from ../utils/il-scene.js):
 *   serviceScenes            { search, documents, samples, specs } scene factories (kit) => { root, staticPhase, update(phase) }
 *   serviceCamera            isoCamera() with the shared fill / span; pass as `camera`
 *   serviceBeforeRender      hook for `beforeRender` (screen-facing atom rings, world-fixed tube outlines); REQUIRED with these scenes
 *   SERVICE_PERIOD           seamless loop, seconds (pass as `period`)
 *   SERVICE_SHRINK           pass as `shrink`
 * Host element must define --il-fill / --il-soft / --il-bg (on blue: white / white / --surface-accent; on light: white / --accent / --surface).
 * Example: createIlScene({ host, slots: [{ el, scene: 'search' }, ...], scenes: serviceScenes, canvasClass: 'x__canvas', period: SERVICE_PERIOD, shrink: SERVICE_SHRINK, camera: serviceCamera, beforeRender: serviceBeforeRender })
 * Seamless loop: every motion is a function of phase = 2*PI*t/PERIOD with integer harmonics only. No LineSegments2 / fat lines.
 */
import { CylinderGeometry, Matrix4, Vector3, Quaternion } from 'three';
import { isoCamera } from '../utils/il-scene.js';

const TAU = Math.PI * 2;
export const SERVICE_PERIOD = 40, SERVICE_SHRINK = 0.97;
// the same camera / scale as Home Quality (isoCamera), so floor diamonds coincide in every slot
export const serviceCamera = isoCamera({ fill: 0.86, spanW: 400, spanH: 262 });

// materials: outline = lineMat(0.7) (opaque pre-mix of white over the band), main-object edges = lineMat(0) (band blue over the white fill), silhouette rings = lineMat(0.7) lifted a hair towards the camera (depth-tested: nothing shows through a nearer atom)
const mats = (K) => ({ line: K.lineMat(0.7), soft: K.lineMat(0.45), ink: K.lineMat(0), sil: K.lineMat(0.7) });

// sphere: screen-facing silhouette ring (always a visible outer contour) + 2 great circles + centre dot; filled = white flat sphere with band-blue great circles, otherwise outline over a depth-only occluder
const ball = (K, filled) => {
  const c = K.cache, m = mats(K);
  c.ringGeo ||= K.track(K.geoOf(K.circle(1, 40)));
  c.sphereGeo ||= K.track(new K.SphereGeometry(1, 24, 16));
  c.centreGeo ||= K.track(K.geoOf([[0, 0, 0]]));
  const g = new K.Group();
  const body = new K.Mesh(c.sphereGeo, filled ? K.fillMat : K.occluder); body.scale.setScalar(K.shrink); g.add(body);
  const sil = K.loopOf(c.ringGeo, m.sil); sil.renderOrder = 2; g.add(sil); (c.facing ||= []).push({ obj: sil, parent: g, kind: 'ring' });
  const lm = filled ? m.ink : m.line;
  const a = K.loopOf(c.ringGeo, lm), b = K.loopOf(c.ringGeo, lm); a.rotation.x = Math.PI / 2; b.rotation.y = Math.PI / 2;
  g.add(a, b, K.dotsGeo(c.centreGeo, filled ? K.dot.soft : K.dot.soft));
  return g;
};

// cylinder standing on y = 0 (axis = local y): top / bottom ellipses, 2 silhouette generatrices (placed each frame by serviceBeforeRender so they stay the screen-left / right extremes, also for a tilted axis),
// optional white fill; `ghost` = outline only without depth (glass band that must not hide what lies inside)
const cylinder = (K, r, h, { filled = false, ghost = false, edge, dotM }) => {
  const g = new K.Group();
  if (!ghost) { const body = new K.Mesh(K.track(new CylinderGeometry(r, r, h, 40)), filled ? K.fillMat : K.occluder); body.position.y = h / 2; body.scale.setScalar(K.shrink); g.add(body); }
  g.add(K.segs(K.segsOf(K.circleXZ(0, 0, r, h, 48), true), edge), K.segs(K.segsOf(K.circleXZ(0, 0, r, 0, 48), true), edge));
  const sil = new K.Group(), p = [[r, 0, 0], [r, h, 0], [-r, 0, 0], [-r, h, 0]];
  sil.add(K.segs(p, edge), K.dots(p, dotM));
  g.add(sil); (K.cache.facing ||= []).push({ obj: sil, parent: g, kind: 'cyl' });
  return g;
};

export const serviceScenes = {
  /* ---------- Manufacturer search: molecule (original atom layout, all atoms white as in the original) inside a tilted loupe ring ---------- */
  search: (K) => {
    const { Group, segs, segsOf, dots, circleXZ, floor, FLOOR_Y, FLOOR_LIFT } = K; const m = mats(K);
    const root = new Group(); root.position.y = FLOOR_Y + FLOOR_LIFT; root.add(floor());
    const spin = new Group(); root.add(spin);
    const k = 33, Y0 = 53;
    // original atoms (x, y, z, r) in model units; the centre of the atom cloud sits on the spin axis
    const raw = [[0, 0, 0, 0.5], [1.35, 0.55, 0.2, 0.3], [-1.2, 0.8, -0.3, 0.34], [0.3, -1.35, 0.5, 0.3], [-0.7, -1, -0.7, 0.26]];
    const cx = raw.reduce((t, a) => t + a[0], 0) / raw.length, cz = raw.reduce((t, a) => t + a[2], 0) / raw.length;
    const atoms = raw.map(([x, y, z, r]) => [(x - cx) * k, (y) * k, (z - cz) * k, r * k]);
    const bonds = [];
    atoms.forEach(([x, y, z, r], i) => { const b = ball(K, true); b.position.set(x, Y0 + y, z); b.scale.setScalar(r); spin.add(b); if (i) bonds.push([atoms[0][0], Y0 + atoms[0][1], atoms[0][2]], [x, Y0 + y, z]); });
    spin.add(segs(bonds, m.line));
    const ring = new Group(); ring.position.set(atoms[0][0], Y0, atoms[0][2]); ring.rotation.x = Math.PI / 2.3; spin.add(ring);   // loupe ring: r = 2 units, tilted like the original
    const pts = circleXZ(0, 0, 2 * k, 0, 72);
    ring.add(segs(segsOf(pts, true), m.soft), dots([0, 18, 36, 54].map((i) => pts[i]), K.dot.soft));
    return { root, staticPhase: 0.55, update: (p) => { spin.rotation.y = p; } };
  },

  /* ---------- Regulatory documents: fanned stack of four sheets (original proportions); the top one is filled (ruled lines, stamp ring, check) ---------- */
  documents: (K) => {
    const { Group, segs, segsOf, dots, circleXZ, solid, floor, FLOOR_Y, FLOOR_LIFT } = K; const m = mats(K);
    const root = new Group(); root.position.y = FLOOR_Y + FLOOR_LIFT; root.add(floor());
    const spin = new Group(); root.add(spin);
    const u = 74, W = 1.9 * u, D = 2.5 * u, T = 4.5, GAP = 0.2 * u * 1.15, N = 4, Y0 = 8;
    const sheets = [];
    for (let i = 0; i < N; i++) {
      const top = i === N - 1;
      const s = new Group(); s.rotation.y = (i - (N - 1) / 2) * 0.2; s.position.y = Y0 + i * GAP + T / 2;
      s.add(solid(W, T, D, top, top ? m.ink : K.lineMat(0.4 + i * 0.1)));
      spin.add(s); sheets.push(s);
      if (top) {
        const yt = T / 2 + 0.3;
        s.add(segs([0, 1, 2, 3].flatMap((n) => [[-0.7 * u, yt, (-1 + n * 0.2) * u], [(0.7 - n * 0.12) * u, yt, (-1 + n * 0.2) * u]]), m.ink));            // ruled text lines
        s.add(segs(segsOf(circleXZ(0.2 * u, 0.4 * u, 0.46 * u, yt, 40), true), m.ink));                                                                   // stamp ring
        s.add(segs([-0.02, 0.42, 0.14, 0.58, 0.14, 0.58, 0.45, 0.22].reduce((a, v, j, arr) => (j % 2 ? a : [...a, [arr[j] * u, yt, arr[j + 1] * u]]), []), m.ink)); // check
      }
    }
    return { root, staticPhase: 0.4, update: (p) => { spin.rotation.y = p; } };
  },

  /* ---------- Samples: three slightly tilted test tubes in a row (original layout): white body, collar on top, liquid band of a different level ---------- */
  samples: (K) => {
    const { Group, floor, FLOOR_Y, FLOOR_LIFT } = K; const m = mats(K);
    const root = new Group(); root.position.y = FLOOR_Y + FLOOR_LIFT; root.add(floor());
    const spin = new Group(); root.add(spin);
    const k = 28, R = 0.36 * k, H = 2.6 * k, CAP_R = 0.42 * k, CAP_H = 0.28 * k, Y = H / 2 + CAP_H + 3;
    [[-1.05, 1.5, 0.12], [0, 2.1, -0.04], [1.05, 1.0, -0.12]].forEach(([x, liq, tilt]) => {
      const t = new Group(); t.position.set(x * k, Y, 0); t.rotation.z = tilt; spin.add(t);
      const inner = new Group(); inner.position.y = -H / 2; t.add(inner);
      inner.add(cylinder(K, R, H, { filled: true, edge: m.ink, dotM: K.dot.soft }));
      const band = cylinder(K, R * 1.04, liq * k, { ghost: true, edge: m.ink, dotM: K.dot.soft }); band.position.y = 0.04 * k; inner.add(band);   // liquid = outline band around the body
      const cap = cylinder(K, CAP_R, CAP_H, { edge: m.line, dotM: K.dot.soft }); cap.position.y = H; inner.add(cap);
    });
    return { root, staticPhase: 0.9, update: (p) => { spin.rotation.y = p; } };
  },

  /* ---------- Specs & quality: hexagonal nut (filled) with an inscribed ring and a hex bore ---------- */
  specs: (K) => {
    const { Group, Mesh, EdgesGeometry, LineSegments, segs, segsOf, dots, circleXZ, floor, FLOOR_Y, FLOOR_LIFT, track } = K; const m = mats(K);
    const root = new Group(); root.position.y = FLOOR_Y + FLOOR_LIFT; root.add(floor());
    const spin = new Group(); root.add(spin);
    const u = 73, R = 1.4 * u, H = 0.7 * u;
    const geo = track(new CylinderGeometry(R, R, H, 6)), edge = track(new EdgesGeometry(geo));
    const nut = new Group(); nut.position.y = H / 2; spin.add(nut);
    const body = new Mesh(geo, K.fillMat); body.scale.setScalar(K.shrink);
    const e = new LineSegments(edge, m.ink); e.renderOrder = 1; e.frustumCulled = false;
    nut.add(body, e);
    const hex = (y, r) => Array.from({ length: 6 }, (_, i) => [r * Math.sin(i * TAU / 6), y, r * Math.cos(i * TAU / 6)]);   // the vertex order of CylinderGeometry(.., 6)
    spin.add(dots([...hex(0, R), ...hex(H, R)], K.dot.soft));
    const yt = H + 0.3, rb = 0.42 * u;
    spin.add(segs(segsOf(circleXZ(0, 0, 0.82 * u, yt, 72), true), m.ink));                                                                    // inscribed ring
    spin.add(segs([...segsOf(hex(yt, rb), true), ...segsOf(hex(yt + 0.04 * u, rb), true), ...hex(yt, rb).flatMap((p, i) => [p, hex(yt + 0.04 * u, rb)[i]])], m.ink), dots(hex(yt + 0.04 * u, rb), K.dot.soft));   // hex bore (original: prism a hair taller than the nut)
    return { root, staticPhase: 0.2, update: (p) => { spin.rotation.y = p; } };
  },
};

// screen-facing rings / silhouette generatrices: recomputed from the parent's world orientation every frame
const Q = {};
export const serviceBeforeRender = (it, K) => {
  if (!Q.cam) {
    Q.tmp = new Quaternion(); Q.v = new Vector3(1, 1, 1); Q.a = new Vector3(); Q.n = new Vector3(); Q.z = new Vector3(); Q.m = new Matrix4();
    Q.cam = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(1, 1, 1), new Vector3(), new Vector3(0, 1, 0)));
  }
  (K.cache.facing || []).forEach(({ obj, parent, kind }) => {
    parent.getWorldQuaternion(Q.tmp);
    if (kind === 'cyl') {                       // local x = outline direction (view x axis), local y = cylinder axis
      Q.a.set(0, 1, 0).applyQuaternion(Q.tmp); Q.n.crossVectors(Q.v, Q.a).normalize(); Q.z.crossVectors(Q.n, Q.a);
      Q.m.makeBasis(Q.n, Q.a, Q.z); Q.tmp.invert(); obj.quaternion.setFromRotationMatrix(Q.m).premultiply(Q.tmp);
    } else {                                    // ring facing the camera, lifted a hair towards it
      Q.tmp.invert(); obj.position.set(0.1, 0.1, 0.1).applyQuaternion(Q.tmp); obj.quaternion.copy(Q.tmp).multiply(Q.cam);
    }
  });
};
