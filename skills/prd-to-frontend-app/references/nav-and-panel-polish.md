# Navigation chrome: 3D pill nav, mega panel, status popover

When the user calls the header ugly ("tombol ini jujur jelek banget", "bikin 3D kek", "animasinya keren"),
the fix is a rebuild of the chrome, not a colour tweak. Flat text links read as unfinished no matter how
well the rest of the page is built.

## 1. Extract the header into its own component

`src/components/landing/SiteHeader.tsx` owns: nav state (`docsOpen`, `statusOpen`, `mobileOpen`,
`mobilePanel`), the shared `headerRef`, outside-click + `Escape` handlers, and the role-aware CTA
(`dashboardHref`). The page renders `<SiteHeader />` and keeps zero header state — otherwise every
panel toggle re-renders the hero graph.

```tsx
useEffect(() => {
  const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setDocsOpen(false); setStatusOpen(false); } };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDocsOpen(false); setStatusOpen(false); setMobileOpen(false); } };
  document.addEventListener("mousedown", onDown);
  document.addEventListener("keydown", onKey);
  return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
}, []);
```

## 2. 3D pill = perspective wrapper + spring transform + cursor spotlight

```tsx
// Start THIN. Depth that reads as a raised surface, not a plastic key.
const spring = { type: "spring", stiffness: 320, damping: 28, mass: 0.6 } as const;

<div className="[perspective:900px]">
  <motion.div
    whileHover={reduceMotion ? undefined : { rotateX: -4.5, y: -1.5, scale: 1.018 }}
    whileTap={reduceMotion ? undefined : { rotateX: 0, y: 0.5, scale: 0.982 }}
    transition={spring}
  >
    <button className="group relative inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-bold text-warm
      bg-[linear-gradient(180deg,#222327_0%,#1C1D20_52%,#17181B_100%)]
      shadow-[inset_0_1px_0_rgba(LIGHT,0.055),inset_0_-1px_0_rgba(0,0,0,0.30),inset_0_0_0_1px_rgba(LIGHT,0.03),0_1px_2px_-1px_rgba(0,0,0,0.45)]">
      {/* spotlight follows the pointer */}
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "radial-gradient(90px circle at var(--mx,50%) var(--my,50%), rgba(ACCENT,0.13), transparent 62%)" }} />
      {/* bevel: hairline highlight on top, shade on the bottom — never a flat border */}
      <span aria-hidden className="pointer-events-none absolute inset-x-2 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(LIGHT,0.16),transparent)]" />
      <span aria-hidden className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-black/35" />
      {/* hover feedback via an inset ring, so the box size never shifts */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[ACCENT]/0 transition-[--tw-ring-color] duration-300 group-hover:ring-[ACCENT]/30" />
      <span className="relative flex text-warm/65 transition-colors duration-300 group-hover:text-flame">{icon}</span>
      <span className="relative">{label}</span>
      {hasPanel && <ChevronDown size={12} className="relative text-warm/55 transition-transform duration-300 group-hover:text-flame" />}
    </button>
  </motion.div>
</div>
```

`--mx/--my` are set on `mousemove` from `event.clientX - rect.left`; without them the spotlight sits static
and the hover feels pasted on. Chevron rotates 180° and turns flame when its panel is open.

### Depth calibration — thin first, bold only on request

The first pass with heavy bevel gets rejected as "3d nya terlalu bold". Land on the thin column; thicken only
when the user explicitly asks for more relief.

| Knob | Thin (default) | Reads as too bold |
| --- | --- | --- |
| hover tilt | `rotateX -4.5`, `y -1.5`, `scale 1.018` | `-9 / -2 / 1.035` |
| taper on press | `scale 0.982` | `0.97` |
| spring | `320 / 28 / 0.6` | `420 / 26 / 0.7` |
| top inset highlight | `LIGHT 5.5%` | `LIGHT 10%` |
| bottom inset shade | `black 30%` | `black 55%` |
| cast shadow | one layer, `0 1px 2px -1px` | two, incl. `0 10px 22px -16px` |
| hairline highlight | `LIGHT 16%` | `LIGHT 28%` |
| hover spotlight | `ACCENT 13%` | `ACCENT 20%` |
| body gradient | darkest tokens, e.g. `#222327 → #1C1D20 → #17181B` | lifted greys, `#25262A → …` |
| label colour | light token `#FAF8F4` (white, per user request) | ash grey |

