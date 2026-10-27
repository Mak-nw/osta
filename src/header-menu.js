// Mobile header menu (<= 767px): burger toggles the dropdown of the floating panel (nav links + Contact Us).
// The button is hidden by CSS from 768px up, so on desktop/tablet this module does nothing visible.
const panel = document.querySelector('[data-header-panel]');
const btn = panel?.querySelector('[data-menu-toggle]');

if (panel && btn) {
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const set = (open, back = false) => {
    btn.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-menu-open', open);
    if (!open && back) btn.focus();
  };
  btn.addEventListener('click', () => set(!isOpen()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); set(false, true); }
  });
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !panel.contains(e.target)) set(false); });
  panel.addEventListener('click', (e) => { if (isOpen() && e.target.closest('a[href]')) set(false); });
  matchMedia('(min-width: 768px)').addEventListener('change', (e) => { if (e.matches) set(false); });
}
