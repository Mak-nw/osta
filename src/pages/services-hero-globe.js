import { url } from '../utils/url.js';
// Services hero: wide 3D "unrolled globe" strip. Real three.js scene, PerspectiveCamera low over the sphere (almost tangent view), so the horizon
// bends as an arc across the strip. The sphere itself is never drawn (only an invisible depth occluder): land = parallel hatch lines
// (latitude circles clipped to the Natural Earth 110m land polygons, precomputed in /assets/img/hero-globe-land.json) + a thin coastline.
// On top: country nodes (ring + dot, billboards of constant pixel size), supply-route arcs from the Hamburg hub (great-circle slerp lifted above the
// surface, running dashes + small packets), a pulsing hub ring, HTML labels (ISO codes) projected from 3D, hidden behind the horizon / when colliding.
// No gradients, masks, shadows. Line width in css px x DPR (once). Renders only while on screen and the tab is visible; reduced motion = one static frame.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Vector3, Color, MathUtils, MeshBasicMaterial, SphereGeometry, RingGeometry, CircleGeometry,
} from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { capDpr } from '../utils/dpr.js';

const D2R = Math.PI / 180;
// camera: low above the surface south of Europe, looking north along the surface (tangent-ish view)
const CAM = { lat: 33, lon: 12, alt: 0.3, tLat: 43, tLon: 12, fov: 60 };
const MAX_DPR = 2, FRAME_MS = 1000 / 45;
const HUB = 'DE';
// country centroids [lat, lon]; no CIS countries and no UA
const NODES = {
  DE: [53.5, 10.0], NL: [52.2, 5.3], BE: [50.6, 4.5], FR: [46.8, 2.4], IT: [42.8, 12.5], ES: [40.2, -3.7], PL: [52.0, 19.4], CH: [46.8, 8.2],
  AT: [47.6, 14.5], GB: [53.0, -2.0], SE: [62.0, 15.5], TR: [39.0, 35.0], IN: [22.0, 78.5], CN: [35.0, 104.0], JP: [36.0, 138.0], KR: [36.5, 127.8],
  US: [39.0, -98.0], BR: [-10.0, -52.0], AE: [24.0, 54.0],
};
const LIVE = ['US', 'BR', 'IN', 'CN', 'JP', 'KR', 'AE', 'TR', 'GB', 'ES', 'IT', 'SE', 'PL', 'FR'];   // arcs with a travelling packet
const EXTRA = [['US', 'GB'], ['AE', 'IN'], ['CN', 'JP'], ['CN', 'KR'], ['TR', 'AE'], ['IN', 'CN']];

const ll = (lat, lon, r = 1) => new Vector3(r * Math.cos(lat * D2R) * Math.sin(lon * D2R), r * Math.sin(lat * D2R), r * Math.cos(lat * D2R) * Math.cos(lon * D2R));
const slerp = (a, b, t) => {
  const w = Math.acos(MathUtils.clamp(a.dot(b), -1, 1)), s = Math.sin(w);
  if (s < 1e-5) return a.clone();
  return a.clone().multiplyScalar(Math.sin((1 - t) * w) / s).add(b.clone().multiplyScalar(Math.sin(t * w) / s));
};

