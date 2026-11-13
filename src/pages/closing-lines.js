// Closing CTA scene (shared by Home, About, Services): three.js "converge lines" (ported from scenes/converge-lines.html).
// 10 chaotic wavy curves per side (top / bottom, camera rotated 90 deg: the funnel is vertical) merge into one line at the centre, where a "processing" circle sits (ring + 5 rotating great circles + bright dot);
// comets run along the lines to the centre and pulse the ring / dot. Transparent canvas (the blue panel --surface-accent shows through);
// all strokes + the dot halo use the token --accent-contrast (read from computed style of a helper element; the ShaderMaterials get the sRGB value as uniform uInk
// because they write gl_FragColor without colour-space conversion, LineBasicMaterial uses three colour management).
// Particles (flat white dots, no halos, alpha <= 0.7, token --accent-contrast), few and calm: (1) INNER dust strictly inside the sphere (ring radius R): fixed brightness, size and positions (slow drift only); an alpha mask by the light radius of the core
// lightR = mix(0.12, 0.95, smoothstep(0.08, 0.9, pulse)) * R grows with the pulse, so more dust shows at the peak, only the nearest at the minimum (edge 0.12 R); ~13 % twinkle; never beyond the contour;
// (2) OUTER dust hugging the curves of the funnel (top / bottom parts, never closer to the centre than ~1.3 R), slow, following the same curve phase as the lines with smaller amplitude.
// All particle motion is a pure function of the clock with integer harmonics of a 24 s loop (the line formulas are the lines' own).
// Orthographic camera rotated 90 deg, the funnel width is always fully visible, line ends run past the top / bottom edge of the canvas (cropped by the canvas); no cursor reaction (animated by the clock only).
// Renders only while the container is on screen and the tab is visible; prefers-reduced-motion = one static frame (t = 3). DPR <= 2 (capDpr: <= 1.5 on <= 1199).
// No WebGL -> returns null (the caller hides the container).
import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Vector3, Color, SRGBColorSpace, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  ShaderMaterial, LineSegments, LineBasicMaterial, LineLoop, Mesh, PlaneGeometry, Sphere, Clock, Points,
} from 'three';
import { capDpr } from '../utils/dpr.js';

const HALF_W = 16 / 9, R = 0.25, STATIC_T = 3, HALF_SIDE = 0.75;   // HALF_SIDE = half-width of the (vertical) funnel across the canvas, world units: the camera is rotated 90 deg, so the lines run top <-> bottom
const SEG = 240, N = 10, CYC = 1.7;

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
const PT_VERT = `
  attribute float aK; attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD; attribute vec4 aM;
  uniform float uT, uHalfW, uXmax, uR, uPulse, uPx, uHw, uHs; varying float vA; varying float vS;
  float sm5(float a, float b, float x){ x = clamp((x - a) / (b - a), 0.0, 1.0); return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
  void main(){
    float ph = 6.2831853 * uT / 24.0;
    vec3 p; float a, sz;
    if (aK < 0.5) {            // outer dust: sits beside a curve of the funnel (same formula as the lines, smaller amplitude), slow drift along it, never near the core
      float xa = mix(0.4, max(uHw, 0.55) * 1.02, aM.x) + 0.03 * sin(ph * aD.y + aB.z);
      float t = xa / uHalfW;
      float w = sm5(aD.x, 1.0, t);
      float br = 1.0 + 0.3 * sin(0.21 * uT + aB.w);
      float y = w * (aA.x + aA.y * (min(t, 1.0) - 0.45) + 0.8 * (aA.z * br * sin(aB.x * t + aB.z + aC.x * uT) + aA.w * sin(aB.y * t + aB.w + aC.y * uT)));
      y += aM.w * sin(ph * aD.y + aB.w);
      p = vec3(aC.z * xa, y, 0.0);
      a = (0.2 + 0.3 * aD.w) * (0.8 + 0.2 * sin(ph * aD.y + aB.z)) * (1.0 - smoothstep(uHw * 0.9, uHw * 1.04, xa));
      sz = 2.2 + 1.6 * aM.z;
    } else {                   // inner dust: fixed brightness / size / positions (slow drift only); visible only inside the light radius of the core, which grows with the pulse
      float pl = smoothstep(0.08, 0.9, uPulse);
      float lightR = mix(0.3, 1.0, pl);                  // in units of R
      vec3 wob = 0.11 * vec3(sin(ph * aB.x + aC.x), sin(ph * aB.y + aC.y), sin(ph * aB.z + aC.z));
      p = uR * (aA.w * aA.xyz + wob);                    // |p| <= (0.58 + 0.19) R < R; wavy orbit-like drift
      float d = length(p.xy) / uR;
      a = (0.5 + 0.15 * aM.z) * (1.0 - smoothstep(lightR - 0.4, lightR + 0.12, d));   // soft feather ~0.4 R
      if (aD.z > 0.5) a = max(a, 0.3);                   // ~20 % permanent dust near the core, visible at the pulse minimum too
      if (aM.y > 0.87) a *= 0.65 + 0.35 * sin(ph * aD.y + aC.w);   // ~13 % twinkle with their own phase
      sz = 2.4 + 1.4 * aM.z;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = min(a, 0.68); vS = sz * uPx; gl_PointSize = vS;
  }`;
