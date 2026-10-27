// Home hero media: decorative 3D "pill chain" of ball sprites along a Catmull-Rom spine.
// Ported from the customer's dna-pill-chain-balls.html (three r128 CDN -> npm `three`, named imports).
// Loaded lazily from about.html after first paint. Sizes come from the container, not the window.
import {
  Scene, PerspectiveCamera, WebGLRenderer, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, CanvasTexture, CatmullRomCurve3, Vector3, Box3, Raycaster, Plane,
  MathUtils, NormalBlending,
} from 'three';
import { tokenToCss } from '../utils/css-color.js';

/* ---- customer parameters (unchanged) ---- */
const PER_RUNG = 260;
const BALL_RADIUS = 0.058;
const BALL_JITTER = 0.30;
const HELIX_TWIST_TURNS = 1.4;
const HELIX_SPIN_SPEED = 0.45;
const INFLUENCE_RADIUS = 1.3;
const MAX_SCATTER = 1.6;
const DISP_EASE = 0.12;
const FORM_TOTAL = 1.4;
const CURVE_POINTS = [
  [-7.00, 1.95], [-6.15, 2.20], [-5.12, 2.42], [-4.10, 2.03],
  [-3.42, 1.14], [-3.33, 0.11], [-3.67, -0.91], [-4.27, -1.68],
  [-4.48, -1.94], [-4.18, -2.28], [-3.07, -2.58], [-1.11, -2.66],
  [1.02, -2.41], [3.16, -1.81], [4.87, -0.91], [6.15, -0.15],
  [7.00, 0.24],
];
/* ---- integration constants ---- */
const FIT_MARGIN = 1.22;     // customer used 0.7 (curve overflows the window); 1.22 leaves ~9% side margins on the 16:7 strip
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 45;  // ~45 fps cap
const HERO_SCALE = 0.85;

const easeOutBackSoft = (x) => {
  x = MathUtils.clamp(x, 0, 1);
  const c1 = 0.35, c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

function ballTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const shade = ctx.createRadialGradient(S * 0.36, S * 0.34, S * 0.03, S * 0.5, S * 0.5, S * 0.66);
  shade.addColorStop(0.00, tokenToCss('--c-blue-400', [90, 120, 174]));   // highlight
  shade.addColorStop(0.35, tokenToCss('--c-blue-600', [29, 74, 150]));    // mid tone
  shade.addColorStop(0.72, tokenToCss('--accent', [10, 55, 130]));        // base
  shade.addColorStop(1.00, tokenToCss('--c-blue-950', [6, 31, 82]));      // shaded edge
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  mask.addColorStop(0.00, 'rgba(255,255,255,1)');
  mask.addColorStop(0.80, 'rgba(255,255,255,1)');
  mask.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  return new CanvasTexture(c);
}

