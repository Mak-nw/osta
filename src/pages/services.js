// Services page behaviour:
// 1) hero 3D trajectories scene (services-hero-trajectories.js, lazy after first paint; the old globe services-hero-globe.js is disconnected);
// 2) Process scroll: sticky scene, the scroll progress through the 200svh wrapper picks the active stage 01-04 and drives the 3D scene (lazy);
// Everything scroll-linked is read in one rAF per scroll/resize; prefers-reduced-motion = static layout (CSS) and no updates here.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - (1 - t) ** 3;

// 1) hero 3D trajectories strip (three.js, lazy after first paint; no WebGL / failure = the empty strip is hidden)
const sceneHost = () => document.querySelector('[data-hero-scene]');
const startScene = () => import('./services-hero-trajectories.js')
  .then((m) => m.initHeroTrajectories(sceneHost()))
  .then((r) => { if (!r) sceneHost()?.classList.add('hero--no3d'); })
  .catch(() => sceneHost()?.classList.add('hero--no3d'));
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 0));
if (sceneHost()) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => idle(startScene)); else idle(startScene); }

// progress of a sticky wrapper: 0 when its scene starts sticking, 1 when it is released
// --header-h is a calc() token: resolve it through a hidden probe element
const probe = document.createElement('div');
probe.setAttribute('aria-hidden', 'true');
probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(--header-h)';
document.body.append(probe);
const headerH = () => probe.offsetHeight;
const stickyProgress = (wrap, stage) => {
  const r = wrap.getBoundingClientRect();
  const run = r.height - stage.offsetHeight;
  return run > 0 ? clamp01((headerH() - r.top) / run) : 1;
};

// 2) Process scroll
const noPin = matchMedia('(max-width: 1199px) and (max-height: 560px)'); // landscape phones: CSS switches the pin off (services.css), the scene is static like reduced motion
const isStatic = () => reduced.matches || noPin.matches;
const proc = document.querySelector('[data-process-scroll]');
const procStage = proc?.querySelector('.process-scroll__stage');
const procItems = proc ? [...proc.querySelectorAll('.process-steps__item')] : [];
const art = proc?.querySelector('[data-process-art]');
let scene3d = null;
if (art) {
  const load = () => import('./services-process-3d.js').then((m) => { scene3d = m.initProcessScene(art); update(); }).catch(() => null);
  const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '100% 0px' });
  io.observe(art);
}
const updateProcess = () => {
  if (!proc) return;
  const p = isStatic() ? 1 : stickyProgress(proc, procStage);
  const stage = Math.min(4, Math.floor(p * 4) + 1);
  proc.dataset.stage = String(stage);
  procItems.forEach((li, i) => { const on = !isStatic() && i + 1 === stage; li.classList.toggle('is-active', on); if (on) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  scene3d?.setProgress(p);
  centreStage(stage);
};
// mobile strip of stages (services.css): the active stage glides to the horizontal centre of the strip
const strip = proc?.querySelector('.process-steps');
let centred = 0;
const centreStage = (stage) => {
  if (!strip || stage === centred || isStatic() || strip.scrollWidth <= strip.clientWidth) return;
  centred = stage;
  const li = procItems[stage - 1];
  strip.scrollTo({ left: li.offsetLeft + li.offsetWidth / 2 - strip.clientWidth / 2, behavior: reduced.matches ? 'auto' : 'smooth' });
};

// (How we work highlight: src/utils/how-split.js, started from main.js)

let ticking = false;
function update() { ticking = false; updateProcess(); }
const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
addEventListener('scroll', request, { passive: true });
addEventListener('resize', request);
reduced.addEventListener('change', request);
noPin.addEventListener('change', request);
document.fonts?.ready.then(request);
update();
