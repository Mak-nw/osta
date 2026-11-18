// Home hero scene fit (no three.js): where the scene sits in its host and how big it is. ONE definition used by the live scene (home-hero-scene.js) and by the poster
// (home-hero-poster.js, which sizes the static poster with the SAME numbers before the live scene exists), so the poster -> live hand-over does not move a pixel.
// The scene sits at a FIXED centre (x = host centre = page centre; y = centre of the H1 block on desktop, host centre in the stacked layout) and only its unit (css px per world unit)
// is searched: the biggest unit (sphere circle + tilted capsule) that touches no content rect (binary search).
export const TILT = 0.42;                    // fixed tilt of the group (rad)
export const SPH = 0.82;                     // sphere radius vs the pill
const RC = 0.58, H = 0.82;
export const R_SPHERE = 1.3 * SPH, R_PILL = RC * 1.18, AX_PILL = H * 1.18; // fit shapes (units): sphere radius incl. nodes; capsule radius + half axis
export const MAX_UNIT = 280, MIN_UNIT = 40;
const dRect = (x, y, q) => Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y, 0, y - q.b));

/** host: the scene host element; W, Hh: its client size. Returns { x, y, u } in css px relative to the host (u = px per world unit). */
export function computeHeroFit(host, W, Hh) {
  const hr = host.getBoundingClientRect();
  const rel = (r, m) => ({ l: r.left - hr.left - m, t: r.top - hr.top - m, r: r.right - hr.left + m, b: r.bottom - hr.top + m });
  const blocks = [];
  const hero = host.closest('.hero') || host.parentElement;
  const panel = hero.ownerDocument.querySelector('.header__panel');
  if (panel) blocks.push(rel(panel.getBoundingClientRect(), 12));
  let title = null;                                  // union of the H1 text lines (both phrases): the vertical axis of the composition
  const h1 = hero.querySelector('.hero__title');
  if (h1) {
    const parts = [...h1.querySelectorAll('.hero__title-part')];
    (parts.length ? parts : [h1]).forEach((part) => {   // each phrase separately: left and right phrases never merge into one block across the centre
      const g = document.createRange(); g.selectNodeContents(part);
      const lns = [];
      [...g.getClientRects()].filter((r) => r.width > 1 && r.height > 1).forEach((r) => {
        const ln = lns.find((l) => Math.abs(l.top - r.top) < r.height * 0.5);
        if (ln) { ln.left = Math.min(ln.left, r.left); ln.right = Math.max(ln.right, r.right); ln.bottom = Math.max(ln.bottom, r.bottom); } else lns.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      });
      lns.forEach((l) => blocks.push(rel(l, 12)));
      const pr = part.getBoundingClientRect();     // the box of the phrase (not the word glyphs: they move during the reveal animation) gives the axis
      title = title ? { top: Math.min(title.top, pr.top), bottom: Math.max(title.bottom, pr.bottom) } : { top: pr.top, bottom: pr.bottom };
    });
  }
  const lead = hero.querySelector('.hero__lead');     // paragraphs between the sphere and the search: the scene never touches them
  if (lead) blocks.push(rel(lead.getBoundingClientRect(), 32));
  const search = hero.querySelector('.hero-search');
  if (search) blocks.push(rel(search.getBoundingClientRect(), 32));
  const cats = hero.querySelector('.hero-cats');     // the row container is wider than its chips: use the chips' union
  if (cats) { const rs = [...cats.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 1); if (rs.length) blocks.push(rel({ left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) }, 32)); }
  const ca = Math.cos(TILT), sa = Math.sin(TILT);
  const overlay = getComputedStyle(host).position === 'absolute';   // desktop: scene over the whole hero, centred on the H1 block; stacked layout: centred in its own box
  const x = W / 2, y = overlay && title ? (title.top + title.bottom) / 2 - hr.top : Hh / 2;
  const ok = (u) => {
    const rs = R_SPHERE * u, rp = R_PILL * u, ax = AX_PILL * u;
    const ex = Math.max(rs, ax * ca + rp), ey = Math.max(rs, ax * sa + rp);
    if (x - ex < 8 || x + ex > W - 8 || y - ey < 8 || y + ey > Hh - 8) return false;
    for (const q of blocks) {
      if (dRect(x, y, q) < rs) return false;
      for (let i = -4; i <= 4; i++) if (dRect(x + ax * ca * i / 4, y - ax * sa * i / 4, q) < rp) return false;
    }
    return true;
  };
  let u = MAX_UNIT;
  if (!ok(u)) { let lo = MIN_UNIT, hi = MAX_UNIT; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; } u = lo; }
  return { x, y, u, hr };
}

/** puts the static poster (img[data-hero-poster], frame 0) exactly where the live scene is: same centre and unit. Called by the live scene on EVERY fit and by home-hero-poster.js before the live scene exists. */
export function placePoster(host, { x, y, u }) {
  const poster = host.querySelector('[data-hero-poster]');
  if (!poster || poster.hidden) return;
  poster.style.setProperty('--hp-x', `${x}px`);
  poster.style.setProperty('--hp-y', `${y}px`);
  poster.style.setProperty('--hp-u', `${u}px`);
}