A flat 1 px border is what gets called "bordernya jelek": replace the border with the inset-highlight +
inset-shade + hairline pair above, so the edge reads as a bevel instead of a stroke.

### Iconography and weight

The pill is not text-only. Labels are `text-[13px] font-bold`, and the leading slot takes the **same lucide
component the dashboard sidebar uses for that destination** — reuse the import, not a lookalike:

| Header item | Icon | Sidebar source |
| --- | --- | --- |
| Models | `Boxes` | user *AI Models* / admin *Model Catalog* |
| Pricing | `Tag` | admin *Packages & Pricing* |
| Status | `Activity` | user *Usage & Logs* / admin *Usage Analytics* |
| Docs | `BookOpen` | no sidebar twin — stay in the same lucide set |

Icon slot: `size 14`, `strokeWidth 1.9`, wrapper `flex text-ash group-hover:text-flame`. Emoji (`🧠 🏷️ 📘 🟢`)
reads as a chat message inside a product header and gets rejected immediately — the user asked for "the same
emoji as the dashboard", meaning the sidebar's lucide glyphs. Keep the mobile sheet on the identical icon set
(`size 15`) so the drawer does not look like a different product.

Palette stays locked: spotlight, border and underline all derive from the existing accent at low alpha —
no new hue appears on hover.

## 3. Panels must overlay, never push

A panel rendered in flow inside a sticky header *grows the header* and shoves the whole page down on open.
Anchor it to the positioned header instead:

```
absolute inset-x-0 top-full z-50 max-h-[calc(100vh-4rem)] overflow-y-auto
rounded-b-2xl border-t border-ash/12 bg-[#141518]/97 backdrop-blur-xl
shadow-[0_40px_90px_-40px_rgba(0,0,0,0.95)]
```

Status popover: `absolute right-4 top-[62px] z-50 w-[320px]`. Keep `<AnimatePresence>` around each panel so
`exit` runs; the wrapper may stay a plain `<div>` only if the animated child is the direct child.

Entrance: `initial={{ opacity: 0, y: -10, filter: "blur(8px)" }}` → spring (stiffness 380, damping 30).
Lists inside use `staggerChildren: 0.045` so endpoints/bars arrive in sequence.

## 4. Docs mega panel (content bar)

Two columns at ≥1024 px:

- Left: 3 language tabs (cURL / Python / Node) sharing `layoutId="docs-lang"` for the sliding indicator,
a Copy button with a 1.6 s "Copied" state, and the snippet in a `max-h-[210px] overflow-auto` `<pre>` that
re-mounts per tab with a 0.18 s fade.
- Right: endpoint rows (`POST`/`GET` badge, path, p95 latency, arrow on hover) + an auth card naming
`Authorization: Bearer sk-…`.

Real content only: actual endpoint paths and plausible p95s. A paragraph of marketing text in a dropdown is
what made it look cheap the first time.

## 5. Status popover (content bar)

Ping dot + "All systems operational" + "90-day uptime 99.98%", a row of 32 uptime bars that grow with
`delay: index * 0.012`, three services with latency and uptime, and an incident footer. Bars come from a
deterministic function of the index (`0.72 + (sin((i+seed)*1.7)*0.5+0.5)*0.28`) so the chart never reshuffles
between renders.

## 6. Probes — measure, never eyeball

