// About services: ONE WebGL renderer/canvas laid over the whole service list; each card's media slot is a scissor/viewport region with its own model.
// Style = the isometric line illustrations of Quality (feature-card .il-*): orthographic 30deg camera (no perspective), wireframe edges only (no fills),
// contrast: the ONE main object of each model = flat white fill (MeshBasicMaterial, no lighting) with thin ink edges; secondary parts = thin outline only (fat lines, 0.75 css px, hidden lines removed by depth-only occluders); thin diamond grid under the model; transparent canvas.
// Loaded lazily by about-services.js; `three` and its Line2 add-ons are imported by name (tree-shaken, separate chunk).
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Mesh, Color, Vector3, Box3, MathUtils, MeshBasicMaterial, EdgesGeometry,
  SphereGeometry, CylinderGeometry, BoxGeometry,
} from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { capDpr } from '../utils/dpr.js';

const SPIN = 0.15;                  // rad/s around the vertical axis
const TARGET = 3.5;                 // normalised model size (scene units)
const HALF_H = 3.4;                // ortho half-height (scene units)
const PITCH = MathUtils.degToRad(30); // isometric: yaw 45deg, pitch 30deg, no perspective
const LINE_PX = 0.75;               // outline width in css px (thin)
const GRID_PX = 0.55;               // grid line width in css px
const GRID_HALF = 2.2, GRID_DIV = 8, GRID_ALPHA = 0.38;
const EDGE_ANGLE = 20;              // EdgesGeometry threshold, deg

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function initServicesScene(root) {
  const slots = [...root.querySelectorAll('.service-card__media')];
  if (!slots.length) return null;
  let renderer;
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch { return null; }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'service-list__canvas';
  root.prepend(canvas);

  // line materials (shared; resolution/linewidth set per slot before render)
  const lineMat = (cssVar, opacity = 1, px = LINE_PX) => {
    const m = new LineMaterial({
      color: new Color(token(cssVar)).getHex(), linewidth: px, worldUnits: false, alphaToCoverage: opacity >= 1,
      transparent: opacity < 1, opacity,
    });
    m.userData.px = px;
    return m;
  };
  const white = lineMat('--c-white'), accent = lineMat('--c-blue-200'), ink = lineMat('--c-blue-700'), gridMat = lineMat('--c-blue-200', GRID_ALPHA, GRID_PX);
  const mats = [white, accent, ink, gridMat];
  // fill of the main object: flat white, pushed back a little so its ink edges stay on top
  const fillMat = new MeshBasicMaterial({ color: new Color(token('--c-white')).getHex(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  // occluders: write depth only (hidden-line removal), never colour; "ghost" = no depth either (glass, keeps inner lines visible)
  const occMat = new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const ghostMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  const segs = (pts, m, order = 1) => { // pts: flat [x,y,z,...] pairs of segment ends
    const g = new LineSegmentsGeometry().setPositions(pts);
    const o = new LineSegments2(g, m);
    o.renderOrder = order;
    return o;
  };
  const circlePts = (r, n = 40) => {
    const a = [];
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
      a.push(Math.cos(t0) * r, 0, Math.sin(t0) * r, Math.cos(t1) * r, 0, Math.sin(t1) * r); // circle in XZ plane
    }
    return a;
  };
  const place = (o, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };
  // solid primitive drawn as edges (+ occluder)
  const solid = (geo, m, x, y, z, rot = [0, 0, 0], ghost = false, fill = false) => {
    const g = new Group();
    const occ = new Mesh(geo, fill ? fillMat : ghost ? ghostMat : occMat);
    occ.renderOrder = 0;
    const pts = [...new EdgesGeometry(geo, EDGE_ANGLE).attributes.position.array];
    const gp = geo.parameters;
    if (geo.type === 'CylinderGeometry' && gp.radialSegments > 8) { // smooth cylinder: 4 generatrix lines, like a hand-drawn iso cylinder
      const h = gp.height / 2;
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; pts.push(Math.cos(a) * gp.radiusTop, h, Math.sin(a) * gp.radiusTop, Math.cos(a) * gp.radiusBottom, -h, Math.sin(a) * gp.radiusBottom); }
    }
    g.add(occ, segs(pts, fill ? ink : m));
    return place(g, x, y, z, ...rot);
  };
  const circle = (r, m, x, y, z, rot = [0, 0, 0]) => place(segs(circlePts(r), m), x, y, z, ...rot);
  const line = (pts, m) => segs(pts, m);
  // atom = flat white sphere + one thin ink equator
  const atom = (r, m, x, y, z) => {
    const g = new Group();
    const occ = new Mesh(new SphereGeometry(r, 20, 14), fillMat);
    occ.renderOrder = 0;
    g.add(occ, circle(r * 1.003, ink, 0, 0, 0));
    return place(g, x, y, z);
  };

  const builders = [
    // 0 Manufacturer search: molecule + loupe ring
    () => {
      const g = new Group();
      const pts = [[0, 0, 0, 0.5], [1.35, 0.55, 0.2, 0.3], [-1.2, 0.8, -0.3, 0.34], [0.3, -1.35, 0.5, 0.3], [-0.7, -1, -0.7, 0.26]];
      pts.forEach(([x, y, z, r]) => g.add(atom(r, white, x, y, z)));
      for (let i = 1; i < pts.length; i++) g.add(line([0, 0, 0, pts[i][0], pts[i][1], pts[i][2]], accent));
      g.add(circle(2, accent, 0, 0, 0, [Math.PI / 2.3, 0, 0]));
      return g;
    },
    // 1 Regulatory documents: fanned sheets + ruled lines + stamp mark
    () => {
      const g = new Group();
      for (let i = 0; i < 4; i++) g.add(solid(new BoxGeometry(1.9, 0.05, 2.5), accent, 0, i * 0.2, 0, [0, (i - 1.5) * 0.2, 0], false, i === 3));
      const top = new Group();
      top.position.set(0, 0.6 + 0.03, 0);
      top.rotation.y = 1.5 * 0.2;
      const rules = [];
      for (let k = 0; k < 4; k++) rules.push(-0.7, 0, -1.0 + k * 0.2, 0.7 - k * 0.12, 0, -1.0 + k * 0.2);
      top.add(line(rules, ink));
      top.add(circle(0.46, ink, 0.2, 0, 0.4));
      top.add(line([-0.02, 0, 0.42, 0.14, 0, 0.58, 0.14, 0, 0.58, 0.45, 0, 0.22], ink));
      g.add(top);
      return g;
    },
    // 2 Samples: three test tubes
    () => {
      const g = new Group();
      [[-1.05, 1.5, 0.12], [0, 2.1, -0.04], [1.05, 1.0, -0.12]].forEach(([x, liq, tilt]) => {
        const t = new Group();
        t.add(solid(new CylinderGeometry(0.36, 0.36, 2.6, 32), white, 0, 0, 0, [0, 0, 0], false, true));
        t.add(solid(new CylinderGeometry(0.375, 0.375, liq, 32), ink, 0, -1.3 + liq / 2 + 0.04, 0, [0, 0, 0], true)); // liquid = outline band around the body
        t.add(solid(new CylinderGeometry(0.42, 0.42, 0.28, 32), white, 0, 1.44, 0));
        t.position.x = x;
        t.rotation.z = tilt;
        g.add(t);
      });
      return g;
    },
    // 3 Specs & quality: hexagonal nut with an inscribed ring
    () => {
      const g = new Group();
      g.add(solid(new CylinderGeometry(1.4, 1.4, 0.7, 6), white, 0, 0, 0, [0, 0, 0], false, true));
      g.add(circle(0.82, ink, 0, 0.36, 0));
      g.add(solid(new CylinderGeometry(0.42, 0.42, 0.78, 6), ink, 0, 0, 0));
      return g;
    },
  ];

  // static diamond grid (world axes + 45deg camera yaw = diamond on screen), shared geometry per slot scene
  const gridPts = [];
  for (let i = 0; i <= GRID_DIV; i++) {
    const t = -GRID_HALF + (i / GRID_DIV) * GRID_HALF * 2;
    gridPts.push(t, 0, -GRID_HALF, t, 0, GRID_HALF, -GRID_HALF, 0, t, GRID_HALF, 0, t);
  }
  const borderPts = [-GRID_HALF, 0, -GRID_HALF, GRID_HALF, 0, -GRID_HALF, GRID_HALF, 0, -GRID_HALF, GRID_HALF, 0, GRID_HALF,
    GRID_HALF, 0, GRID_HALF, -GRID_HALF, 0, GRID_HALF, -GRID_HALF, 0, GRID_HALF, -GRID_HALF, 0, -GRID_HALF];

  // one scene per slot (own orthographic camera, model, grid, spin phase)
  const items = slots.map((slot, i) => {
    const scene = new Scene();
    const camera = new OrthographicCamera(-HALF_H, HALF_H, HALF_H, -HALF_H, 0.1, 60);
    const d = 20, cy = 0.7;
    camera.position.set(Math.SQRT1_2 * Math.cos(PITCH) * d, Math.sin(PITCH) * d + cy, Math.SQRT1_2 * Math.cos(PITCH) * d);
    camera.lookAt(0, cy, 0);
    const grid = new Group();
    grid.add(segs(gridPts, gridMat, 2), segs(borderPts, accent, 2));
    scene.add(grid);
    const spin = new Group();
    const m = builders[i % builders.length]();
    const box = new Box3().setFromObject(m);
    const size = box.getSize(new Vector3());
    const c = box.getCenter(new Vector3());
    m.position.set(-c.x, -box.min.y, -c.z);
    const wrap = new Group();
    wrap.add(m);
    const sc = TARGET / Math.max(size.x, size.y, size.z);
    wrap.scale.setScalar(sc);
    wrap.position.y = 0.32;
    spin.add(wrap); scene.add(spin);
    spin.rotation.y = 0.6 + i * 1.1; // different start angle per slot
    return { slot, scene, camera, spin };
  });

  let lastT = 0;
  let visible = false, ready = false, lost = false;

  const draw = () => {
    if (lost) return;
    const root0 = root.getBoundingClientRect();
    const W = root0.width, H = root0.height;
    if (!W || !H) return;
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    const vh = innerHeight, still = reduced.matches;
    items.forEach((it) => {
      const r = it.slot.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (!still && (r.bottom < -40 || r.top > vh + 40)) return; // slot out of the viewport: skip rendering
      const x = r.left - root0.left, y = H - (r.bottom - root0.top);
      renderer.setViewport(x, y, r.width, r.height);
      renderer.setScissor(x, y, r.width, r.height);
      const aspect = r.width / r.height;
      if (it.aspect !== aspect) {
        it.aspect = aspect;
        Object.assign(it.camera, { left: -HALF_H * aspect, right: HALF_H * aspect });
        it.camera.updateProjectionMatrix();
      }
      const pr = renderer.getPixelRatio();
      mats.forEach((m) => { m.resolution.set(r.width * pr, r.height * pr); m.linewidth = m.userData.px * pr; });
      renderer.render(it.scene, it.camera);
    });
    if (!root.classList.contains('is-3d')) root.classList.add('is-3d');
  };

  const tick = (now) => {
    const dt = Math.min((now - (lastT || now)) / 1000, 0.1);
    lastT = now;
    items.forEach((it) => { it.spin.rotation.y += SPIN * dt; });
    draw();
  };

  const sync = () => {
    const run = ready && visible && !document.hidden && !reduced.matches && !lost;
    if (run) { lastT = 0; renderer.setAnimationLoop(tick); } else { renderer.setAnimationLoop(null); if (ready && !lost && (reduced.matches || !visible)) draw(); }
  };

  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(capDpr(2));
    renderer.setSize(w, h, false);
    if (reduced.matches || !ready) draw();
  };

  new ResizeObserver(resize).observe(root);
  slots.forEach((s) => new ResizeObserver(() => { if (reduced.matches) draw(); }).observe(s));
  new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; sync(); }).observe(root);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; root.classList.remove('is-3d'); sync(); });

  try {
    ready = true;
    resize();
    draw();
    sync();
  } catch {
    renderer.setAnimationLoop(null);
    root.classList.remove('is-3d');
    canvas.remove();
    return null;
  }
  return { renderer };
}
