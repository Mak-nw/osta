// Compact header menu (<= 1199px): burger toggles the dropdown of the floating panel (Services, About Us).
// The burger is hidden by CSS from 1200px up, so on desktop this module does nothing visible.
// Tab order = visual order. Desktop DOM: left{burger, nav{Products, Services, About}}, logo, actions{lang, CTA}.
// Compact visual order: burger, Products, logo, lang, CTA, then the menu items. No CSS can change Tab order, so while the viewport
// is <= 1199px the nodes are re-parented: left{burger, Products}, logo, actions{lang, CTA}, nav{Services, About}
// (grid-areas in nav.css place them; at >= 1200 the desktop order is restored, so desktop is unchanged).
import { t } from './i18n.js';

const panel = document.querySelector('[data-header-panel]');
const btn = panel?.querySelector('[data-menu-toggle]');

if (panel && btn) {
  const left = panel.querySelector('[data-header-left]');
  const nav = panel.querySelector('.header__nav');
  const logo = panel.querySelector('.header__logo');
  const actions = panel.querySelector('.header__actions');
  const primary = panel.querySelector('[data-nav-primary]');
  const compact = matchMedia('(max-width: 1199px)');

  const arrange = () => {
    if (compact.matches) { left.append(btn, primary); panel.append(logo, actions, nav); }
    else { nav.prepend(primary); left.append(btn, nav); panel.append(logo, actions); }
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
  compact.addEventListener('change', () => { if (!compact.matches) set(false); arrange(); });
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
