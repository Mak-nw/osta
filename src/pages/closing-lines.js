// Closing CTA scene (shared by Home, About, Services): three.js "converge lines" (ported from scenes/converge-lines.html).
// 18 chaotic wavy curves per side (left / right) merge into one line at the centre, where a "processing" circle sits (ring + 5 rotating great circles + bright dot);
// comets run along the lines to the centre and pulse the ring / dot. Transparent canvas (the blue panel --surface-accent shows through);
// all strokes + the dot halo use the token --accent-contrast (read from computed style of a helper element; the ShaderMaterials get the sRGB value as uniform uInk
// because they write gl_FragColor without colour-space conversion, LineBasicMaterial uses three colour management).
// Orthographic camera, 16:9 core always fully visible (contain); no cursor reaction (animated by the clock only).
// Renders only while the container is on screen and the tab is visible; prefers-reduced-motion = one static frame (t = 3). DPR <= 2.
// No WebGL -> returns null (the caller hides the container).
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Vector3, Color, SRGBColorSpace, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  ShaderMaterial, LineSegments, LineBasicMaterial, LineLoop, Mesh, PlaneGeometry, Sphere, Clock,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const HALF_W = 16 / 9, R = 0.25, MAX_DPR = 2, STATIC_T = 3, ZOOM = 0.88;   // ZOOM < 1 = camera closer: trims the empty top/bottom of the frame (line shape unchanged, ends cropped)
const SEG = 240, N = 18, CYC = 1.7;

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const LINE_VERT = `
  attribute float aS; attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD;
  uniform float uT, uHalfW, uXmax, uR; varying float vA;
  float sm5(float a, float b, float x){ x = clamp((x - a) / (b - a), 0.0, 1.0); return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
  void main(){
    float xa = mix(uXmax, uR, aS);
    float t = xa / uHalfW;
    float w = sm5(aD.x, 1.0, t);
    float br = 1.0 + 0.3 * sin(0.21 * uT + aB.w);
    float y = w * (aA.x + aA.y * (min(t, 1.0) - 0.45)
                 + aA.z * br * sin(aB.x * t + aB.z + aC.x * uT)
                 + aA.w * sin(aB.y * t + aB.w + aC.y * uT));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aC.z * xa, y, 0.0, 1.0);
    float head = mod(uT * aC.w + aD.y, ${CYC.toFixed(2)});
    float d = head - aS;
    float comet = pow(clamp(1.0 - d / aD.z, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.015, d) * (1.0 - smoothstep(0.95, 1.0, aS));
    float neck = mix(0.17, 1.0, sm5(0.34, 0.8, t));
    vA = min(1.0, aD.w * 0.95 * neck + comet * 1.0);
  }`;
const INK_FRAG = 'uniform vec3 uInk; varying float vA; void main(){ gl_FragColor = vec4(uInk, vA); }';

