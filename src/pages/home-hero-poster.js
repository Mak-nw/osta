// Home hero poster sizing: the static poster (img[data-hero-poster], frame 0 of home-hero-scene.js) is placed with the SAME fit as the live scene (home-hero-fit.js: centre + css px per world unit),
// so when the live canvas takes over (utils/hero-poster.js) nothing moves. Before this runs (first paint) CSS gives an approximation (--hp-* defaults in components/hero.css).
// Re-fits on host resize, fonts ready and after the title reveal (same triggers as the live scene) until the poster is handed over (hidden).
import { computeHeroFit, placePoster } from './home-hero-fit.js';
import { whenPageLoaded } from '../utils/hero-poster.js';

export function initHomeHeroPoster(host) {
  const poster = host.querySelector('[data-hero-poster]');
  if (!poster) return;
  let ro = null, mo = null, timer = 0, raf = 0, poll = 0;
  const stop = () => { ro?.disconnect(); mo?.disconnect(); clearTimeout(timer); clearInterval(poll); cancelAnimationFrame(raf); };
  const apply = () => {
    if (poster.hidden) { stop(); return; }
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    placePoster(host, computeHeroFit(host, W, H));
  };
  const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); };
  // until the page is fully loaded (fonts, images) the title is laid out in the fallback font and keeps moving: a fit computed now would be wrong by ~10 %. CSS gives the default (measured, ~1-3 %) until then;
  // JS takes over once the page is loaded - the same moment the live scene is released, which then keeps the poster on ITS fit (placePoster on every live fit).
  const start = () => {
    apply();
    ro = new ResizeObserver(later); ro.observe(host);
    const h1 = (host.closest('.hero') || document).querySelector('.hero__title');
    if (h1) { mo = new MutationObserver(later); mo.observe(h1, { childList: true, subtree: true }); }
    timer = setTimeout(later, 1600);
    // layout keeps settling during load (images, title reveal) without any observer firing: follow it every 100 ms until the hand-over, so the poster is at the live fit when it is swapped
    poll = setInterval(apply, 100);
  };
  whenPageLoaded().then(start);
}