```js
// exact centring (mx-auto is NOT centred when brand and CTA columns differ in width)
(() => { const n = document.querySelector('nav[aria-label=Main]').getBoundingClientRect();
         const h = document.querySelector('header').getBoundingClientRect();
         return Math.round((n.x + n.width / 2) - (h.x + h.width / 2)); })()      // expect 0

// panel must not shift content
const y0 = document.querySelector('h1').getBoundingClientRect().y; openDocs();
const y1 = document.querySelector('h1').getBoundingClientRect().y;              // y0 === y1

// the 3D transform really applied
getComputedStyle(pillWrapper).transform   // matrix3d(...) with a non-zero rotateX term

// Tailwind v4 rotate/scale utilities set the INDIVIDUAL properties, not `transform`:
getComputedStyle(chevron).transform       // 'none' even while rotated — check getComputedStyle(chevron).rotate  // '180deg'

// contrast of nav label on the header background
// lum()/ratio() as in references/verification-checklist.md; ≥4.5 at 12.5px

// hover styles are media-gated: headless Chrome reports hover:none and Tailwind v4 skips them
matchMedia('(hover: hover)').matches          // false in the harness, true on the user's desktop
// prove the rule exists instead of re-styling:
// concatenate sheet.cssRules text and search for 'hover\\:text-warm' / 'group-hover\\:text-flame'

// panel survives narrow viewports
// 390 / 768 / 1024 / 1440 → scrollWidth-innerWidth === 0, panel height + scrollable flag
```

Target values from a passing build: nav offset 0, pill height 36 px, nav contrast 4.94:1, panel 360 px at
≥1024 and 669 px stacked at 768, 0 console errors, 0 horizontal overflow.

## 7. Pitfalls

- `mx-auto` inside a flex header centres the *gap*, not the nav: with a wide brand block on the left and a
  CTA on the right the row lands ~20 px off. Use `absolute left-1/2 -translate-x-1/2` and assert offset 0.
- CSS `prefers-reduced-motion` does not neutralise Motion's inline transforms — pull `useReducedMotion()`
  and pass `undefined` to `whileHover`/`whileTap`, or the 3D tilt ignores the OS setting.
- Returning a `NodeList`/element from `js()` throws `Object reference chain is too long`; return
  `.length`, a JSON string, or `getComputedStyle(...).transform`.
- Screenshot analysis can time out on tall pages; the reliable check is geometry (`getBoundingClientRect`,
  computed styles) plus a pixel crop of the region when a stroke or spacing claim needs proof.
- Keep mobile separate: the pill row hides below `md`, and the mobile sheet exposes Docs/Status as
  accordions with a compact copy of the same facts — do not shrink the mega panel into 390 px.
- The CTA is the one place where a flat token looks weak: a solid `accent` fill reads as a secondary chip. Use a
  two-token vertical gradient (accent → darker sibling), neutral-dark label text, `inset 0 1px 0` light-token
  highlight, `ring-1` of the accent at ~45 %, and an accent-tinted outer shadow. Anything hand-mixed is
  off-palette (see the palette rule) — verify text contrast stays ≥4.5:1 on the *lightest* stop.
- Anchor jumps on mobile are measured while the menu is still open, so the target lands ~140 px low once the
  sheet collapses. `preventDefault`, close the sheet, then after ~320 ms compute
  `scrollY + target.getBoundingClientRect().top - headerHeight - 16` and `window.scrollTo({ behavior: "smooth" })`;
  `scrollIntoView` alone is not enough because the layout shift happens after it runs.

## 8. CTA emphasis + alignment assertions

```tsx
<motion.button
  whileHover={{ y: -1, scale: 1.02 }} whileTap={{ scale: 0.97 }} transition={spring}
  className="group relative hidden h-9 items-center gap-1.5 overflow-hidden rounded-lg
             bg-[linear-gradient(180deg,ACCENT_0%,ACCENT_55%,ACCENT_DARK_100%)]
             px-3.5 text-[13px] font-semibold text-[NEUTRAL_DARK]
             ring-1 ring-[ACCENT]/45 sm:inline-flex
             shadow-[0_10px_26px_-14px_rgba(ACCENT,0.85),inset_0_1px_0_rgba(LIGHT,0.35)]"
>
  <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-[LIGHT]/30
        blur-[2px] transition-transform duration-700 ease-out group-hover:translate-x-[420%]" />
  <span className="relative flex items-center gap-1.5">Sign in <ArrowRight size={13} /></span>
</motion.button>
```

Label follows session state (`Sign in` → `Open dashboard`); don't ship one string for both.