export function initHero3d(container) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // probe first: avoids a console error from three when WebGL is unavailable
  const probe = document.createElement('canvas');
  const pgl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!pgl) return false;
  pgl.getExtension('WEBGL_lose_context')?.loseContext();
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    return false;
  }
  const gl = renderer.getContext();
  if (!gl) return false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'hero__canvas';

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 16 / 7, 0.1, 200);

  /* spine */
  const spineCurve = new CatmullRomCurve3(CURVE_POINTS.map(([x, y]) => new Vector3(x, y, 0)), false, 'catmullrom', 0.5);
  const spineLength = spineCurve.getLength();
  const PILL_R = 1.05 * HERO_SCALE;
  const PILL_HALF_CYL = 1.55 * HERO_SCALE;
  const RUNG_SCALE = 0.30;
  const RUNG_R = PILL_R * RUNG_SCALE;
  const RUNG_HALF_CYL = PILL_HALF_CYL * RUNG_SCALE;
  const RUNG_HALF_H = RUNG_HALF_CYL + RUNG_R;
  const RUNG_SPACING = 2 * RUNG_R + 0.10;
  const RUNGS = Math.max(6, Math.round(spineLength / RUNG_SPACING) + 1);

  const rungPoint = [], rungTangent = [], rungRight = [], rungFwd = [];
  const UP_REF = new Vector3(0, 0, 1);
  for (let b = 0; b < RUNGS; b++) {
    const u = RUNGS === 1 ? 0 : b / (RUNGS - 1);
    const p = spineCurve.getPointAt(u);
    const tan = spineCurve.getTangentAt(u).normalize();
    let right = new Vector3().crossVectors(UP_REF, tan);
    if (right.lengthSq() < 1e-6) right = new Vector3(1, 0, 0);
    right.normalize();
    const fwd = new Vector3().crossVectors(tan, right).normalize();
    rungPoint.push(p); rungTangent.push(tan); rungRight.push(right); rungFwd.push(fwd);
  }

  /* ball cloud: uniform fill of the capsule volume */
  const COUNT = PER_RUNG * RUNGS;
  const partPX = new Float32Array(COUNT), partPY = new Float32Array(COUNT), partPZ = new Float32Array(COUNT);
  const rungIdx = new Uint16Array(COUNT);
  const ballSizes = new Float32Array(COUNT);
  const sampleCapsule = (R, halfCyl) => {
    const halfTotal = halfCyl + R;
    for (let a = 0; a < 60; a++) {
      const th = Math.random() * Math.PI * 2;
      const rr = R * Math.sqrt(Math.random());
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
      const y = (Math.random() * 2 - 1) * halfTotal;
      const ay = Math.abs(y);
      if (ay <= halfCyl) return [x, y, z];
      const extra = ay - halfCyl;
      if (R * R - extra * extra >= 0 && x * x + z * z <= R * R - extra * extra) return [x, y, z];
    }
    return [0, 0, 0];
  };
  for (let b = 0, k = 0; b < RUNGS; b++) {
    for (let j = 0; j < PER_RUNG; j++, k++) {
      const [x, y, z] = sampleCapsule(RUNG_R, RUNG_HALF_CYL);
      partPX[k] = x; partPY[k] = y; partPZ[k] = z;
      ballSizes[k] = BALL_RADIUS * (1 - BALL_JITTER / 2 + Math.random() * BALL_JITTER) * 2.05;
      rungIdx[k] = b;
    }
  }
  const TWIST_STEP = (Math.PI * 2 * HELIX_TWIST_TURNS) / RUNGS;
  const AX = new Float32Array(RUNGS), AY = new Float32Array(RUNGS), AZ = new Float32Array(RUNGS);
  const PX = new Float32Array(RUNGS), PY = new Float32Array(RUNGS), PZ = new Float32Array(RUNGS);

  /* camera fit on the container's aspect */
  const center = new Vector3();
  const bbox = new Box3().setFromPoints(spineCurve.getSpacedPoints(200));
  bbox.getCenter(center);
  const extentX = (bbox.max.x - bbox.min.x) / 2 + RUNG_HALF_H;
  const extentY = (bbox.max.y - bbox.min.y) / 2 + RUNG_HALF_H;
  const fitCamera = () => {
    const vFov = MathUtils.degToRad(camera.fov);
    const zH = (extentY * FIT_MARGIN) / Math.tan(vFov / 2);
    const zW = (extentX * FIT_MARGIN) / (Math.tan(vFov / 2) * camera.aspect);
    camera.position.z = center.z + Math.max(zH, zW, 4);
  };

  const ballPositions = new Float32Array(COUNT * 3);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(ballPositions, 3));
  geo.setAttribute('aSize', new BufferAttribute(ballSizes, 1));
  const mat = new ShaderMaterial({
    uniforms: { uTex: { value: ballTexture() }, uScale: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: `
      attribute float aSize;
      uniform float uScale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      void main() {
        vec4 tex = texture2D(uTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        gl_FragColor = tex;
      }`,
  });
  const balls = new Points(geo, mat);
  balls.frustumCulled = false;
  scene.add(balls);

  /* pointer on the container */
  const ndc = { x: 0, y: 0 };
  let inside = false;
  const raycaster = new Raycaster();
  const hoverPlane = new Plane(new Vector3(0, 0, 1), 0);
  const hit = new Vector3();
  if (!reduced) {
    container.addEventListener('pointermove', (e) => {
      const r = container.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      inside = true;
    });
    container.addEventListener('pointerleave', () => { inside = false; });
  }

  const disp = new Float32Array(COUNT);
  const camTarget = { x: 0, y: 0 };

  function update(t) {
    const form = reduced ? 1 : easeOutBackSoft(t / FORM_TOTAL);
    if (inside) { raycaster.setFromCamera(ndc, camera); raycaster.ray.intersectPlane(hoverPlane, hit); }
    for (let b = 0; b < RUNGS; b++) {
      const ang = b * TWIST_STEP + t * HELIX_SPIN_SPEED;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const r = rungRight[b], f = rungFwd[b];
      AX[b] = ca * r.x + sa * f.x; AY[b] = ca * r.y + sa * f.y; AZ[b] = ca * r.z + sa * f.z;
      PX[b] = -sa * r.x + ca * f.x; PY[b] = -sa * r.y + ca * f.y; PZ[b] = -sa * r.z + ca * f.z;
    }
    const scatterAmt = 1 - form;
    for (let i = 0; i < COUNT; i++) {
      const b = rungIdx[i];
      const px = partPX[i], py = partPY[i], pz = partPZ[i];
      const base = rungPoint[b], tan = rungTangent[b];
      const dx = base.x + AX[b] * py + tan.x * px + PX[b] * pz;
      const dy = base.y + AY[b] * py + tan.y * px + PY[b] * pz;
      const dz = base.z + AZ[b] * py + tan.z * px + PZ[b] * pz;
      let target = 0, ddx = 0, ddy = 0, ddz = 1;
      if (inside) {
        ddx = dx - hit.x; ddy = dy - hit.y; ddz = dz - hit.z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (dist < INFLUENCE_RADIUS) { target = 1 - dist / INFLUENCE_RADIUS; target *= target; }
        const dl = dist || 1;
        ddx /= dl; ddy /= dl; ddz /= dl;
      }
      disp[i] += (target - disp[i]) * DISP_EASE;
      const push = disp[i] * MAX_SCATTER;
      ballPositions[i * 3] = dx + dx * scatterAmt * 1.6 + ddx * push;
      ballPositions[i * 3 + 1] = dy + dy * scatterAmt * 1.6 + ddy * push;
      ballPositions[i * 3 + 2] = dz + dz * scatterAmt * 1.6 + ddz * push;
    }
    geo.attributes.position.needsUpdate = true;
    if (!reduced) {
      camTarget.x = center.x + ndc.x * 0.5 * (inside ? 1 : 0);
      camTarget.y = center.y + ndc.y * 0.3 * (inside ? 1 : 0);
      camera.position.x += (camTarget.x - camera.position.x) * 0.05;
      camera.position.y += (camTarget.y - camera.position.y) * 0.05;
    }
    camera.lookAt(center.x, center.y, 0);
    renderer.render(scene, camera);
  }

  /* sizing from the container */
  let w = 0, h = 0;
  const resize = () => {
    const nw = container.clientWidth, nh = container.clientHeight;
    if (!nw || !nh || (nw === w && nh === h)) return;
    w = nw; h = nh;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitCamera();
    camera.position.x = center.x; camera.position.y = center.y;
    camera.updateProjectionMatrix();
    mat.uniforms.uScale.value = (renderer.domElement.height * 0.5) / Math.tan(MathUtils.degToRad(camera.fov) / 2);
    if (reduced || !running) update(reduced ? 0 : clock());
  };

  let running = false, visible = true, raf = 0, last = 0, t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  const tick = (now) => {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    last = now;
    update(clock());
  };
  const sync = () => {
    const should = !reduced && visible && !document.hidden;
    if (should && !running) { running = true; raf = requestAnimationFrame(tick); }
    else if (!should && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  };

  container.appendChild(canvas);
  resize();
  new ResizeObserver(resize).observe(container);
  if (!reduced) {
    new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; sync(); }).observe(container);
    document.addEventListener('visibilitychange', sync);
    sync();
  } else {
    update(0);
  }
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  return true;
}
