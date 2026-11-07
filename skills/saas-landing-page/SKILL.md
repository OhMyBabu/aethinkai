---
name: saas-landing-page
description: Use when building or syncing a SaaS landing page.
version: 1.0.1
author: ganteng
license: MIT
metadata:
  hermes:
    tags: [frontend, landing-page, tailwind, navigation, api-sync]
    related_skills: [ui-styling, impeccable]
---

# SaaS Landing Page (nav, data truth, verification)

Governs work on a public landing/marketing surface: the header, the popovers, and the claims on the page.
Two failure modes dominate: a nav that looks like a toy next to Linear/Vercel, and a page that advertises
catalogs, prices, uptime, or endpoints the backend does not have. Both are fixable with the procedures below.

## When to Use

- Redesigning or building a marketing header / navbar / mega-menu for a SaaS site.
- A landing page shows numbers (models, prices, uptime, free credits) that must match the product backend.
- An audit question like "is the landing page synced with the backend?" needs evidence, not opinion.
- A design brief asks for a premium/minimal nav "like Linear or Vercel" and header-only scope.

Skip for product app UI (dashboards, settings) — that is `impeccable` / `ui-styling` territory.

## Always-on rules

1. **Public numbers are API numbers.** Every model count, price, uptime %, latency, and free-credit claim on a
   public page must trace to an endpoint. If the endpoint doesn't exist, add a small aggregate-only public one
   before writing the claim. Fixtures are a *fallback for gateway downtime*, never the source of truth.
2. **Never advertise an unimplemented route.** List only endpoints that resolve; a docs panel naming
   `/v1/embeddings` or `/v1/usage` that returns 404 is a lie that survives for months.
3. **Fix scope literally.** "Redesign the header only" means the hero, diagrams, sections, routing, auth flow and
   brand palette stay byte-identical. Header component and its own panels are in scope; a global stylesheet
   refactor is not — mention it as an optional follow-up instead.
4. **Verify by measurement, not by eye.** Read computed geometry/colors from the DOM, and check horizontal
   overflow at 390 / 834 / 1024 / 1280 / 1440 before reporting done. Numbers in the report must be the ones the
   probe returned.
5. **Deliver the artifact the request asked for.** A brief that asks for screenshots gets screenshots (desktop
   with dropdown open + mobile) plus the file list — not a description of the concept.

## Header / nav: premium flat pattern

Full recipe, class strings, popover shell, Motion preset and traps: `references/floating-nav.md`. Short form:

- 72px sticky bar, charcoal at ~85% opacity, 1px bottom border, `backdrop-blur-md` (light, not glassmorphism).
- Nav items are flat text buttons: `h-9 rounded-lg px-3 text-[13px] font-medium`; hover = graphite background,
  active = graphite + accent icon + chevron `rotate-180`, 180–220ms. No gradient boxes, bevel `inset` shadows,
  `perspective`, or hover tilt.
- Popovers float 8–10px under the trigger (`top-[<trigger-bottom>px] mt-2`), centred on it, `rounded-xl`,
  one graphite fill, one visible border, soft large-radius shadow, `fade + translateY(-6→0)` at 180ms.
- One accent CTA, flat fill and a hover tint — no shine sweep, no glow ring.
- Full nav at `lg` (1024px); below that a burger sheet with flat rows and the same CTA.

Behaviour checklist: one dropdown open at a time, outside click closes, Escape closes, `aria-haspopup` +
`aria-expanded` on triggers, focus-visible ring on every item.

## Data truth: sync the page to the backend

Procedure, audit commands and the public-status endpoint shape: `references/data-sync.md`. Short form:

1. Grep the landing surface for hardcoded data (`fixtures`, `SEED_`, literal model names, `%`, `ms`, `Rp`).
2. Fetch live catalog/pricing/status and diff against what the page renders — count mismatches and name them.
3. Add one public aggregate endpoint (`/api/status`) if usage/latency/uptime is claimed; aggregates only, no IDs.
4. Replace the fixture read with one hook polling ~30s that keeps the last good snapshot on failure.
5. Delete claims that cannot be backed (packages without a billing table, credits signup never grants).
6. Re-check rendered DOM text for retired names and real prices before calling it synced.

## Verification loop

Batch the checks; do not screenshot after every tweak.

```
tsc -b            # type gate
npm run build     # production gate
dom probes        # header height, gap, colors, radius, overflow, collisions
screenshots       # desktop closed / dropdown open / mobile sheet
```

Probes live in `references/floating-nav.md` (geometry) and `references/data-sync.md` (text assertions).

## Pitfalls

- **A brand-mark resolver that compares regex *sources* silently blanks multi-token vendors.** Matching
  `providerMap[name].source` against an icon table of `glm|chatglm|zhipu` or `kimi|moonshot` never hits, so GLM/Kimi/
  Claude fall back to letter tiles while DeepSeek (single-token pattern) looks fine. Test the provider name against
  the icon regexes directly; assert each node's `<title>` (DeepSeek / Zhipu / Kimi / Claude) instead of trusting
  “an svg exists”.
- **Fixture counters leak into the hero.** A “N routes live” pill inside the diagram may read from the seed store
  while the catalogue reads the API; pass the live count in as a prop.
- **A global `* { border-color: … }` outside `@layer base` silently overrides every Tailwind border utility** —
  unlayered CSS beats `@layer utilities`. Set the colour inline for local fixes and confirm with
  `getComputedStyle(el).borderColor`; propose moving the reset into `@layer base` instead of doing it during a
  header-only task.
- **A centred absolute nav collides with the logo/CTA on tablets** once the wordmark gains a label. Gate the nav
  at `lg`, measure collision at 1024/1280/1440, and hide the extra label (`xl`) instead of shrinking type.
- **AnimatePresence exit animations never finish in a background tab** (rAF throttling): the panel sticks at
  `opacity:0` and DOM probes claim Escape/outside-click failed. Bring the page to front and enable focus
  emulation before probing, then re-run the same probe.
- **`Page.captureScreenshot` at `scale: 2` on a tall viewport times out** against the browser daemon; capture at
  `scale: 1` with a clip, or use the helper, and keep measurement in a separate call.
- **Fixture fallback must be silent.** If the API call fails the page keeps the last snapshot — never render an
  empty catalogue or an error banner where marketing copy lives.

## Reporting

Answer with: what changed (grouped by visual concern), the measured acceptance numbers, the file list, and the
screenshots. State unresolved gaps explicitly (e.g. pricing packages still fixture-only) and offer the next step
without asking permission for the current one.
