// About hero (about.html): loads the contour sphere (about-hero-sphere.js) after first paint. Was an inline module script, which Vite dev served as text/html (html-proxy) in the EN/DE console.
// Hero contour sphere (three.js, about-hero-sphere.js; the old hero-3d.js is disconnected): after first paint; any failure leaves the static poster as fallback.
const media = () => document.querySelector('[data-hero-media]');
const fallback = () => {};   // no WebGL / failure: the static poster (img[data-hero-poster], utils/hero-poster.js) stays as the hero art
const start = () => import('./about-hero-sphere.js')
  .then((m) => { if (!m.initAboutHeroSphere(media())) fallback(); })
  .catch(fallback);
const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 800 }) : setTimeout(start, 0));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', idle); else idle();