const PT_FRAG = `uniform vec3 uInk; varying float vA; varying float vS;
  void main(){ vec2 d = gl_PointCoord - 0.5; float l = length(d); if (l > 0.5) discard; gl_FragColor = vec4(uInk, vA * clamp((0.5 - l) * vS, 0.0, 1.0)); }`;
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
  const horizMq = matchMedia('(max-width: 767px)');   // mobile: funnel lies HORIZONTALLY (world x -> screen horizontal); tablet / desktop: vertical (camera rotated 90 deg)
  const scene = new Scene();

  /* ---------- bundles: chaotic curves per side, converging into one line ---------- */
  const aS = [], aA = [], aB = [], aC = [], aD = [];
  const lines = [], lp = [];
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
      lp.push({ side, y0, slope, amp1, amp2, k1, k2, ph1, ph2, sp1, sp2, csp, c0, op });
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

  /* ---------- particles: outer dust beside the curves, inner dust inside the sphere (one Points, flat discs) ---------- */
  const lite = matchMedia('(max-width: 1199px)').matches;
  const [N_FLOW, N_CORE] = lite ? [40, 110] : [56, 140];
  const NPT = N_FLOW + N_CORE;
  const pr = rng(53), pk = new Float32Array(NPT), pa = new Float32Array(NPT * 4), pb = new Float32Array(NPT * 4), pc = new Float32Array(NPT * 4), pd = new Float32Array(NPT * 4), pm = new Float32Array(NPT * 4);
  const hr = (n) => 1 + Math.floor(pr() * n);
  for (let i = 0; i < NPT; i++) {
    const m4 = [pr(), pr(), pr(), 0];
    if (i < N_FLOW) {
      const l = lp[(i % 2 ? N : 0) + Math.floor(pr() * N)];      // first N lines = side -1, next N = side +1
      pk[i] = 0;
      pa.set([l.y0, l.slope, l.amp1, l.amp2], i * 4); pb.set([l.k1, l.k2, l.ph1, l.ph2], i * 4); pc.set([l.sp1, l.sp2, l.side, l.csp], i * 4);
      pd.set([l.c0, hr(2), 0, l.op], i * 4);
      m4[3] = (pr() < 0.5 ? -1 : 1) * (0.015 + 0.045 * pr());    // perpendicular offset from the curve
    } else {
      pk[i] = 1;
      const u = [pr() - 0.5, pr() - 0.5, pr() - 0.5], ul = Math.hypot(...u) || 1;
      pa.set([u[0] / ul, u[1] / ul, u[2] / ul, 0.04 + (i % 5 === 0 ? 0.36 : 0.54) * Math.cbrt(pr())], i * 4);
      pb.set([hr(3), hr(3), hr(3), 0], i * 4);
      pc.set([pr() * 6.283, pr() * 6.283, pr() * 6.283, pr() * 6.283], i * 4);
      pd.set([0, hr(3), i % 5 === 0 ? 1 : 0, 0], i * 4);
    }
    pm.set(m4, i * 4);
  }
  const ptGeo = new BufferGeometry();
  ptGeo.setAttribute('position', new BufferAttribute(new Float32Array(NPT * 3), 3));
  ptGeo.setAttribute('aK', new BufferAttribute(pk, 1));
  [['aA', pa], ['aB', pb], ['aC', pc], ['aD', pd], ['aM', pm]].forEach(([n, a]) => ptGeo.setAttribute(n, new BufferAttribute(a, 4)));
  ptGeo.boundingSphere = new Sphere(new Vector3(), 20);
  const ptU = { uT: { value: 0 }, uHalfW: lineMat.uniforms.uHalfW, uXmax: lineMat.uniforms.uXmax, uR: { value: R }, uPulse: { value: 0 }, uPx: { value: 1 }, uHw: { value: 1 }, uHs: { value: HALF_SIDE }, uInk: { value: ink } };
  const ptMat = new ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, uniforms: ptU, vertexShader: PT_VERT, fragmentShader: PT_FRAG });
  const dust = new Points(ptGeo, ptMat);
  dust.frustumCulled = false; dust.renderOrder = 5;
  scene.add(dust);

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
    const dpr = capDpr(2);
    renderer.setPixelRatio(dpr); ptU.uPx.value = dpr;
    renderer.setSize(W, Hh, false);
    let hs;
    if (horizMq.matches) {
      // mobile: screen vertical = world y (half-height HALF_SIDE), screen horizontal = world x (half-length hw = HALF_SIDE * W / Hh); no rotation
      camera.rotation.z = 0;
      hs = HALF_SIDE; hw = hs * W / Hh;
      camera.left = -hw; camera.right = hw; camera.top = hs; camera.bottom = -hs;
    } else {
      // screen horizontal = world y (half-width HALF_SIDE), screen vertical = world x (half-length hw = HALF_SIDE * Hh / W)
      camera.rotation.z = Math.PI / 2;
      hs = Math.max(HALF_SIDE, 0.65 * W / Hh);   // wide short canvas: zoom out so the funnel keeps a readable length
      hw = hs * Hh / W;
      camera.left = -hs; camera.right = hs; camera.top = hw; camera.bottom = -hw;
    }
    camera.updateProjectionMatrix();
    ptU.uHw.value = hw; ptU.uHs.value = hs;
    lineMat.uniforms.uHalfW.value = Math.max(hw * 0.9, 0.55);  // wave envelope scales with the visible length
    lineMat.uniforms.uXmax.value = hw * 1.15 + 0.12;   // curve start always beyond the visible edge (top / bottom)
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
    lineMat.uniforms.uT.value = T; ptU.uT.value = T; ptU.uPulse.value = (!animated && fixedT === null && reducedMq.matches) ? 0.5 : Math.min(procS, 1.5);   // reduced motion: static frame, inner dust at a mid alpha
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
  const onOrient = () => { if (resize() && !raf) draw(false); };
  horizMq.addEventListener('change', onOrient);
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
    horizMq.removeEventListener('change', onOrient);
    canvas.removeEventListener('webglcontextlost', onLost);
    geos.forEach((g) => g.dispose());
    ptGeo.dispose(); ptMat.dispose();
    lineMat.dispose(); arcMat.dispose(); ringMat.dispose(); dotMat.dispose();
    renderer.dispose();
    canvas.remove();
  };

  resize();
  // debug hook (checks only): freeze the timeline at t seconds (null = live clock)
  host.__closing = { energy: pulseEnergy, counts: { flow: N_FLOW, core: N_CORE }, setT(t) { fixedT = t; if (!raf) draw(false); }, get running() { return !!raf; }, ink: ink.toArray(), started: () => started };
  return { destroy };
}
