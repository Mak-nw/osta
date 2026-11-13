// Scroll-scrubbed text fill: words start muted and turn white one after another as the page scrolls (reversible).
// Used for the Home About heading ([data-scroll-fill]). Vanilla: scroll/resize + rAF, active only while the block is near the viewport.
const START = 0.8; // fill begins when the top of the text enters the lower 80% of the viewport
const END = 0.5;   // fill is complete when the bottom of the text reaches 50% of the viewport
const SOFT = 4;    // how many words are mid-fill at once (soft edge instead of a hard word-by-word step)

function wrap(node, words) {
  [...node.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/([ \t\n\r]+)/).forEach((p) => {
        if (!p) return;
        if (/^[ \t\n\r]+$/.test(p)) { frag.append(p); return; } // ASCII whitespace only: NBSP stays inside its word
        const w = document.createElement('span');
        w.className = 'fill-word';
        w.setAttribute('aria-hidden', 'true');
        w.textContent = p;
        words.push(w);
        frag.append(w);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1 && n.tagName !== 'BR') wrap(n, words);
  });
}

export function initScrollFill(el, reduced) {
  let words = [];
  let near = false;
  let raf = 0;

  function paint() {
    raf = 0;
    if (!words.length) return;
    const vh = innerHeight;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (vh * START - r.top) / (vh * (START - END) + r.height)));
    const n = words.length;
    words.forEach((w, i) => {
      const p = Math.min(1, Math.max(0, (t * (n + SOFT) - i) / SOFT));
      w.style.setProperty('--p', p.toFixed(3));
    });
  }
  const schedule = () => { if (!raf && near) raf = requestAnimationFrame(paint); };

  // (re)build after every translation pass: i18n rewrites the heading HTML
  function build() {
    if (reduced.matches) return;
    if (el.querySelector('.fill-word')) return;
    words = [];
    const probe = el.cloneNode(true);
    probe.querySelectorAll('*').forEach((c) => c.after(' ')); // block-like sentence spans: keep a space between them
    el.setAttribute('aria-label', probe.textContent.replace(/­/g, '').replace(/\s+/g, ' ').trim());
    wrap(el, words);
    el.classList.add('is-fill');
    paint();
  }

  if (reduced.matches) return { build };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      near = es.some((e) => e.isIntersecting);
      el.classList.toggle('is-fill-active', near); // will-change only while on screen
      if (near) paint();
    }, { rootMargin: '20% 0px 20% 0px' }).observe(el);
  } else near = true;
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { near = true; schedule(); }, { passive: true });
  document.fonts?.ready.then(() => { near = true; paint(); });
  build();
  return { build };
}
