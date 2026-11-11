# antislop gate, AethinkAI web surfaces (2026-11-09)

Skills installed from `miqdadbadjuber/anti-slop` into `~/.hermes/skills/`:
`antislop`, `antislop-ui`, `antislop-copywriting`, `antislop-human`,
`antislop-layoutmobile`, `antislop-code`.

Mode: **enforce (session override)**, filter applied on top of `docs/DESIGN.md`.

## What the scan found

| ID | Where | Pattern | Action |
|:--|:--|:--|:--|
| S-01 | 136 places in `frontend/src` + `index.html` | em dash in UI copy and placeholders (R-02) | replaced: `n/a` for missing values, comma in sentences, `·` in titles |
| S-02 | hero, above H1 | capsule + dot eyebrow repeating the subhead (R-09) | removed, label folded into the subhead |
| S-03 | hero secondary CTA | "Explore Models" generic verb (R-15) | "See live pricing", now scrolls to `#pricing` |
| S-04 | pricing header CTA | "Get started" (R-15) | "Add credit" |
| S-05 | catalog header CTA | "Explore the dashboard" (R-15) | "Open the dashboard" |
| S-06 | feature strip | "Intelligent Routing", "Enterprise Ready": buzzword + unverifiable claim (R-16, R-36) | "Health-aware routing", "Per-key limits" |
| S-07 | hero body | "Smart routing" (R-16 adjacent) | "Health-aware routing" |
| S-08 | catalog + pricing headers | flame uppercase eyebrows duplicating the H2 (R-06) | removed, accent moves to data |
| S-09 | `index.html` | `lang="en"` on an Indonesian product, `theme-color #18191B` (R-39) | `lang="id"`, `#0A0A0A` |
| S-10 | `index.html` title + description | em dash (R-02) | `·` and colon |

## Owner overrides recorded

- One featured package in three columns: owner direction (Pro is the entry
  point), not a fabricated "most popular" count.
- Quickstart panel styled as a terminal: it prints the real endpoint and model
  IDs from the catalogue, with a working copy button, not invented output.
- Background grid + ambient wash: the routing-fabric motif, see `DESIGN.md`.
- Glass on two surfaces per screen only: sidebar + topbar on `/app`, header +
  bottom nav on `/tg`; cards and modals stay opaque.

## Delivery Gate

### Block 1, Hard Gate (all answers no)

- R-02 PASS: `grep -c "—"` over `frontend/src` and `index.html` returns 0;
  served page `body.innerText.includes("\u2014")` false.
- R-03 PASS: `scrollWidth > innerWidth + 1` false at 390x844 and 1440x900;
  header menu 48px, hero buttons 50px.
- R-17 PASS: every number comes from `/api/status`, `/api/models` or the ledger;
  missing values print `n/a`.
- R-18 PASS: no testimonials section exists.
- R-23 PASS: no generated logo, avatar or photo; brand mark is the existing one.
- R-24 PASS: nav hrefs `#catalog`, `#pricing` resolve to real section ids.
- R-25 PASS: measured pairs 5.03:1 lowest (see `DESIGN.md`), all above AA.
- R-26 PASS: click-through: "Get an API key" -> `/login`; "See live pricing" ->
  scrollY 1108, `#pricing` top 160; Docs/Status/Bansos open panels; terminal tabs
  cURL/Python/Node switch and Python source renders; copy button fires; mobile
  menu opens with working links.
- R-27 PASS: user and admin data views carry loading, error and empty states
  (`loading` guard + error card + `Belum ada ...` empty copy in
  `pages/user/Overview.tsx`, `pages/user/Billing.tsx`, `pages/admin/Users.tsx`,
  `pages/public/Status.tsx`); mini app sparkline has an explicit empty state.
- R-28 PASS: no FAQ section.
- R-32 PASS: Tab order walked 8 stops (logo, Models, Pricing, Docs, Status,
  Bansos, Sign in, hero CTA) with a 2px flame outline on each.
- R-33 PASS: no patch script ships; the fixes live in source.
- R-34 PASS: no theme toggle; fixed dark is the product decision (R-21).
- R-35 PASS: `tsc -b` clean, `npm run build` OK, deployed, click-through logged.
- R-36 PASS: no compliance or performance claim; p95 and success rate are live.
- R-37 PASS: direction in `docs/DESIGN.md`, dials ENERGY 2 / RHYTHM 2 / MOTION 1.
- R-38 PASS: no invented content.
- R-39 PASS: `cursor: pointer` base layer for enabled controls, `not-allowed`
  for disabled, icon buttons carry `aria-label`, `lang` + `<title>` + landmarks,
  reduced-motion stops ambient and marquee motion.
- R-40 PASS: no raster hero, no `<img>` without dimensions, fonts preconnected,
  no render-blocking third-party script in `<head>`.

### Block 2, Purpose-Gate (reasons written in DESIGN.md)

PASS: grid, ambient wash, glass dose (2 surfaces), hover lift/spotlight on the
pricing card, single-arrow primary CTA, Lucide glyphs mapped to their objects,
three-column pricing that mirrors the admin table, and the terminal quickstart
are each justified one line in the table.

### Block 3, Liveliness

PASS: dials declared and held; focal point per screen (hero diagram, pricing
decision, wallet balance); whitespace separates sections; one accent (flame)
reserved for state and primary action; motif is the wire grid plus signal lane.

### Block 4, Craftsmanship & Quality Locks

PASS: all "no". Remaining template echoes (three pricing tiers, terminal-style
panel) are recorded as owner direction or real-data renderings above.
