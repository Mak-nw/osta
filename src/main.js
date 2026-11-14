import { initI18n } from './i18n.js';
import './motion.js';
import './header-menu.js';
import { initHowSplit } from './utils/how-split.js';

// Mark active nav pill
const page = document.body.dataset.page;
document.querySelectorAll('[data-nav]').forEach((a) => {
  if (a.dataset.nav === page) a.classList.add('is-active');
});

initI18n();
initHowSplit(); // active-step highlight of the How-we-work split (Services, Home Services)

// Closing CTA scene (Home, About, Services): three.js converge lines, loaded lazily only where the block exists; no WebGL or any failure hides the container.
const closingScene = document.querySelector('[data-closing-scene]');
if (closingScene) {
  const hide = () => { closingScene.hidden = true; };
  const start = () => import('./pages/closing-lines.js')
    .then((m) => { if (!m.initClosingLines(closingScene)) hide(); })
    .catch(hide);
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 800 }); else setTimeout(start, 0);
}

// Home Products cards: three looping three.js line scenes (one shared renderer), lazy and only where the containers exist; failure leaves the card without art.
const productScenes = document.querySelectorAll('.link-card__art[data-scene]');
if (productScenes.length) {
  const start = () => import('./pages/home-product-scenes.js').then((m) => { m.initHomeProductScenes(productScenes); }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 800 }); else setTimeout(start, 0);
}

// Home Quality cards (EudraGMDP, GDP): two looping point-line scenes on one shared renderer; lazy, failure leaves the card without art.
const qualityScenes = document.querySelectorAll('.quality-card__art[data-scene]');
if (qualityScenes.length) {
  const start = () => import('./pages/home-quality-scenes.js').then((m) => { m.initHomeQualityScenes(qualityScenes); }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 800 }); else setTimeout(start, 0);
}

// Home hero scene (particles -> rays -> pill): lazy, after the first frame; any failure / no WebGL leaves the plain blue hero.
const heroScene = document.querySelector('.hero--home [data-hero-scene]');
if (heroScene) {
  import('./pages/home-hero-poster.js').then((m) => m.initHomeHeroPoster(heroScene)).catch(() => {});   // size the poster with the live scene's fit, at once (not idle)
  const start = () => import('./pages/home-hero-scene.js').then((m) => { m.initHomeHeroScene(heroScene); }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 800 }); else setTimeout(start, 0);
}

// Home hero search: submit -> /catalog.html?q=... (works without JS as a plain GET form).
if (document.querySelector('.hero-search')) import('./pages/home-hero.js').catch(() => {});
