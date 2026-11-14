// Home Quality cards: two looping three.js scenes (EudraGMDP = archive stack + filled document with a solid seal ring and a check; GDP = a warehouse in the centre of a controlled zone, entry route on one side, exit route on the other)
// in the hero language: DOTS + THIN LINES (1 device px) over flat fills, drawn in an isometric orthographic view on the LIGHT band.
// ONE filled main object per scene (white --il-fill, thin --accent edges); everything else = outline only (--accent lines pre-mixed with the band colour, so crossing lines never get brighter) + dots; no halos, no extra colours.
// Both scenes use the same floor dot field and the same scale, so the two cards carry equal visual weight; GDP is point-symmetric about the card centre: the warehouse sits on the centre of the art zone, entry (+z) and exit (+x) routes mirror each other on screen.
// Built on src/utils/il-scene.js: ONE shared WebGLRenderer (offscreen canvas) + 2D copy per card, token probe, observers, reduced-motion frame and destroy() live in the engine; this file holds only the two scene factories.
// Seamless loop: every motion is a function of phase = 2*PI*t/PERIOD with integer harmonics only. Renders only cards on screen and while the tab is visible; prefers-reduced-motion = one static frame; DPR <= 2; destroy() frees everything. No WebGL -> returns null.
import { createIlScene, isoCamera } from '../utils/il-scene.js';

const PERIOD = 12, TAU = Math.PI * 2;
// ONE floor plane for both scenes (kit.FLOOR_Y / kit.FLOOR_LIFT, kit.floor()); the same isoCamera / scale / FILL, so the floor diamond sits at the same screen position in every card.
const FILL = 0.86;                    // share of the art zone taken by the scene's reference span
const SPAN_W = 400, SPAN_H = 262;     // reference span of both scenes (world units on screen): floor dot field + objects

const SCENES = {
  /* ---------- EudraGMDP: archive stack + filled document with a solid seal ring and a check ---------- */
  eudra: (K) => {
    const { Group, Mesh, BoxGeometry, track, segs, segsOf, dots, rectXZ, circleXZ, solid, floor, FLOOR_Y, FLOOR_LIFT, occluder } = K; const lineMat = K.lineMat, inkMat = K.lineMat(1), dotMid = K.dot.mid, SHRINK = K.shrink;
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
  },

  /* ---------- GDP: warehouse on the centre of a controlled zone; entry route on +z, exit route on +x (mirror images on screen) ---------- */
  gdp: (K) => {
    const { Group, segs, segsOf, dots, rectXZ, circleXZ, solid, floor, FLOOR_Y, FLOOR_LIFT } = K; const lineMat = K.lineMat, inkMat = K.lineMat(1), dotInk = K.dot.soft;
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
  },
};

export function initHomeQualityScenes(hosts) {
  hosts = [...hosts].filter(Boolean);
  if (!hosts.length) return null;
  return createIlScene({
    host: hosts[0], slots: hosts, scenes: SCENES, canvasClass: 'quality-card__canvas', period: PERIOD, shrink: 0.97,
    camera: isoCamera({ fill: FILL, spanW: SPAN_W, spanH: SPAN_H }),
  });
}