export function initClosingLines(host) {
  if (!host) return null;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const probe = document.createElement('span');
  probe.style.color = 'var(--accent-contrast)';
  probe.hidden = true;
  host.appendChild(probe);
  const inkColor = new Color(getComputedStyle(probe).color);
  probe.remove();
  const rgb = { r: 1, g: 1, b: 1 };
  inkColor.getRGB(rgb, SRGBColorSpace);            // sRGB components for the raw ShaderMaterial output
  const ink = new Vector3(rgb.r, rgb.g, rgb.b);

  const canvas = document.createElement('canvas');
  canvas.className = 'home-closing__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.remove(); return null; }
  renderer.setClearColor(0x000000, 0);

  const camera = new OrthographicCamera(-HALF_W, HALF_W, 1, -1, -10, 10);
  camera.position.z = 5;
  const scene = new Scene();

  /* ---------- bundles: 18 chaotic curves per side, converging into one line ---------- */
  const aS = [], aA = [], aB = [], aC = [], aD = [];
  const lines = [];
  [[-1, 11], [1, 29]].forEach(([side, seed]) => {
    const r = rng(seed);
    for (let i = 0; i < N; i++) {
      const y0 = (i / (N - 1) * 2 - 1) * 0.36 + (r() - 0.5) * 0.2;
      const slope = (r() - 0.5) * 0.6;
      const amp1 = 0.07 + 0.17 * r(), amp2 = 0.02 + 0.09 * r();
      const k1 = 3 + 4 * r(), k2 = 7 + 6 * r();
      const ph1 = r() * 6.28, ph2 = r() * 6.28;
      const sp1 = (0.14 + 0.3 * r()) * (r() < 0.5 ? -1 : 1), sp2 = (0.2 + 0.4 * r()) * (r() < 0.5 ? -1 : 1);
      const csp = 0.1 + 0.07 * r(), cph = r() * CYC, clen = 0.08 + 0.12 * r();
      const c0 = 0.26 + 0.16 * r(), op = 0.35 + 0.65 * r();
      lines.push({ sp: csp, ph: cph });
      for (let j = 0; j < SEG; j++) {
        [j, j + 1].forEach((q) => {
          aS.push(q / SEG);
          aA.push(y0, slope, amp1, amp2);
          aB.push(k1, k2, ph1, ph2);
          aC.push(sp1, sp2, side, csp);
          aD.push(c0, cph, clen, op);
        });
      }
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(aS.length * 3), 3));
  geo.setAttribute('aS', new Float32BufferAttribute(aS, 1));
  geo.setAttribute('aA', new Float32BufferAttribute(aA, 4));
  geo.setAttribute('aB', new Float32BufferAttribute(aB, 4));
  geo.setAttribute('aC', new Float32BufferAttribute(aC, 4));
  geo.setAttribute('aD', new Float32BufferAttribute(aD, 4));
  geo.boundingSphere = new Sphere(new Vector3(), 20);

  const lineMat = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uT: { value: 0 }, uHalfW: { value: HALF_W }, uXmax: { value: HALF_W * 1.15 + 0.12 }, uR: { value: R }, uInk: { value: ink } },
    vertexShader: LINE_VERT, fragmentShader: INK_FRAG,
  });
  const fibers = new LineSegments(geo, lineMat);
  fibers.frustumCulled = false;
  scene.add(fibers);

  /* ---------- centre: processing layer (ring + great circles + bright dot) ---------- */
  const core = new Group();
  scene.add(core);
  const coreU = { uOp: { value: 0.5 }, uInk: { value: ink } };
  const arcMat = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, uniforms: coreU,
    vertexShader: `
      uniform float uOp; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = uOp * mix(0.3, 1.0, smoothstep(-${R.toFixed(2)}, ${R.toFixed(2)}, mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: INK_FRAG,
  });
  const circleGeo = () => {
    const n = 160, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.set([Math.cos(a) * R, Math.sin(a) * R, 0], i * 3); }
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(p, 3)); return g;
  };
  const geos = [geo];
  const ringGeo = circleGeo(); geos.push(ringGeo);
  const ringMat = new LineBasicMaterial({ color: inkColor, transparent: true, opacity: 0.95, depthTest: false });
  scene.add(new LineLoop(ringGeo, ringMat));
  const arcGroups = [];
  const arcDefs = [[1.2, 0.3, 0.1, 0.9, 0.5, 0.2], [0.4, 1.1, 0.7, -0.4, 0.7, 0.35], [0.9, -0.5, 1.3, 0.3, -0.6, 0.8], [1.5, 0.8, -0.4, -0.5, 0.35, -0.7], [0.2, 0.0, 0.5, 0.2, 0.9, -0.5]];
  arcDefs.forEach((d) => {
    const g = new Group();
    const cg = circleGeo(); geos.push(cg);
    const c = new LineLoop(cg, arcMat);
    c.rotation.set(d[0], d[1], d[2]);
    g.add(c); core.add(g);
    arcGroups.push({ g, rate: [d[3], d[4], d[5]] });
  });

  const dotU = { uF: { value: 0 }, uInk: { value: ink } };
  const dotGeo = new PlaneGeometry(0.5, 0.5); geos.push(dotGeo);
  const dotMat = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, uniforms: dotU,
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uF; uniform vec3 uInk; varying vec2 vP;
      void main(){
        float r = length(vP);
        float core = 1.0 - smoothstep(0.01375 * (1.0 + 0.9 * uF), 0.01875 * (1.0 + 0.9 * uF), r);
        float halo = exp(-pow(r / (0.0375 + 0.0375 * uF), 2.0)) * (0.28 + 0.5 * uF);
        gl_FragColor = vec4(uInk, clamp(core + halo, 0.0, 1.0));
      }`,
  });
  const dot = new Mesh(dotGeo, dotMat);
  dot.renderOrder = 10;
  scene.add(dot);

  // pulses arriving at the circle (CPU mirror of the shader's comet heads)
  const pulseEnergy = (T) => {
    let e = 0;
    for (const l of lines) {
      const h = (((T * l.sp + l.ph) % CYC) + CYC) % CYC;
      const tau = (h >= 1 ? h - 1 : h + CYC - 1) / l.sp;
      e += Math.exp(-tau * 3.2);
    }
    return e;
  };

  /* ---------- size: 16:9 core always fully visible (contain) ---------- */
  let W = 0, Hh = 0, hw = HALF_W;
  const resize = () => {
    W = host.clientWidth; Hh = host.clientHeight;
    if (!W || !Hh) return false;
    renderer.setPixelRatio(capDpr(MAX_DPR));
    renderer.setSize(W, Hh, false);
    const aspect = W / Hh;
    let hh;
    if (aspect >= HALF_W) { hh = 1; hw = aspect; } else { hw = HALF_W; hh = HALF_W / aspect; }
    hh *= ZOOM; hw *= ZOOM;
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
    camera.updateProjectionMatrix();
    lineMat.uniforms.uXmax.value = hw * 1.15 + 0.12;   // curve start always beyond the visible edge
    return true;
  };

  /* ---------- frame ---------- */
  const clock = new Clock();
  let rot = 0, procS = 0, flashS = 0, fixedT = null, lost = false, started = false;
  const draw = (animated) => {
    if (lost || !W) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    const T = animated && fixedT === null ? clock.elapsedTime : (fixedT !== null ? fixedT : STATIC_T);
    const e = pulseEnergy(T);
    if (!animated || fixedT !== null) { rot = T * 0.3; procS = Math.min(e, 1.5); flashS = e; }
    else {
      procS += (Math.min(e, 1.5) - procS) * Math.min(1, dt / 0.7);
      flashS += (e - flashS) * Math.min(1, dt / 0.08);
      rot += dt * (0.22 + 0.5 * procS);
    }
    arcGroups.forEach((a) => a.g.rotation.set(rot * a.rate[0], rot * a.rate[1], rot * a.rate[2]));
    coreU.uOp.value = 0.4 + 0.32 * Math.min(procS, 1.5) + 0.2 * Math.min(flashS, 1.5);
    dotU.uF.value = Math.min(flashS, 1.6);
    lineMat.uniforms.uT.value = T;
    renderer.render(scene, camera);
    canvas.classList.add('is-ready');
  };

  let raf = 0, onScreen = false;
  const loop = () => { raf = requestAnimationFrame(loop); draw(true); };
  const sync = () => {
    const run = onScreen && !document.hidden && !reducedMq.matches;
    if (run && !raf) { clock.getDelta(); raf = requestAnimationFrame(loop); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!run && onScreen && W) draw(false);
  };
  const ro = new ResizeObserver(() => { if (resize()) { started = true; if (!raf) draw(false); } });
  ro.observe(host);
  const io = new IntersectionObserver((en) => { onScreen = en[en.length - 1].isIntersecting; sync(); });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMq.addEventListener('change', sync);
  const onLost = (ev) => { ev.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  canvas.addEventListener('webglcontextlost', onLost);

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; lost = true;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reducedMq.removeEventListener('change', sync);
    canvas.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose());
    lineMat.dispose(); arcMat.dispose(); ringMat.dispose(); dotMat.dispose();
    renderer.dispose();
    canvas.remove();
  };

  resize();
  // debug hook (checks only): freeze the timeline at t seconds (null = live clock)
  host.__closing = { setT(t) { fixedT = t; if (!raf) draw(false); }, get running() { return !!raf; }, ink: ink.toArray(), started: () => started };
  return { destroy };
}
