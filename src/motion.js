// Motion: smooth scroll (Lenis), scroll-reveal, anchor scrolling. Everything is off under prefers-reduced-motion.
import Lenis from 'lenis';

const root = document.documentElement;
root.classList.add('js');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const STAGGER_CAP = 8;
const INDEX_MAX = 20; // data-reveal-delay <= 20 is a stagger index, larger is milliseconds
const stagger = () => parseFloat(getComputedStyle(root).getPropertyValue('--stagger')) || 60;

// ---------- Smooth scroll ----------
let lenis = null;

function scrollToHash(hash, opts = {}) {
  if (!hash || hash === '#') return false;
  let el = null;
  try { el = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { /* bad hash */ }
  if (!el) return false;
  // offset 0: Lenis враховує scroll-padding-top (html { scroll-padding-top: var(--header-h) })
  if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.1, ...opts });
  else el.scrollIntoView();
  return true;
}

const samePage = (a) => {
  const norm = (p) => p.replace(/index\.html$/, '').replace(/\/$/, '');
  return a.origin === location.origin && norm(a.pathname) === norm(location.pathname);
};

function initScroll() {
  if (reduced.matches) return;
  lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out
    smoothWheel: true,
    wheelMultiplier: 1,
    anchors: false,
    autoRaf: true,
  });
  window.lenis = lenis;
  document.querySelectorAll('textarea').forEach((t) => t.setAttribute('data-lenis-prevent', ''));

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href*="#"]');
    if (!a || a.target === '_blank') return;
    const u = new URL(a.href, location.href);
    if (!u.hash || !samePage(u)) return;
    if (scrollToHash(u.hash)) {
      e.preventDefault();
      history.pushState(null, '', u.hash);
    }
  });

}

// Link to the current page without a hash (header "About Us" on About): scroll to the very top
// (smooth via Lenis, instant under reduced motion) instead of reloading the page.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href]');
  if (!a || a.target === '_blank') return;
  const u = new URL(a.href, location.href);
  if (u.hash || u.search || !samePage(u) || a.classList.contains('header__logo') === false && !a.matches('[data-nav]')) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(0, { duration: 1.1 });
  else window.scrollTo({ top: 0, behavior: 'instant' });
  if (location.hash) history.pushState(null, '', location.pathname);
});

// Arrive with a hash (from another page or directly): land on the section start and HOLD the position
// while layout settles (fonts, lazy images, 3D, reveal), instantly and without jumps.
// Stops on first user input (wheel/touch/key/pointer) or after SETTLE_MS following load.
const SETTLE_MS = 2000;

function anchorTarget(hash) {
  let el = null;
  try { el = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { /* bad hash */ }
  return el;
}

function alignTo(el) {
  const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
  const y = Math.max(0, Math.round(scrollY + el.getBoundingClientRect().top - pad));
  if (Math.abs(y - scrollY) < 1) return;
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo({ top: y, behavior: 'instant' });
}

function initHashLanding() {
  if (!location.hash || location.hash === '#') return;
  const el = anchorTarget(location.hash);
  if (!el) return;
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  let active = true;
  let ro = null;
  let timer = 0;
  const stop = () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    ro?.disconnect();
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => removeEventListener(t, stop));
  };
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => addEventListener(t, stop, { passive: true }));
  const align = () => { if (active) alignTo(el); };
  align();
  requestAnimationFrame(align);
  document.fonts?.ready.then(align);
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(align);
    ro.observe(document.body);
  }
  const arm = () => { align(); clearTimeout(timer); timer = setTimeout(stop, SETTLE_MS); };
  if (document.readyState === 'complete') arm(); else addEventListener('load', arm, { once: true });
  setTimeout(stop, 15000); // hard cap if load never fires
}

// ---------- Word-by-word reveal of big headings (.t-display with data-reveal / data-reveal-load) ----------
const HEADINGS = 'h1.t-display, h2.t-display, h3.t-display';
const WORD_SEL = `${HEADINGS}`; // every big heading; those without data-reveal get one (own IntersectionObserver trigger)
let wordsReady = false; // true after i18n has written the final text (or after a fallback timeout)
const deferredWords = [];

