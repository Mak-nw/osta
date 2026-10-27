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