```js
// CTA really sits at the trailing edge at every breakpoint
(() => { const b = cta.getBoundingClientRect(); const h = document.querySelector('header').getBoundingClientRect();
         return JSON.stringify({ right: Math.round(b.right), headerRight: Math.round(h.right) }); })()

// cursor contract
[getComputedStyle(cta).cursor, getComputedStyle(navBtn).cursor]        // ['pointer','pointer']
getComputedStyle(disabledBtn).cursor                                    // 'not-allowed'

// no derived tints slipped in
/linear-gradient\(rgb\(231, 137, 60\).*rgb\(156, 84, 47\)/.test(getComputedStyle(cta).backgroundImage)  // true
```

## 9. Section anchors

Marketing nav must resolve to the section that carries the matching eyebrow: `Models → #catalog` (the table),
not `#models` (the highlights strip); `Pricing → #pricing`. Give each destination `scroll-mt-24`, and after a
click assert `location.hash`, the destination's heading text, and `Math.round(target.getBoundingClientRect().top)`
(≈96 px on desktop with a 65 px sticky header). Footer links point at the same ids — drop the duplicate
"Catalogue" entry instead of shipping two labels for one section.

---

## 10. Brand lockup sizing

"Perbesar font AethinkAIGateway di header, gedein logonya dikit" is about the wordmark, not the nav pills.
Scale the lockup as one unit and re-check the centred nav, because a wider brand eats into its clearance.

| Element | Base | Enlarged (this user's ask) |
| --- | --- | --- |
| tile logo | 30 px | 36 px (28 → 30 in `compact`) |
| product name | 15 px / `-0.015em` | 18 px / `-0.02em`, `font-semibold` |
| sublabel (`Gateway`) | 9 px / `0.28em` | 10.5 px / `0.26em`, uppercase |
| lockup height | 44 px | 52 px (fits the 64–65 px bar) |

The accent split lives inside the name: `Aethink<span className="text-flame">AI</span>` — never colour the
whole string.

```js
// clearance survives the resize
(() => { const w = document.querySelector('header a[aria-label="AethinkAI home"]').getBoundingClientRect();
         const n = document.querySelector('nav[aria-label=Main]').getBoundingClientRect();
         return Math.round(n.left - w.right); })()        // ≈300 px at 1440, positive at every breakpoint
```

## 11. Footer — the second chrome surface

A single `© year · domain` line reads as work not done ("di footer juga masih belum ada perbaikan apapun
sama sekali"). Build a four-region footer; it is cheap and it closes the page.

```
<footer class="mt-12 border-t border-ash/12">
  grid gap-9 py-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]
  ├─ brand      : Wordmark + one-sentence positioning (max-w-[300px]) + live status pill (ping dot)
  ├─ Product    : #catalog · #pricing · #terminal
  ├─ Account    : /login · /signup · /app/overview
  └─ Developers : api.<product>.ai/v1 (mono, accent) · support@… · "Docs · coming soon" (muted, non-link)
  bottom bar      : © year <Brand> Gateway · rights  |  locale/timezone  |  mailto contact
```

Rules that keep it from being called out again:

- **Every anchor resolves.** Add the id the footer needs (`id="terminal"` + `scroll-mt-24` on the code
  panel) in the same commit; a footer entry that scrolls nowhere is the same bug as a mislabelled nav item.
- **Column headings are eyebrow-sized** (`text-[10.5px] uppercase tracking-[0.22em] text-ash/80`), links
  `text-[13px] text-warm/75 hover:text-flame`.
- **Tap targets**: `h-9` rows plus `max-sm:h-11`, and `max-sm:h-11` on the bottom-bar contact link too — the
  bottom bar is the one that always keeps a 36 px row and trips the phone sweep.
- Do not restate the header CTA in the footer; the closing CTA band above it already carries the buttons.

```js
// footer sanity: columns, tap targets, anchors
[getComputedStyle(footerGrid).gridTemplateColumns,                     // 392px 261px 261px 261px at 1440
 [...document.querySelectorAll('footer a')].filter(a => a.getBoundingClientRect().height < 44).length]  // 0 at 390
```
