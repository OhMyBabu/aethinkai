# DESIGN.md, AethinkAI Gateway

Direction for every public, user and admin surface. The antislop filter runs on
top of this file; every technique below carries its one-line reason (R-31).

## Design Read

Reading this as: a developer-facing AI gateway console for Indonesian builders
who pay per token, in a dark instrument-panel language, dial ENERGY 2 / RHYTHM 2
/ MOTION 1.

- **ENERGY 2 (balanced).** The page greets you with one live routing diagram and
  a single filled button; nothing else competes.
- **RHYTHM 2 (mostly consistent, a few breaks).** Sections keep the same
  left-aligned measure, but the catalog, the quickstart panel and the package
  table each change composition instead of repeating one card grid.
- **MOTION 1 (calm).** Motion exists only where it explains something: routes
  pulsing along lanes, a 5px hover lift on pricing, panels sliding in. All of it
  stops under `prefers-reduced-motion: reduce`.

## Identity

- **Palette.** Charcoal `#0A0A0A` base, surface `#171717`, warm white `#FAF8F4`,
  ash `#A1A3A7`, dim `#85888B`, one accent: flame `#E7893C`. Neutral greys do not
  count against the 2-3 core + 1 accent budget (R-29).
- **Type.** Inter for UI, JetBrains Mono only for values that must align (keys,
  invoice IDs, prices in tables). Mono is a data tool here, not a costume.
- **Motif.** A 40px wire grid plus signal lanes: the same geometry as the
  SignalNexus diagram, so the background reads as the routing fabric the product
  sells, not as generic graph paper.

## Justified techniques

| Technique | Where | Why (one line) |
|:--|:--|:--|
| Background grid (R-07) | landing + dashboard + mini app | It is the routing-fabric motif; the hero diagram draws the same lanes. |
| Ambient white wash (R-01) | one fixed layer per page | Single 5% light source gives the dark surface depth; no colored orb, no second gradient. |
| Glass (R-10) | sidebar + topbar on `/app`, header + bottom nav on `/tg` | Two surfaces per screen, never cards or modals: chrome floats, content stays solid. |
| Hover lift + spotlight (R-12, R-13) | pricing card only | One elevation cue on the one decision the page asks for; cards elsewhere stay flat. |
| Pricing: one featured tier (R-05) | `/` pricing | Owner direction: Pro is the entry point we want chosen; the badge names a real default, not a fake "most popular" count. |
| Three package columns (R-05) | `/` pricing | The admin table really holds exactly three SKUs; the layout follows the data. |
| Quickstart panel styled as terminal (R-05) | `/` terminal section | It shows the real endpoint, real model IDs and a copy button, not invented output. |
| Lucide icons (R-04) | nav, actions | Each glyph maps to the object it acts on (key, wallet, chart); no sparkles, stars or orbs. |
| Arrow on primary CTA only (R-08) | hero, closing CTA | One directional cue for the main action; secondary links carry none. |

## Copy rules

- No em dash. Use commas, colons or parentheses.
- No buzzwords (seamless, unlock, revolution, next-gen, powerful, effortless).
- Every number is live data from `/api/status`, `/api/models` or the ledger. If a
  value is missing, print `n/a`, never a plausible-looking constant.
- CTAs name the action: "Get an API key", "See live pricing", "Top up balance".
- Indonesian for user-facing conversation, English for API and admin labels.

## Accessibility contract

Measured pairs (WCAG AA needs 4.5:1 normal, 3:1 large):

| Pair | Ratio |
|:--|--:|
| `#FAF8F4` on `#0A0A0A` | 18.67 |
| `#FAF8F4` on `#171717` | 16.90 |
| `#A1A3A7` on `#0A0A0A` | 7.84 |
| `#A1A3A7` on `#171717` | 7.10 |
| `#85888B` on `#171717` | 5.03 |
| `#E7893C` on `#0A0A0A` | 7.58 |
| `#1A1208` on `#E7893C` (button label) | 7.09 |

- Focus ring: 2px flame, 2px offset, global `:focus-visible`.
- Pointer cursor on every enabled control; `not-allowed` on disabled.
- Tap targets 44px minimum, verified at 320-390px.

## States

Every data view ships empty, loading and error states. Empty means an honest
sentence ("Belum ada request di periode ini"), not a zeroed chart.
