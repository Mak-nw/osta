// Home hero: scroll-linked growth of the photo panel. Only writes --hero-grow (0..1) on .hero--home; geometry lives in hero.css.
// Active on desktop (min-width 1200px) when motion is allowed; otherwise the CSS variable stays 0 (static look).
export function initHeroGrow() {
  const hero = document.querySelector('.hero--home');
  if (!hero || !hero.querySelector('.hero__scene')) return;
  const mq = window.matchMedia('(min-width: 1200px) and (prefers-reduced-motion: no-preference)');
  let on = false;
  let raf = 0;
  let last = -1;
  let len = 1;
  const MIN_LEN = 200; // px, safety floor of the effect length

  // Effect length: scroll distance after which the panel top (no overlap left at p=1) reaches the bottom edge of the floating header panel,
  // i.e. the grown photo then fills the screen under the header. Measured, so it is right for any viewport and layout height.
  const measure = () => {
    const layer = hero.querySelector('.hero__layer');
    const hp = document.querySelector('.header__panel');
    const headerBottom = hp ? hp.getBoundingClientRect().bottom : 0; // header is fixed/sticky: viewport coordinates
    const layerBottomDoc = layer.getBoundingClientRect().bottom + window.scrollY;
    len = Math.max(MIN_LEN, layerBottomDoc - headerBottom);
  };

  const update = () => {
    raf = 0;
    const y = window.scrollY; // same value the layout uses (Lenis writes it to the native scroll position)
    const p = Math.min(1, Math.max(0, y / len));
    if (Math.abs(p - last) < 0.0005) return;
    last = p;
    hero.style.setProperty('--hero-grow', p.toFixed(4));
  };
  const onResize = () => { last = -1; measure(); request(); };
  const request = () => { if (!raf) raf = requestAnimationFrame(update); };

  const enable = () => {
    if (on) return;
    on = true;
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', onResize);
    if (window.lenis && window.lenis.on) window.lenis.on('scroll', request);
    last = -1;
    measure();
    update();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  };
  const disable = () => {
    if (!on) return;
    on = false;
    window.removeEventListener('scroll', request);
    window.removeEventListener('resize', onResize);
    if (window.lenis && window.lenis.off) window.lenis.off('scroll', request);
    hero.style.removeProperty('--hero-grow');
  };
  const sync = () => (mq.matches ? enable() : disable());
  mq.addEventListener('change', sync);
  sync();
}
