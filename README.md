# OSTA site

Multi-page marketing site (Vite, vanilla JS, Three.js for hero visuals). Pages: home, about, services, catalog, product, contact, plus an internal design-system page.

## Requirements

Node.js 24 (see `.nvmrc`; Vite 8 needs a current Node LTS).

## Commands

```
npm install
npm run dev       # dev server on http://localhost:5173
npm run build     # production build into dist/
npm run preview   # serve dist/ on http://localhost:4175/osta/
```

## Deploy

GitHub Pages via Actions (`.github/workflows/deploy.yml`) on every push to `main`. Live: https://mak-nw.github.io/osta/

The site is served from the sub-path `/osta/`: production builds and `vite preview` use base `/osta/`, `npm run dev` uses `/`. Override with `VITE_BASE` (e.g. `VITE_BASE=/ npm run build`). In JS use `url()` from `src/utils/url.js` (never hard-code `/assets/...`); in HTML write root-absolute paths, the build adds the base.

The review overlay (`vite-plugin-review.js`, `dev-tools/`) is dev-only and is not part of the production build.

## Structure

- `*.html` in the root: one file per page (`index`, `about`, `services`, `catalog`, `product`, `contact`, `design-system`, `privacy`, `terms`, `data-processing`); shared head/header/footer in `src/partials/`.
- `src/styles/`: `tokens.css` (all design tokens), `base.css`, `layout.css`, `components/`, `pages/`.
- `src/i18n/`: translations (`en.json`, `de.json`); English is the default language.
- `src/pages/`: per-page scripts and 3D scenes; `src/data/`: product data.
- `public/assets/`: fonts, icons, images (served from `/assets/`).
- `design-system.md`: components, role-to-token table and layout rules.

## Legal pages

`privacy.html`, `terms.html`, `data-processing.html` share one template (`src/styles/components/legal.css`): title, "Last updated" line and numbered sections (1–7). No table of contents. Hero and body start at grid column 4 (cols 1–3 empty; body spans cols 4–10). Texts are Latin lorem ipsum placeholders (same in EN and DE).

- Texts live in `src/i18n/en.json` and `de.json` under `legal`: shared key `legal.last_updated`; per page `legal.<privacy|terms|data>.title` and, per section, `sN_title`, `sN_text` (paragraph 1), `sN_text2`, `sN_text3` (extra paragraphs), ... `s7_text`. Replace the values to fill in a page (use `<br>` only with `data-i18n-html`).
- Add a section: copy one `<section class="legal__section" id="sN">` block in the page HTML (with its `data-i18n` keys) then add `sN_title` / `sN_text` to both JSON files.
- Add a paragraph: add another `<p class="t-body legal__text" data-i18n="legal.<page>.sN_text2">` inside the section and a key in both JSON files. Lists: `<ul class="legal__list t-body">` (bullets) or `<ol class="legal__list legal__list--numbered t-body">`. Placeholder lists are static Latin text in the HTML (marked `<!-- placeholder list -->`), not in i18n: replace the list markup in the page itself when real content arrives.
- Footer links: `footer.legal_privacy`, `footer.legal_terms`, `footer.legal_data`; copyright `footer.copyright`, company name `footer.company`.
- A new legal page also needs an entry in the `pages` array in `vite.config.js`.

## Rules

- Colors, sizes and spacing come only from tokens in `src/styles/tokens.css`; no hardcoded values or inline styles.
- 12-column grid with a 16 px gap.
- Text is not hardcoded: it goes through `src/i18n`.
