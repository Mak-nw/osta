// Mobile header menu (<= 767px): burger toggles the dropdown of the floating panel (nav links + Contact Us).
// The button is hidden by CSS from 768px up, so on desktop/tablet this module does nothing visible.
// Tab order: on desktop the DOM is burger, nav, logo, [lang, CTA] (= visual order). On mobile the visual order is
// logo, lang, burger, menu items, CTA, so the elements are re-parented in that order while the viewport is <= 767px
// (the grid-areas in nav.css place them; no CSS can change Tab order).
import { t } from './i18n.js';

const panel = document.querySelector('[data-header-panel]');
const btn = panel?.querySelector('[data-menu-toggle]');

if (panel && btn) {
  const nav = panel.querySelector('.header__nav');
  const logo = panel.querySelector('.header__logo');
  const actions = panel.querySelector('.header__actions');
  const lang = panel.querySelector('[data-lang-menu]');
  const cta = panel.querySelector('.header__cta');
  const mobile = matchMedia('(max-width: 767px)');

  const arrange = () => {
    if (mobile.matches) panel.append(logo, lang, btn, nav, cta);
    else { panel.prepend(btn, nav, logo, actions); actions.append(lang, cta); }
  };

  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const label = () => {
    const key = isOpen() ? 'nav.menu_close' : 'nav.menu';
    btn.dataset.i18nAttr = 'aria-label:' + key; // applyLang() then keeps the right label after a language switch
    const txt = t(key);
    if (txt) btn.setAttribute('aria-label', txt);
  };
  const set = (open, back = false) => {
    btn.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-menu-open', open);
    label();
    if (!open && back) btn.focus();
  };

  arrange();
  mobile.addEventListener('change', () => { if (!mobile.matches) set(false); arrange(); });
  btn.addEventListener('click', () => set(!isOpen()));
  // capture: runs before the language menu closes itself, so Esc over an open language list closes only that list
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    if (document.querySelector('.lang-menu.is-open')) return;
    e.preventDefault(); set(false, true);
  }, true);
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !panel.contains(e.target)) set(false); });
  panel.addEventListener('click', (e) => { if (isOpen() && e.target.closest('a[href]')) set(false); });
  panel.addEventListener('focusout', (e) => { if (isOpen() && e.relatedTarget && !panel.contains(e.relatedTarget)) set(false); });
  label();
}
