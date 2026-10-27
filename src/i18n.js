import { url, withBase } from './utils/url.js';
// Tiny i18n: dictionaries in src/i18n/<lang>.json; add a language by dropping a file + listing it in LOADERS
// (and an <li role="option" data-lang> in src/partials/header.html). A key missing in a dictionary falls back to en.json.
const LOADERS = {
  en: () => import('./i18n/en.json'),
  de: () => import('./i18n/de.json'),
  // uk: () => import('./i18n/uk.json'),
};
const DEFAULT = 'en';
const KEY = 'osta-lang';

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

export function currentLang() {
  let l = null;
  try { l = localStorage.getItem(KEY); } catch { /* ignore */ }
  l = l || document.documentElement.lang || DEFAULT;
  return LOADERS[l] ? l : DEFAULT;
}

export async function applyLang(lang = currentLang()) {
  const base = (await LOADERS[DEFAULT]()).default;
  const own = lang === DEFAULT ? base : (await LOADERS[lang]()).default;
  const dict = { get: (key) => { const v = get(own, key); return typeof v === 'string' && v !== '' ? v : get(base, key); } };
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = dict.get(el.dataset.i18n);
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = dict.get(el.dataset.i18nHtml);
    if (typeof v === 'string') el.innerHTML = withBase(v).replace(/<br\s*\/?>/gi, ' <br>'); // space before <br>: collapses at the line end (desktop unchanged), lets tablet/mobile CSS hide the <br> without gluing words
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    // format: "placeholder:key;aria-label:key2"
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':');
      const v = dict.get(key);
      if (attr && typeof v === 'string') el.setAttribute(attr, v.startsWith('/') ? url(v) : v);
    });
  });
  document.querySelectorAll('[data-lang-current]').forEach((el) => { el.textContent = lang.toUpperCase(); });
  document.querySelectorAll('[data-lang-menu] [data-lang]').forEach((o) => o.setAttribute('aria-selected', String(o.dataset.lang === lang)));
  window.__titleWords?.(); // motion.js: re-split big headings into words after the text changed
}

export function setLang(lang) {
  if (!LOADERS[lang]) return;
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  return applyLang(lang);
}

function initMenu(menu) {
  const btn = menu.querySelector('[data-lang-switch]');
  const list = menu.querySelector('[role="listbox"]');
  const opts = [...list.querySelectorAll('[role="option"]')].filter((o) => LOADERS[o.dataset.lang]);
  // Hover opens only on pointer-fine devices (hover: hover); touch devices get click only
  const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let idx = 0;
  let hoverOpen = false;
  let closeTimer = 0;
  const focusOpt = (i) => {
    idx = (i + opts.length) % opts.length;
    opts.forEach((o, n) => o.classList.toggle('is-focus', n === idx));
    list.setAttribute('aria-activedescendant', opts[idx].id);
  };
  // focus: move focus into the list (keyboard); byHover: opened by pointer, focus stays on the button
  const open = (focus = false, byHover = false) => {
    clearTimeout(closeTimer);
    menu.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
    hoverOpen = byHover;
    focusOpt(Math.max(0, opts.findIndex((o) => o.dataset.lang === currentLang())));
    if (focus) list.focus({ preventScroll: true });
  };
  const close = (back) => {
    clearTimeout(closeTimer); hoverOpen = false;
    menu.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
    opts.forEach((o) => o.classList.remove('is-focus')); list.removeAttribute('aria-activedescendant');
    if (back) btn.focus();
  };
  const pick = (o) => { setLang(o.dataset.lang); close(true); };
  btn.addEventListener('click', (e) => {
    // Click on a hover-opened menu pins it open (no toggle-close while the pointer is still over it)
    if (menu.classList.contains('is-open') && !hoverOpen) { close(); return; }
    open(e.detail === 0); // detail 0 = keyboard-triggered click: move focus into the list
  });
  if (hoverCapable) {
    menu.addEventListener('mouseenter', () => {
      if (menu.classList.contains('is-open')) clearTimeout(closeTimer);
      else open(false, true);
    });
    menu.addEventListener('mouseleave', () => {
      if (!menu.classList.contains('is-open')) return;
      // short grace period; keyboard focus inside the list keeps the menu open
      closeTimer = setTimeout(() => { if (!list.contains(document.activeElement)) close(); }, 150);
    });
  }
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!menu.classList.contains('is-open')) open(true); }
  });
  opts.forEach((o) => o.addEventListener('click', () => pick(o)));
  list.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); focusOpt(idx + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); focusOpt(idx - 1); }
    else if (k === 'Home') { e.preventDefault(); focusOpt(0); }
    else if (k === 'End') { e.preventDefault(); focusOpt(opts.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(opts[idx]); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === 'Tab') close();
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('is-open')) close(true); });
}

export function initI18n() {
  document.querySelectorAll('[data-lang-menu]').forEach(initMenu);
  return applyLang();
}