function wrapWords(node, ctx) {
  [...node.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/([ \t\n\r]+)/).forEach((p) => {
        if (!p) return;
        if (/^[ \t\n\r]+$/.test(p)) { frag.append(p); return; } // ASCII whitespace only: NBSP stays inside its word
        const w = document.createElement('span');
        w.className = 'word';
        w.setAttribute('aria-hidden', 'true');
        const inner = document.createElement('span');
        inner.className = 'word__inner';
        inner.style.setProperty('--i', ctx.i++);
        inner.textContent = p;
        w.append(inner);
        frag.append(w);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1 && n.tagName !== 'BR') wrapWords(n, ctx);
  });
}

function splitTitle(el) {
  if (el.querySelector('.word')) return;
  const probe = el.cloneNode(true);
  probe.querySelectorAll('br').forEach((b) => b.replaceWith(' '));
  el.setAttribute('aria-label', probe.textContent.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim());
  wrapWords(el, { i: 0 });
  if (el.classList.contains('is-revealed')) el.classList.add('is-instant'); // language switch: final state, no replay
  el.classList.add('is-split');
}

function flushWords() {
  wordsReady = true;
  document.querySelectorAll(WORD_SEL).forEach(splitTitle);
  void document.body.offsetHeight; // commit the hidden state so the first reveal transitions instead of snapping
  deferredWords.splice(0).forEach(([el, i]) => reveal(el, i));
}

// ---------- Scroll reveal ----------
let io = null;
const seen = new WeakSet();
const pending = new Set();

function reveal(el, i) {
  if (el.classList.contains('is-split') && !wordsReady) { // wait for the translated text, then play the words once
    deferredWords.push([el, i]);
    pending.delete(el);
    io?.unobserve(el);
    return;
  }
  const d = el.dataset.revealDelay;
  let delay = 0;
  if (d !== undefined && d !== '') {
    const n = parseFloat(d);
    delay = n <= INDEX_MAX ? n * stagger() : n;
  } else if (i !== undefined) {
    delay = i < STAGGER_CAP ? i * stagger() : 0;
  }
  el.style.setProperty('--reveal-delay', `${delay}ms`);
  el.classList.add('is-revealed');
  pending.delete(el);
  io?.unobserve(el);
}

function onIntersect(entries) {
  let i = 0;
  const vh = innerHeight;
  entries
    .filter((e) => e.isIntersecting || e.boundingClientRect.top < 0)
    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
    .forEach((e) => {
      const passed = e.boundingClientRect.top < 0 && !e.isIntersecting; // scrolled past (anchor jump)
      const enough = e.intersectionRatio >= 0.15 || e.intersectionRect.height >= vh * 0.3;
      if (passed) reveal(e.target);
      else if (e.isIntersecting && enough) reveal(e.target, i++);
    });
}

function refresh() {
  if (reduced.matches) return;
  document.querySelectorAll('[data-reveal-stagger]').forEach((c) => {
    [...c.children].forEach((k) => { if (!k.hasAttribute('data-reveal')) k.setAttribute('data-reveal', ''); });
  });
  // hero entrance on load: CSS animation, never leaves anything hidden
  document.querySelectorAll('[data-reveal-load]').forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    el.style.setProperty('--reveal-delay', `${(parseFloat(el.dataset.revealLoad) || 0) * stagger() * 1.5}ms`);
    if (el.classList.contains('is-split')) reveal(el);
  });
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (!io) { el.classList.add('is-revealed'); return; }
    pending.add(el);
    io.observe(el);
  });
}

function initReveal() {
  if (reduced.matches) return;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(onIntersect, { threshold: [0, 0.15], rootMargin: '0px 0px -10% 0px' });
  }
  // Jumps (End, anchors, fast scroll) can skip elements entirely: reveal everything already above the viewport
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking || !pending.size) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      pending.forEach((el) => { if (el.getBoundingClientRect().top < 0) reveal(el); });
    });
  }, { passive: true });
  window.__revealRefresh = refresh;
  window.__titleWords = flushWords; // called by i18n.js after every translation pass
  document.querySelectorAll(HEADINGS).forEach((h) => {
    if (!h.hasAttribute('data-reveal') && !h.hasAttribute('data-reveal-load')) h.setAttribute('data-reveal', '');
  });
  document.querySelectorAll(WORD_SEL).forEach(splitTitle);
  setTimeout(() => { if (!wordsReady) flushWords(); }, 1200); // fallback if i18n never reports
  refresh();
}

initScroll();
initHashLanding();
initReveal();
if (reduced.matches) window.__revealRefresh = () => {};
