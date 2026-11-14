/* Product page background: fullscreen fragment shader with slowly drifting topographic isolines.
   Customer 2026-11-13: sharp vector lines, no pixelation / blur, no dirty colours. Rendered at NATIVE resolution
   (canvas = CSS size x devicePixelRatio, DPR capped at 2, no upscale), pattern scale in CSS px (so DPR does not change the look),
   every line is 1 device px with analytic anti-aliasing (fwidth), ONE line colour (--accent at low alpha) on --surface:
   no fill bands, no blotch mask, no colour mixing. Colours come from tokens. Decorative only (aria-hidden).
   Very slow drift; reduced-motion = one static frame; paused when the tab is hidden. If WebGL is unavailable or
   the shader fails, the canvas is removed and the solid --surface background stays. */

import { tokenToRgb } from '../utils/css-color.js';

const CONFIG = {
  lineAlpha:    0.13,   // line opacity over --surface (0.10..0.16)
  lineFreq:     6.0,    // isoline frequency
  driftSpeed:   0.025,  // very slow flow
  patternScale: 0.0022, // noise field scale per CSS px
  maskMin:      0.30,   // line alpha multiplier in the centre behind the text (0.25..0.35)
  maskInner:    0.55,   // normalised radius where the full dimming ends and the fade to 1.0 begins
  maskRx:       0.9,    // X radius = content column width x this
  maskRy:       0.9,    // Y radius = hero content height x this
};

const MAX_DPR = 2;
const FRAME_MS = 1000 / 24;      // frame cap
const STATIC_TIME = 12.0;        // fixed time for the reduced-motion still frame

/* Shared shader body (GLSL ES 1.00 / 3.00 differences are handled by the prelude). */
const FRAG_BODY = `
precision highp float;
uniform vec2  uResolution;
uniform float uDpr;
uniform float uTime;
uniform vec3  uBgColor;
uniform vec3  uLineColor;
uniform float uAlpha;
uniform float uFreq;
uniform float uDrift;
uniform float uScale;
uniform vec2  uMaskC;    // centre of the content in CSS px (origin top-left of the viewport)
uniform vec2  uMaskR;    // ellipse radii in CSS px (0 = mask off)
uniform float uMaskMin;
uniform float uMaskInner;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), f.x),
    mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x),
    f.y);
}
float fbmFlow(vec2 p, float time) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 dir = vec2(cos(fi * 2.399963), sin(fi * 1.741234));
    s += a * noise(p + dir * time * (0.35 + fi * 0.22));
    p = p * 2.02 + vec2(17.0, 41.0);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 p = (gl_FragCoord.xy / uDpr) * uScale;   // pattern in CSS px
  float h = fbmFlow(p, uTime * uDrift) * 0.65 + fbmFlow(p * 1.7 + 5.0, uTime * uDrift * 1.3) * 0.55;

  float t = h * uFreq;
  float gw = max(fwidth(t), 1e-5);                       // t change per DEVICE px
  float d = abs(fract(t - 0.5) - 0.5) / gw;              // distance to the isoline in device px
  float line = clamp(1.0 - (d - 0.5), 0.0, 1.0);         // 1 device px wide, analytic AA

  /* radial dimming of the lines behind the text, done in the shader (no CSS gradient / mask-image) */
  float k = 1.0;
  if (uMaskR.x > 0.0 && uMaskR.y > 0.0) {
    vec2 c = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uDpr;
    float dn = length((c - uMaskC) / uMaskR);
    k = mix(uMaskMin, 1.0, smoothstep(uMaskInner, 1.0, dn));
  }

  FRAG_OUT = vec4(mix(uBgColor, uLineColor, line * uAlpha * k), 1.0);
}
`;

const VERT_300 = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
const FRAG_300 = `#version 300 es
${FRAG_BODY.replace('precision highp float;', 'precision highp float;\nout vec4 fragColor;').replace('FRAG_OUT', 'fragColor')}`;

const VERT_100 = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
const FRAG_100 = `#extension GL_OES_standard_derivatives : enable
${FRAG_BODY.replace('FRAG_OUT', 'gl_FragColor')}`;

/* Token colour -> [r,g,b] in 0..1 (CSS colour parsing is shared: utils/css-color.js). */
function tokenToUnit(name) {
  const rgb = tokenToRgb(name, null);
  return rgb && rgb.map((v) => v / 255);
}

