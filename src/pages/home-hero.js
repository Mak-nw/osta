// Home hero search: submit -> catalog with ?q= (whitespace normalised; empty query = plain catalog). Without JS the GET form does the same.
import { pageUrl } from '../utils/url.js';

const form = document.querySelector('.hero-search');
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = form.querySelector('input[name="q"]').value.trim().replace(/\s+/g, ' ');
  location.href = v ? `${pageUrl('/catalog.html')}?q=${encodeURIComponent(v)}` : pageUrl('/catalog.html');
});

// Typing placeholder (visual only, aria-hidden overlay; the input keeps a static accessible placeholder).
// Names are real catalog items (not translated). Hidden by CSS on focus / non-empty value.
import products from '../data/products.json';

const NAMES = ['Ibuprofen', 'Metformin Hydrochloride', 'Azithromycin', 'Magnesium Hydroxide', 'Pancreatin', 'Anastrozole', 'Crospovidone Type A', 'Glycine (Aminoacetic Acid)']
  .filter((n) => products.some((p) => p.name === n));
const TYPE_MS = 80, ERASE_MS = 40, HOLD_MS = 1200, GAP_MS = 350;
const box = document.querySelector('[data-hero-type]');
const text = box?.querySelector('.hero-type__text');
if (text && NAMES.length) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    text.textContent = NAMES[0]; // static line, no animation
  } else {
    let i = 0, n = 0, phase = 'type', timer = 0, visible = true;
    const tick = () => {
      clearTimeout(timer);
      if (document.hidden || !visible) return; // paused; resumed by visibilitychange / IntersectionObserver
      const name = NAMES[i];
      let delay;
      if (phase === 'type') {
        n += 1; text.textContent = name.slice(0, n);
        if (n >= name.length) { phase = 'erase'; delay = HOLD_MS; } else delay = TYPE_MS;
      } else {
        n -= 1; text.textContent = name.slice(0, n);
        if (n <= 0) { phase = 'type'; i = (i + 1) % NAMES.length; delay = GAP_MS; } else delay = ERASE_MS;
      }
      timer = setTimeout(tick, delay);
    };
    document.addEventListener('visibilitychange', tick);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; tick(); }).observe(box);
    tick();
  }
}
