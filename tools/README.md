# tools/

## hover-gate.cjs — `npm run audit:hover` (customer rule 2026-11-13)
Rule: EVERY button-like element has the "disc from the centre" hover (see `design-system.md`, "Кнопки: hover" and the DISC block at the end of `src/styles/components/buttons.css`). The gate makes that impossible to skip.

What it does: opens all pages (index, about, services, catalog, product?slug=anastrozole, contact, privacy, terms, data-processing, faq, impressum, 404, design-system) at 1440 and 375 with headless Chrome (puppeteer-core, one browser per worker), collects every `a, button, [role=button|option|tab], summary, input[type=submit]`, classifies it and checks it with a REAL mouse hover (waits 950 ms > `--dur-hover-disc`):
- **button-like** (opaque fill, border, `.btn*`/`.round-btn*`/`.icon-ring--action`/`.nav-pill`/`.lang-switch`/`.filter-item`/chips/…, or contains a round button / action ring): (a) a `::before` disc whose scale goes 0 -> 1 (on the element or on its ring/round-button child); (b) label contrast >= 3 against the disc/surface at the end; (c) visible change: dE(CIELAB76) >= 10 between rest and hover (label colour or the pixel at the left edge); (d) size unchanged.
- **text link**: visible hover (label dE >= 10, or underline change, or fill change); no disc required.
- **card / media links** (contain img/heading/p): reported as N/A (hover owned by the component).
- **Cards with one action button** (`CARDS` in the script = the `:is()` list in buttons.css): hover on the card BODY (not on the button) must produce the disc on its button (`card-hover` rows).
- Forced-state demos in design-system (`.is-hover/.is-focus/.is-pressed/.is-disabled`) and disabled controls are N/A.
- Extra scenes: 1440 = language dropdown opened; 375 = burger menu opened (index, catalog, contact).
Exit code != 0 on any FAIL/ERROR. Exceptions only in `hover-gate.allowlist.json` (`selector`, `reason`, optional `pages`/`widths`); every entry needs a reason.

Usage: `npm run audit:hover` (starts its own vite on 5191 and stops it) or `node tools/hover-gate.cjs --url http://localhost:5173 [--pages index,about] [--widths 1440,375] [--workers 1] [--verbose] [--all] [--inventory out.json]`. `--inventory` writes every checked row + the full clickable list. `CHROME=/path` overrides the Chrome binary.
New button-like element: add it to the role list in the DISC block of `buttons.css` (do not write a separate hover) and run the gate.

Note: run it with <= 3 workers (default); more parallel Chrome windows throttle transitions. Do not run two gates at once on one machine.

## SEO tools
- `npm run audit:seo` (`tools/seo-audit.cjs`): audits `dist/` (run `npm run build` first): per-page PASS/FAIL (title/description lengths and uniqueness, canonical, hreflang, robots vs sitemap, headings, JSON-LD, alt, links, SSR content), sitemaps, robots.txt, 404, headless-Chrome console errors (`--no-console` to skip, `--json file`). Exit 1 on FAIL.
- `npm run seo:demo` (`tools/seo-demo.cjs`): crawler view, SERP previews, sitemap/noindex table -> `content/seo/demo.html|json`.
- `node tools/seo-headings.cjs`: `content/seo/headings.md`.
- `npm run seo:assets` (`tools/og.cjs`): regenerates favicon set and `og-default.png` from the logo.