/* 1 device pixel in CSS px, for the 1-device-px strokes of the CTA illustration (IL1). */
function setDevicePx() {
  const set = () => document.documentElement.style.setProperty('--device-px', (1 / (window.devicePixelRatio || 1)).toFixed(4) + 'px');
  set();
  window.addEventListener('resize', set);
}
setDevicePx();

function init() {
  const canvas = document.createElement('canvas');
  canvas.className = 'page-bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);

  const bail = () => { try { canvas.remove(); } catch (e) { /* noop */ } };

  try {
    const bg = tokenToUnit('--surface');
    const line = tokenToUnit('--accent');
    if (!bg || !line) return bail();

    const opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
    let gl = canvas.getContext('webgl2', opts);
    let es3 = !!gl;
    if (!gl) {
      gl = canvas.getContext('webgl', opts);
      if (gl && !gl.getExtension('OES_standard_derivatives')) gl = null;
    }
    if (!gl) return bail();

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, es3 ? VERT_300 : VERT_100);
    const fs = compile(gl.FRAGMENT_SHADER, es3 ? FRAG_300 : FRAG_100);
    if (!vs || !fs) return bail();
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return bail();
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (n) => gl.getUniformLocation(prog, n);
    const uTime = u('uTime');
    gl.uniform3f(u('uBgColor'), bg[0], bg[1], bg[2]);
    gl.uniform3f(u('uLineColor'), line[0], line[1], line[2]);
    gl.uniform1f(u('uAlpha'), CONFIG.lineAlpha);
    gl.uniform1f(u('uFreq'), CONFIG.lineFreq);
    gl.uniform1f(u('uDrift'), CONFIG.driftSpeed);
    gl.uniform1f(u('uScale'), CONFIG.patternScale);
    gl.uniform1f(u('uMaskMin'), CONFIG.maskMin);
    gl.uniform1f(u('uMaskInner'), CONFIG.maskInner);
    const uMaskC = u('uMaskC');
    const uMaskR = u('uMaskR');
    const uDpr = u('uDpr');
    const uRes = u('uResolution');

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const t0 = performance.now();
    let raf = 0;
    let last = 0;

    const draw = (time) => {
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const drawNow = () => draw(motionQuery.matches ? STATIC_TIME : (performance.now() - t0) / 1000);

    /* mask = ellipse around the hero content (breadcrumbs..lead); viewport coords, so it follows the scroll.
       X radius ~ content column width, Y radius ~ hero content height; on phones it spans the full width. */
    const updateMask = () => {
      const head = document.querySelector('.product-hero__head');
      const crumbs = document.querySelector('.product-hero .breadcrumbs');
      if (!head) { gl.uniform2f(uMaskR, 0, 0); return; }
      const a = (crumbs || head).getBoundingClientRect();
      const b = head.getBoundingClientRect();
      const cw = document.documentElement.clientWidth;
      const top = Math.min(a.top, b.top);
      const bottom = Math.max(a.bottom, b.bottom);
      const narrow = cw < 768;
      const colW = narrow ? cw : b.width;
      gl.uniform2f(uMaskC, narrow ? cw / 2 : b.left + b.width / 2, (top + bottom) / 2);
      gl.uniform2f(uMaskR, colW * (narrow ? 0.8 : CONFIG.maskRx), Math.max(1, (bottom - top)) * CONFIG.maskRy);
    };
    let maskRaf = 0;
    const onScroll = () => {
      if (maskRaf) return;
      maskRaf = requestAnimationFrame(() => { maskRaf = 0; updateMask(); if (motionQuery.matches) drawNow(); });
    };

    const resize = () => {
      updateMask();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.round(document.documentElement.clientWidth * dpr));
      const h = Math.max(1, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uDpr, w / document.documentElement.clientWidth);
      drawNow(); // canvas is cleared on resize; repaint immediately
    };

    const loop = (now) => {
      raf = 0;
      if (document.visibilityState !== 'visible' || motionQuery.matches) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw((performance.now() - t0) / 1000);
    };
    const sync = () => {
      const animate = document.visibilityState === 'visible' && !motionQuery.matches;
      if (animate && !raf) raf = requestAnimationFrame(loop);
      if (!animate && raf) { cancelAnimationFrame(raf); raf = 0; }
      if (motionQuery.matches) drawNow();
    };

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); bail(); });
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('load', onScroll);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onScroll);
    const headEl = document.querySelector('.product-hero__head');
    if (headEl && window.ResizeObserver) new ResizeObserver(onScroll).observe(headEl);
    document.addEventListener('visibilitychange', sync);
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', sync);

    resize();
    sync();
  } catch (e) {
    bail();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
