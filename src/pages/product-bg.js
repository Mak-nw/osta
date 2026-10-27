/* Product page background: fullscreen fragment shader with drifting topographic isolines.
   Ported 1:1 from the customer's corner-outline-shader. Decorative only (aria-hidden).
   Colours come from tokens (--surface, --shader-line); if WebGL is unavailable or the
   shader fails, the canvas is removed and the solid --surface background stays. */

import { tokenToRgb } from '../utils/css-color.js';
import { capDpr } from '../utils/dpr.js';

const CONFIG = {
  lineStrength: 0.7,    // 0..1: line strength
  lineFreq:     6.0,    // isoline frequency
  driftSpeed:   0.12,   // flow speed
  patternScale: 0.0022, // noise field scale
  lineWidth:    1.3,    // line width multiplier
  fillBands:    1,      // 1 = tint bands between lines
  fillStrength: 0.05,   // band tint strength
  visVariation: 0.55,   // 0..1: how strongly blotches dim the pattern
  visScale:     0.0009, // blotch scale
};

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;      // ~30 fps cap
const STATIC_TIME = 12.0;        // fixed time for the reduced-motion still frame

/* Shared shader body (GLSL ES 1.00 / 3.00 differences are handled by the prelude). */
const FRAG_BODY = `
precision highp float;
uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uBgColor;
uniform vec3  uLineColor;
uniform float uStrength;
uniform float uFreq;
uniform float uDrift;
uniform float uScale;
uniform float uLineWidth;
uniform float uFillBands;
uniform float uFillStrength;
uniform float uVisVariation;
uniform float uVisScale;

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
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
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
  vec2 uv = gl_FragCoord.xy;
  vec3 col = uBgColor;

  float visN = fbm(uv * uVisScale + vec2(500.0, 200.0) + uTime * 0.01);
  float visMask = mix(1.0 - uVisVariation, 1.0, visN);

  vec2 p = uv * uScale;
  float h  = fbmFlow(p, uTime * uDrift) * 0.65 + fbmFlow(p * 1.7 + 5.0, uTime * uDrift * 1.3) * 0.55;

  float t = h * uFreq;
  float lw = (fwidth(t) + 0.001) * uLineWidth;
  float lines = 1.0 - clamp(abs(fract(t - 0.5) - 0.5) / lw, 0.0, 1.0);

  if (uFillBands > 0.5) {
    float band = floor(t);
    float tint = hash(vec2(band, band * 1.37)) * uFillStrength;
    col += tint * visMask;
  }

  col = mix(col, uLineColor, lines * uStrength * visMask);
  FRAG_OUT = vec4(col, 1.0);
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

function init() {
  const canvas = document.createElement('canvas');
  canvas.className = 'page-bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);

  const bail = () => { try { canvas.remove(); } catch (e) { /* noop */ } };

  try {
    const bg = tokenToUnit('--surface');
    const line = tokenToUnit('--shader-line');
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
    gl.uniform1f(u('uStrength'), CONFIG.lineStrength);
    gl.uniform1f(u('uFreq'), CONFIG.lineFreq);
    gl.uniform1f(u('uDrift'), CONFIG.driftSpeed);
    gl.uniform1f(u('uScale'), CONFIG.patternScale);
    gl.uniform1f(u('uLineWidth'), CONFIG.lineWidth);
    gl.uniform1f(u('uFillBands'), CONFIG.fillBands);
    gl.uniform1f(u('uFillStrength'), CONFIG.fillStrength);
    gl.uniform1f(u('uVisVariation'), CONFIG.visVariation);
    gl.uniform1f(u('uVisScale'), CONFIG.visScale);
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

    const resize = () => {
      const dpr = capDpr(MAX_DPR);
      const w = Math.max(1, Math.round(window.innerWidth * dpr));
      const h = Math.max(1, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
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