export async function initHeroGlobe(host) {
  if (!host) return null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cs = getComputedStyle(host);
  const tok = (n) => new Color(cs.getPropertyValue(n).trim());
  const cAccent = tok('--accent'), cWhite = tok('--c-white'), cBg = tok('--surface-raised');

  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas hero-globe__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch { canvas.remove(); return null; }
  renderer.setClearColor(cBg, 0);

  const land = await fetch(url('/assets/img/hero-globe-land.json')).then((r) => r.json());

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAM.fov, 3.2, 0.02, 12);
  camera.position.copy(ll(CAM.lat, CAM.lon, 1 + CAM.alt));
  camera.up.set(0, 1, 0);
  camera.lookAt(ll(CAM.tLat, CAM.tLon, 1));
  camera.updateMatrixWorld();
  const camPos = camera.position.clone();

  // invisible depth occluder: hides the far side of the globe without drawing a surface
  const occ = new Mesh(new SphereGeometry(0.9975, 72, 48), new MeshBasicMaterial({ colorWrite: false }));
  scene.add(occ);

  const mats = [];
  const lineMat = (px, opacity, extra = {}) => {
    const m = new LineMaterial({ color: cAccent, linewidth: px, worldUnits: false, transparent: true, opacity, ...extra });
    m.userData.px = px; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    mats.push(m);
    return m;
  };
  // 3 depth bands (near / mid / far from the viewer): thinner and lighter towards the horizon, with plain materials (no vertex-colour ramps)
  const bands = [
    { max: 0.55, hatch: lineMat(0.8, 0.5), coast: lineMat(1, 0.85), h: [], c: [] },
    { max: 0.28, hatch: lineMat(0.7, 0.36), coast: lineMat(0.9, 0.65), h: [], c: [] },
    { max: -1, hatch: lineMat(0.6, 0.22), coast: lineMat(0.8, 0.4), h: [], c: [] },
  ];
  const bandOf = (p) => {   // viewing cosine at the point: 1 = looking straight down, 0 = on the horizon
    const n = p.clone().normalize(), toCam = camPos.clone().sub(p).normalize();
    const d = n.dot(toCam);
    return d < -0.02 ? -1 : (d > bands[0].max ? 0 : d > bands[1].max ? 1 : 2);
  };
  const push = (arr, a, b) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const addSeg = (kind, a, b) => {
    const bi = bandOf(a.clone().add(b).multiplyScalar(0.5));
    if (bi < 0) return;
    push(bands[bi][kind], a, b);
  };
  const RL = 1.0006;
  const h = land.h;
  for (let i = 0; i < h.length; i += 3) {
    const la = h[i], lo0 = h[i + 1], lo1 = h[i + 2];
    const n = Math.max(1, Math.ceil((lo1 - lo0) / 2.5));
    let prev = ll(la, lo0, RL);
    for (let k = 1; k <= n; k++) { const p = ll(la, lo0 + ((lo1 - lo0) * k) / n, RL); addSeg('h', prev, p); prev = p; }
  }
  for (const c of land.c) {
    let prev = ll(c[1], c[0], RL);
    for (let i = 2; i < c.length; i += 2) { const p = ll(c[i + 1], c[i], RL); addSeg('c', prev, p); prev = p; }
  }
  let segCount = 0;
  const world = new Group();
  scene.add(world);
  const add = (pos, m) => { if (!pos.length) return; const o = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), m); o.renderOrder = 1; world.add(o); segCount += pos.length / 6; return o; };
  bands.forEach((b) => { add(b.h, b.hatch); add(b.c, b.coast); });

  // routes
  const routeMat = lineMat(0.9, 0.7, { dashed: true, dashSize: 0.012, gapSize: 0.02 });
  const routeStatic = lineMat(0.8, 0.4, { dashed: true, dashSize: 0.012, gapSize: 0.02 });
  const hubV = ll(...NODES[HUB]);
  const arcPts = (a, b, n = 56) => {
    const chord = a.distanceTo(b), pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push(slerp(a, b, t).multiplyScalar(1.001 + chord * 0.15 * Math.sin(Math.PI * t))); }
    return pts;
  };
  const arcs = [];
  const mkArc = (a, b, live) => {
    const pts = arcPts(a, b), pos = [];
    for (let i = 0; i < pts.length - 1; i++) push(pos, pts[i], pts[i + 1]);
    const o = add(pos, live ? routeMat : routeStatic);
    o.computeLineDistances();
    arcs.push({ pts, live });
    return pts;
  };
  const liveArcs = [];
  Object.keys(NODES).filter((c) => c !== HUB).forEach((c) => {
    const pts = mkArc(hubV, ll(...NODES[c]), LIVE.includes(c));
    if (LIVE.includes(c)) liveArcs.push(pts);
  });
  EXTRA.forEach(([a, b]) => mkArc(ll(...NODES[a]), ll(...NODES[b]), false));

  // billboards of constant pixel size
  const billboards = [];
  const mkBoard = (geo, color, px, opacity = 1) => {
    const m = new Mesh(geo, new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }));
    m.userData.px = px; m.renderOrder = 3;
    scene.add(m); billboards.push(m);
    return m;
  };
  const ringGeo = (r) => new RingGeometry(1 - 1 / r, 1, 40);
  const circle = new CircleGeometry(1, 24);
  const nodeInfo = [];
  Object.entries(NODES).forEach(([code, [la, lo]]) => {
    const p = ll(la, lo, 1.004), hub = code === HUB;
    const members = hub
      ? [mkBoard(circle, cWhite, 8), mkBoard(ringGeo(8), cAccent, 8)]
      : [mkBoard(ringGeo(5), cAccent, 5), mkBoard(circle, cAccent, 1.8)];
    members.forEach((m) => { m.position.copy(p); m.userData.base = p; });
    nodeInfo.push({ code, p, members });
  });
  const pulses = [0, 0.5].map((ph) => { const m = mkBoard(ringGeo(8), cAccent, 8, 0.6); m.position.copy(hubV).setLength(1.004); m.userData.phase = ph; m.userData.pulse = true; return m; });
  const packets = liveArcs.map((pts, i) => {
    const m = mkBoard(circle, cAccent, 2.5); m.userData.pkt = { pts, dur: 4.2 + (i % 5) * 0.7, phase: (i * 0.37) % 1 };
    return m;
  });

  // HTML labels
  const layer = document.createElement('div');
  layer.className = 'hero-globe__labels';
  layer.setAttribute('aria-hidden', 'true');
  host.append(layer);
  const labels = nodeInfo.map((n) => { const d = document.createElement('span'); d.className = 'hero-globe__label' + (n.code === HUB ? ' hero-globe__label--hub' : ''); d.textContent = n.code; layer.append(d); return d; });

  let W = 1, H = 1, pxToWorld = 0.001;
  const v = new Vector3();
  const placeLabels = () => {
    const placed = [];
    const hit = (r) => placed.some((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
    const order = nodeInfo.map((n, i) => ({ n, i })).sort((a, b) => (a.n.code === HUB ? -1 : b.n.code === HUB ? 1 : 0));
    // node discs first: labels must not sit on any node
    const spots = nodeInfo.map((n) => {
      v.copy(n.p).project(camera);
      const vis = n.p.clone().normalize().dot(camPos.clone().sub(n.p).normalize()) > 0.07 && v.z < 1;
      return { vis, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    });
    spots.forEach((s, i) => { if (s.vis) placed.push([s.x - 7, s.y - 7, s.x + 7, s.y + 7]); });
    order.forEach(({ n, i }) => {
      const s = spots[i], el = labels[i];
      let put = null;
      if (s.vis && s.x > 8 && s.x < W - 8 && s.y > 8 && s.y < H - 8) {
        const w = 21, hh = 16, o = n.code === HUB ? 11 : 8;
        const cands = [[s.x + o, s.y - hh / 2], [s.x - o - w, s.y - hh / 2], [s.x - w / 2, s.y - o - hh], [s.x - w / 2, s.y + o]];
        for (const [x, y] of cands) { const r = [x - 1, y - 1, x + w + 1, y + hh + 1]; if (!hit(r) && x > 0 && x + w < W) { put = [x, y, r]; break; } }
        if (put) placed.push(put[2]);
      }
      el.style.visibility = put ? 'visible' : 'hidden';
      if (put) el.style.transform = `translate(${put[0].toFixed(1)}px, ${put[1].toFixed(1)}px)`;
    });
  };

  const update = (tSec) => {
    const dist = (p) => camPos.distanceTo(p);
    billboards.forEach((m) => {
      let k = m.userData.px;
      if (m.userData.pulse) {
        const t = ((tSec / 3.2) + m.userData.phase) % 1;
        k *= 1 + 2 * t; m.material.opacity = reduced.matches ? 0 : 0.6 * (1 - t);
      }
      if (m.userData.pkt) {
        const { pts, dur, phase } = m.userData.pkt;
        const t = ((tSec / dur) + phase) % 1, f = t * (pts.length - 1), i = Math.floor(f);
        m.position.copy(pts[i]).lerp(pts[Math.min(i + 1, pts.length - 1)], f - i);
        k *= reduced.matches ? 0 : Math.min(1, t * 8, (1 - t) * 8);
        m.visible = k > 0.01 && m.position.clone().normalize().dot(camPos.clone().sub(m.position).normalize()) > -0.05;
      }
      m.scale.setScalar(Math.max(k, 1e-4) * pxToWorld * dist(m.position));
      m.quaternion.copy(camera.quaternion);
    });
  };

  const resize = () => {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    const pr = capDpr(MAX_DPR);
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    pxToWorld = (2 * Math.tan((CAM.fov * D2R) / 2)) / H;
    mats.forEach((m) => { m.resolution.set(W * pr, H * pr); m.linewidth = m.userData.px * pr; });
    return true;
  };
  let raf = 0, last = 0, onScreen = false, t0 = performance.now(), lost = false;
  const draw = (now = performance.now()) => {
    if (lost || !W) return;
    update(reduced.matches ? 1.2 : (now - t0) / 1000);
    if (!reduced.matches) { routeMat.dashOffset = -((now - t0) / 1000) * 0.03; }
    renderer.render(scene, camera);
    canvas.classList.add('is-ready');
  };
  const loop = (now) => { raf = requestAnimationFrame(loop); if (now - last < FRAME_MS) return; last = now; draw(now); };
  const sync = () => {
    const run = onScreen && !document.hidden && !reduced.matches;
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run && onScreen) draw();
  };
  new ResizeObserver(() => { if (resize()) { placeLabels(); draw(); } }).observe(host);
  new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; sync(); }).observe(host);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  if (!resize()) return { segments: segCount };
  placeLabels(); draw();
  host.dataset.globeSegments = String(segCount);
  return { segments: segCount };
}
