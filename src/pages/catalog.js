import { url } from '../utils/url.js';
import products from '../data/products.json';
import { applyLang } from '../i18n.js';

const ICONS = { api: 'molecule', excipients: 'puzzle', 'food-grade': 'leaf' };
const LABELS = { api: 'catalog.cat_api', excipients: 'catalog.cat_excipients', 'food-grade': 'catalog.cat_food' };
const FALLBACK = { api: 'API', excipients: 'Excipients', 'food-grade': 'Food Grade' };

const PAGE = 12;
const more = document.getElementById('catalog-more');
const grid = document.getElementById('catalog-grid');
const empty = document.getElementById('catalog-empty');
const count = document.getElementById('catalog-count');
const search = document.getElementById('catalog-search');
const filters = [...document.querySelectorAll('#catalog-filters [data-category]')];

const params = new URLSearchParams(location.search);
const valid = (c) => c === 'all' || filters.some((f) => f.dataset.category === c);
const state = { category: valid(params.get('category')) ? params.get('category') : 'all', query: params.get('q') || '', shown: PAGE };
const nodes = new Map(); // slug -> card element currently in the grid

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const card = (p, isNew) => `
  <a ${isNew ? 'data-reveal' : ''} class="card card--link product-card" href="${url('/product.html')}?slug=${encodeURIComponent(p.slug)}">
    <div class="product-card__tags">${p.categories.map((c) => `<span class="chip chip--tag"><svg class="icon icon-text" aria-hidden="true"><use href="${url('/assets/icons/sprite.svg')}#${ICONS[c]}"/></svg><span data-i18n="${LABELS[c]}">${FALLBACK[c]}</span></span>`).join('')}</div>
    <h2 class="product-card__title">${esc(p.name)}</h2>
    <div class="product-card__footer"><span data-i18n="common.know_more">Know more</span><span class="round-btn round-btn--outline"><svg class="icon" aria-hidden="true"><use href="${url('/assets/icons/sprite.svg')}#arrow-up-right"/></svg></span></div>
  </a>`;

function makeCard(p) {
  const t = document.createElement('template');
  t.innerHTML = card(p, true).trim();
  return t.content.firstElementChild;
}

// fresh = category switch: whole grid is a new appearance. Otherwise cards already shown keep their DOM nodes,
// only cards that were not on screen before get data-reveal, and cards no longer matching are removed.
function render(fresh = false) {
  const q = state.query.trim().toLowerCase();
  const list = products.filter((p) => (state.category === 'all' || p.categories.includes(state.category)) && p.name.toLowerCase().includes(q));
  const shown = list.slice(0, state.shown);
  if (fresh) { grid.replaceChildren(); nodes.clear(); }
  const keep = new Set(shown.map((p) => p.slug));
  for (const [slug, node] of nodes) {
    if (!keep.has(slug)) { node.remove(); nodes.delete(slug); }
  }
  // Place nodes in list order; move a node only when it is out of place.
  let cur = grid.firstElementChild;
  shown.forEach((p) => {
    let node = nodes.get(p.slug);
    if (!node) { node = makeCard(p); nodes.set(p.slug, node); }
    if (node === cur) cur = cur.nextElementSibling;
    else grid.insertBefore(node, cur);
  });
  window.__revealRefresh?.();
  more.hidden = list.length <= state.shown;
  grid.hidden = !list.length;
  empty.hidden = !!list.length;
  count.hidden = !list.length;
  count.dataset.n = list.length;
  filters.forEach((f) => f.classList.toggle('is-active', f.dataset.category === state.category));
  applyLang().then(() => { count.textContent = `${list.length} / ${products.length}`; });
}

function sync() {
  const u = new URL(location.href);
  state.category === 'all' ? u.searchParams.delete('category') : u.searchParams.set('category', state.category);
  history.replaceState(null, '', u);
}

filters.forEach((f) => f.addEventListener('click', () => {
  const changed = f.dataset.category !== state.category;
  state.category = f.dataset.category; state.shown = PAGE; sync(); render(changed);
}));
search.addEventListener('input', () => { state.query = search.value; state.shown = PAGE; render(); });
more.addEventListener('click', () => { state.shown += PAGE; render(); });
search.value = state.query;
render();

// Tablet / mobile: the category list is a collapsed "Filters" block above the results (the toggle is hidden by CSS on desktop).
const filtersToggle = document.querySelector('[data-filters-toggle]');
if (filtersToggle) {
  const box = filtersToggle.closest('.catalog__filters');
  filtersToggle.addEventListener('click', () => {
    const open = filtersToggle.getAttribute('aria-expanded') !== 'true';
    filtersToggle.setAttribute('aria-expanded', String(open));
    box.classList.toggle('is-open', open);
  });
}
