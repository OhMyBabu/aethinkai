---
name: prd-to-frontend-app
description: Use when building a working frontend from a PRD or zip.
version: 1.0.0
author: Ganteng
license: MIT
metadata:
  hermes:
    tags: [frontend, react, vite, prd, ui]
    related_skills: [gsap-svg-signal-diagram, impeccable, ui-ux-pro-max]
---

# PRD / reference → working frontend app

Class of work: the user drops a PRD (often a zip with PRD.md, design-tokens.json and reference images),
expects a running app in one pass — scaffolded, built, exercised in a real browser, and handed over with
screenshots and an evidence table. Not a plan, not a mock.

## When to Use

- A PRD, spec zip, or reference screenshot arrives with "build this".
- An existing demo app needs routes, state, or visual fidelity brought up to a supplied spec.

## Procedure

1. **Read the whole pack before writing code.** Unzip to the scratch dir; read README/PROMPT/PRD
top-to-bottom plus `design-tokens.json`. Reference images are the source of truth for *composition*:
crop the graphic region, downscale to ≤620 px, and describe it with `vision_analyze` before inventing a
layout. A wrong mental model of the reference costs a full rebuild later.
2. **Scaffold with pinned versions, install in the background.** Vite + React + TS + Tailwind v4
(`@tailwindcss/vite`) + react-router + lucide-react + motion + recharts (+ gsap when the spec asks for
animation). Start `npm install` with `background=true, notify=true` and write source files while it runs.
3. **Build bottom-up:** `types/` → `lib/` (format, storage, csv, id, series) → `data/fixtures.ts` →
`data/store.tsx` → `components/{common,layout,charts}` → pages → `app/App.tsx` routes + guards.
   - Fixtures must be deterministic (seeded PRNG such as mulberry32) so charts never jitter between
     refreshes.
   - Generate enough rows for the charts to look real: ~600 usage rows over 90 days, recency-weighted,
     otherwise 7-day views render 4 points and the dashboard looks broken.
   - Store = context + reducer; persist the whole state to one versioned `localStorage` key; ignore stale
     or corrupt payloads by falling back to fixtures. Bump that version whenever fixture *content* changes
     (new model catalogue, renamed entities): a persisted older payload otherwise keeps rendering the old
     data on every returning browser.
4. **Route guards hydrate synchronously.** Read `localStorage` inside the `useReducer` initializer, not in
   a mount effect: an effect-driven hydrate lets `/app/*` redirect to the login route for one frame on
   every reload.
5. **Build, then fix every type error before touching styling.** `npm run build` (`tsc -b && vite build`).
   Split heavy libs with `build.rollupOptions.output.manualChunks` (recharts, gsap, motion, router) so the
   entry chunk stays small; `@types/node` is required as soon as vite.config uses `node:path`.
6. **Exercise the real app in the browser** — no claim of "done" without tool output. Route sweep, then
each acceptance flow in the PRD. Use `references/verification-checklist.md`.
7. **Do the mobile pass before hand-off, in native units.** Sweep every route (public, auth, user, admin) at
360×800, 390×844 and 414×896 and fix what the probe reports: page overflow, **any** interactive element
under 44 px tall, tables wider than their wrapper, phone-height charts, the drawer scrolling the page
behind it, modals that are not bottom sheets, text below 11 px. "Native" also means the platform baseline,
not just layout: 44 px targets, 16 px inputs, no tap highlight, safe-area insets, press feedback instead of
hover. Follow `references/responsive-mobile-pass.md`; the user judges "support mobile" on their own phone,
not on your `sm:` classes. Deciding what *leaves* the phone is part of the pass: a hero graphic that only
reads at ≥900 px gets removed below that width, not restacked into a miniature — dropping the routing
diagram took the hero from 818 to 558 px and was accepted, while the stacked-card fallback it replaced had
already been called out as the worst element on the page. Same rule for a wide catalogue table: on phones
it becomes cards (`table` wrapper `max-[899px]:hidden`, card list `min-[900px]:hidden`), never a sideways
scroller the user has to discover.
8. **Offer a shareable URL, then publish it.** Cloudflare quick tunnel for a live link now (no port
forwarding), and be explicit that it is ephemeral; permanent needs Pages or a named tunnel + domain. Vite
needs `allowedHosts: true` on both `server` and `preview` or the tunnel gets 403. Recipe:
`references/publish-and-share.md`, script: `templates/share-cloudflare.sh`.
9. **Deliver** the report shape below in chat. Attach screenshots only when the user asks — this user
   opens the running app himself and treats unsolicited captures as noise. Numbers, paths and the live URL
   carry the proof; keep any captures local for your own verification.

## Deliverable report shape

```
Path + stack + file/line count · dev + preview URLs (incl. LAN IP) · restart commands
Route table · "what I verified" table with measured results (build ok, 0 console errors,
overflow 0 at 1440/390, each flow) · honest gap list · live URL + restart commands
```

No screenshots in the message unless requested; the evidence lives in the measured table.

The user reads evidence tables, not prose. Indonesian for rapport, English for identifiers and code.
Never claim a feature works because the code exists — cite the probe that proved it.

## Always-on rules for this user

- **Fidelity beats invention.** When a reference exists, reproduce its composition (element order,
  connector geometry, card density); do not "improve" it. "Make it exactly like this" means measure the
  reference, not restyle it.
- **No ornament without function.** Decorative dot fields, glow layers and filler graphics get cut. Dense,
  purposeful layouts win; generous air gets called out as wasted space.
- **Chrome is a design surface.** Bare text links in the header read as unfinished and get called ugly;
  rebuild them as 3D pill navs (perspective wrapper + spring `rotateX` hover + cursor spotlight) and make
  Docs/Status real overlay panels — endpoint table with p95, uptime bars, incident footer — not a paragraph
  in a strip. Animation is judged on feel: spring, not linear. Labels are **bold (700, 13 px)** and carry the
  app's *own* icon set — the same lucide components the dashboard sidebar uses for those destinations
  (`Boxes`, `Tag`, `Activity`). Emoji glyphs get rejected on sight; when a header item has no sidebar twin
  (Docs), keep the same lucide library rather than inventing a different visual language. Recipe + probes:
  `references/nav-and-panel-polish.md`.
- **The footer is chrome too.** A lone copyright line is read as "footer masih belum ada perbaikan apapun";
  every marketing page ends in a real footer — brand lockup + one-sentence positioning + live status pill
  on the left, three link columns (Product / Account / Developers), then a bottom bar with copyright,
  locale and contact. Every footer link must resolve to an existing section id: add the missing one
  (`id="terminal"` + `scroll-mt-24` on the code-panel block) rather than shipping a link that scrolls
  nowhere. Link rows are `h-9` on desktop and `max-sm:h-11` on phones. "Perbesar font header" means the
  brand lockup, not the nav: logo 36 px, title 18 px, sublabel 10.5 px / 0.26 em tracking → 52 px tall in
  the 64 px bar, then assert clearance to the absolutely-centred nav
  (`nav.left - wordmark.right ≈ 300 px`). Recipe: `references/nav-and-panel-polish.md` §10–11.
- **3D is seasoning, not structure.** Asking for 3D is followed almost immediately by "too bold" — ship the
  quiet end first: bevels at ≤6 % alpha (one light top, one dark bottom), one hairline highlight, a single
  1 px cast shadow, tilt ≤5°, hover lift ≤2 px, no outer glow on idle surfaces. Depth comes from gradient +
  light direction, not from thick borders or big shadows. When the effect has to be dialled back, cut the
  shadow layers first, then the hairline, then the tilt — and delete the props rather than layering overrides
  so the file does not accumulate dead style.
- **Palette discipline is a hard constraint.** If the spec gives five hues, only those five plus alpha
  appear anywhere; no neon cyan/purple, no green success states unless the token list has them. Derived
  tints count as new hues: a hand-mixed gradient stop (`#F6B173`), ring (`#F3A869`) or shadow colour invented
  to make a button pop is still off-palette and the user calls it out immediately. Build the gradient from
  the tokens themselves (accent → its darker sibling), set text in the neutral token, and use the light token
  at low alpha for sheen/border highlights.
- **Real marks, not placeholders.** Any named vendor/model card carries that vendor's official logo, not a
  generic lucide glyph. Use the generator in `gsap-svg-signal-diagram` (`scripts/fetch-model-logos.py`):
  mono (`currentColor`) on palette-locked surfaces such as the hero, brand fills where the catalogue's
  colour is information. Prefix inlined SVG gradient ids per vendor so `url(#…)` cannot cross-resolve.
- **Supplied logo art ships verbatim.** When the user hands over an icon and says "replace ours with this,
  favicon included", copy the raster through — never retrace it in SVG, never luminance-key the dark tile to
  fake transparency (it leaves stray arcs and edge noise). Derive 16/32/180/192/512 + manifest + og:image from
  that one source, delete the old hand-drawn favicon and prove the built HTML dropped it. Full recipe:
  `references/brand-assets.md`.
- **Use the product's own host in anything user-facing.** Snippets pasted by the user are illustrative: the
  curl/python examples in a spec usually point at a third-party demo domain. Render the product's own
  gateway (e.g. `https://api.<product>.ai/v1`), bound to `VITE_GATEWAY_BASE_URL` / `VITE_GATEWAY_MODEL` with
  a committed `.env.example`, so the host changes without touching code. Shipping the example's domain
  reads as a copy-paste blunder and gets called out immediately.
- **Pasted lists are contract data.** Reproduce the exact IDs and figures the user typed — write
  `1.048.576`, not `1M` — and show the raw model ID next to the display name. Prettifying an ID or
  compacting a number reads as "you ignored my list". When told to "take a few" for a highlights row, take
  one flagship per vendor instead of the global top-N.
- **Implement graphics as code** (SVG/CSS/canvas), never as embedded reference images, even when the
  reference is a JPG.
- **Backend walls hold; auth walls come down on request.** Frontend-only means no provider calls, no
  server secrets, no payment — but "stop demo-ing, make it run for real" means *client-side* auth done
  properly: PBKDF2-hashed passwords, per-account salt, real sign-in/sign-up, route guards. Provider
  routing, key verification and billing stay behind the future API. Recipe:
  `references/real-auth-local.md`.
- **"No demo" is a copy sweep, not a rename.** When the user says the build must stop feeling like a demo,
  grep `demo|simulat|illustrat|fixture|mock` across `src/`, `index.html` and the README until the count is
  zero — toasts, empty states, captions, footers, table captions, activity log text and route names
  (`/demo-login` → `/login`) all count. A component renamed to `Login` with demo copy inside still reads as
  a demo on first click.
- **A mobile pass must not move desktop.** Once the user says the desktop build is right, write every mobile
  fix as base class + `sm:`/`lg:` reversion (`h-11 … sm:h-9`, `size-11 … lg:size-9`, `text-[14px] …
  sm:text-[12.5px]`) so ≥640 px resolves to the values he already approved. A mobile rule that also applies
  from `sm`  up silently re-opens a signed-off layout; re-verify one header + table page at 1440 px after the
  sweep, not only the phone widths. For components whose desktop metrics were already signed off
  (code panel, tabs, compact chrome), do not write a `sm:` reversion at all — scope the change with
  `max-sm:` (`max-sm:h-11 max-sm:px-3 max-sm:text-[12px]`) so the ≥640 px rule is unchanged. A `sm:`
  pair written in the wrong direction (`text-[11.5px] … sm:text-[11px]`) silently ships a *smaller*
  desktop than the approved one and the user reports "why did you change it, it was good". Prove it
  by `getComputedStyle` at 1440 and comparing against the pre-sweep numbers (tab 24 px / 10.5 px,
  copy 19 px, code 11.5 px, panel 264 px in the terminal case), not by reading the class list.
- **A flat surface reads as unfinished — but only on the page he names.** "Background is just flat
  grey" is about the *marketing* page unless he says "dashboard"; changing the other surface gets
  reverted by hand ("maksudku landing bukan dashboard, yang di dashboard biarin"). Answer the landing
  with an organic aurora — base wash, two warm blooms (flame 17 % / burnt 15 %), one cool lift, a
  diagonal light sweep, grain, vignette — and **no grid, no dots, no boxes**: geometric patterns read
  as "kotak-kotak, kurang" on a marketing page. Grids belong to data surfaces only. Every layer is
  `fixed inset-0 -z-10 pointer-events-none`, CSS-only, mounted once. Recipe, calibration numbers and
  the invalid-`/95`-modifier trap: `references/dark-surface-backdrop.md`.
- **A negative-z backdrop is invisible under a parent that paints.** If the fixed `-z-10` stack
  renders but every sampled pixel is the same `#18191B`, look for a `bg-*` class on the page-root
  wrapper: a negative-z child paints above the canvas but *below* its ancestor's block background, so
  the whole stack is hidden while `getComputedStyle` still reports the gradients. Drop the wrapper's
  background (the `body` already paints) and keep `relative` on it; then confirm with two different
  pixel values, never with the class list.
- **Landing CTAs speak the header CTA's language, one notch quieter.** Once the header's Sign-in is
  approved, the page buttons are expected to match it — same gradient stops (`#E7893C → #9C542F` at
  58 %), same `#18191B` text, but thinner: border `.34` alpha, inset highlight `.24`, one
  `0 5px 14px -12px rgba(231,137,60,.55)` shadow, hover lift 1 px without scale, and a slow sheen
  (warm 20 %, 0.8 s). Secondary/ghost buttons get the sheen and the 1 px lift only — a second gradient
  kills hierarchy. Ship both as unlayered utility classes (`.cta-landing`, `.cta-landing-soft`) applied
  at the call sites so dashboard buttons keep their variant styling, and freeze the sheen under
  `prefers-reduced-motion`.
- Clean up in the same pass — deleting a feature means deleting its component file, import, styles and
  README mention, not leaving dead code behind.

## Pitfalls

- Reset keeps the session **only when the signed-in account still exists in the baseline**: compare
  `fixture.users.some(u => u.id === currentUserId)` before restoring `role`/`currentUserId`. Blanket-reset
  bounces a seeded admin to `/login` right after "reset worked"; blanket-preserve leaves a dangling
  `currentUserId` for the account the reset just deleted, and the shell silently renders the first user in
  the list instead.
- Replacing an entity catalogue means migrating every fixture that points at the old ids (API-key scopes,
  usage rows, activity text). Seeded FKs do not cascade: a key whose `allowedModels` still names a deleted
  model renders an empty scope and the detail drawer shows blanks.
- A one-time key reveal must mask the *same* secret that was shown; generating the secret twice produces a
  masked identifier that matches nothing the user saw.
- Wide data tables need `min-width` + their own `overflow-x-auto` wrapper, otherwise the page scrolls
  horizontally at 390 px even though the table "looks fine". Where the table is a marketing catalogue rather
  than a work surface, go further and swap it for cards on phones — this user reads an internal scroller as
  "belum native".
- A phone overflow of a few tens of px is usually a **grid track's min-content**, not the page structure: a
  `grid-cols-3` KPI strip or a promo grid can pin a `display:block` child at 440 px inside a 358 px column
  (the child reports `width: 440` while its parent reports `358`). Fix at the container
  (`grid-cols-[minmax(0,1fr)]` for the implicit one-column case) plus `min-w-0` on the grid's children, then
  re-probe `documentElement.scrollWidth - documentElement.clientWidth === 0` at 390.
- Under CDP emulation read layout width from `document.documentElement.clientWidth`, never `innerWidth`: an
  overflowing page can report `innerWidth: 456` for a 390 px device while `clientWidth` stays 390, and any
  probe that cleared metrics (`Emulation.clearDeviceMetricsOverride`) silently measures the 1440 px desktop.
  Re-apply the metrics override at the top of **every** probe call and print `vw` alongside the numbers, or
  you will ship a "mobile fix" verified against a desktop viewport.
- Reveal-on-scroll wrappers can strand content at `opacity: 0` when the trigger misfires — always pair the
  observer with a short safety timeout that forces the finished state.
- Changing fixtures without bumping the store version strands every returning browser on the old dataset.
  The symptom is the user insisting the new list is missing while the source plainly contains it; bump the
  version (older payloads then fall back to fixtures), hard-refresh, and prove it on dev *and* preview with
  a cache-busting query before arguing.
- Copy buttons need a real user gesture: `element.click()` from a script is untrusted, so
  `navigator.clipboard.writeText` rejects and no toast appears. Probe with CDP `Input.dispatchMouseEvent`
  (mousePressed + mouseReleased at the button centre), and ship a `textarea` +
  `document.execCommand('copy')` fallback for non-secure/headless contexts.
- Setting `el.value = x` then dispatching `input` does **not** move React state: React tracks the value
  through its own property descriptor, so the field looks filled while validation still reports it empty.
  Use the prototype setter —
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)` — then dispatch
  `input` (plus `change` for `<select>`). `fill_input` (real keystrokes) is the fallback for plain text
  fields.
- A DOM probe fired immediately after `goto_url` can read the *outgoing* page: during a route transition
  the previous tree is still mounted, so `document.querySelector('.aurora-a')` reports the landing
  backdrop on `/admin/overview` and looks like a leak. Re-assert after the path settles (one extra
  `time.sleep`, then re-query the count) before acting on any "element should not be here" finding.
- `js()` must return primitives or a JSON string: returning a `NodeList`/element throws
  `Object reference chain is too long`. Return `.length`, `.value`, `.textContent` or `JSON.stringify(...)`.
- Verify visual claims with pixel sampling (PIL) when screenshot analysis is unavailable: hue counts inside
  a band prove a stroke exists, row brightness proves spacing.
- Free a dev/preview port by PID, never with `pkill -f "vite preview"`: the pattern matches the shell that
  is executing the command, so the call SIGTERMs itself and returns nothing. `ss -ltnp | awk '/:4173/…'` →
  `kill "$PID"`.
- Panels rendered in flow inside a sticky header grow the header and shove the page down when opened;
  anchor them `absolute inset-x-0 top-full` inside the positioned header and prove it by comparing
  `h1.getBoundingClientRect().y` before/after. Same family: `mx-auto` does not centre a nav when the brand
  and CTA columns differ in width — absolutely centre it and assert the offset is 0.
- CSS `prefers-reduced-motion` does not neutralise Motion's inline transforms: pull `useReducedMotion()`
  and pass `undefined` to `whileHover`/`whileTap`, or the 3D tilt ignores the OS setting.
- Tailwind v4 wraps every `hover:`/`group-hover:` utility in `@media (hover: hover)`, and headless Chromium
  reports `matchMedia('(hover: hover)').matches === false` — so hover colours, borders and spotlights never
  apply in automated probes even though the page is fine. Check `document.styleSheets` text for the
  `.hover\:text-warm:hover` selector before "fixing" it, and use JS-driven Motion transforms (which ignore
  the media query) when a hover claim needs tool-observable proof. Hand-written `:hover` rules in unlayered
  CSS are **not** media-wrapped, so `Input.dispatchMouseEvent` does trigger them: prove a lift/sheen by
  reading `getComputedStyle(el).transform` plus `getComputedStyle(el, '::after').transform` before and after
  the mouse move (measured `translateY(-1px)` and a sheen translating from -130 % to +79 px).
- Tailwind v4 preflight no longer sets `cursor: pointer` on `<button>`, so every control in the app renders
  a default arrow and the user reports "why doesn't the cursor become a hand". Fix once, globally, in
  `globals.css` rather than per component: inside `@layer base`, give `button:not(:disabled)`,
  `[role="button"]:not(:disabled)`, `summary`, `label[for]` and `select:not(:disabled)` `cursor: pointer`,
  and `button:disabled` / `[aria-disabled="true"]` `cursor: not-allowed`. Probe with
  `getComputedStyle(btn).cursor` on landing, auth and dashboard routes plus one disabled control.
- Two utilities for the same property in one `className` do not merge unless the joiner is `tailwind-merge`:
  `cn("bg-idle", active && "bg-active")` ships both classes and the *stylesheet* order decides, so the open
  state silently renders as the idle one (aria-expanded says true, colour says false). Emit one surface
  string per state (`active ? A : B`) covering background, shadow and text colour together, then prove the
  state with `getComputedStyle(el).backgroundImage` — never with `classList.contains`.
- Selecting by tag or text can hit a hidden twin: at 390 px `header a` still matches the desktop nav that is
  `display: none`, so the scripted click lands nowhere and the probe looks like a layout bug. Filter
  `offsetParent !== null` (or `rect.width > 0`) before clicking, and when a scripted interaction has no
  effect, dump the element you actually clicked before touching the CSS.
- Taking the nav out of flow to centre it moves the trailing CTA: a right-hand group that still carries
  `md:ml-0` loses its `ml-auto` at ≥768 px and the Sign-in button jumps next to the brand (it also overlaps
  the absolutely positioned nav). Keep `ml-auto … shrink-0` on that group at every breakpoint and assert
  `btn.right` against the header's inner right edge at 640/768/900/1024/1440.
- A nav label must land on the section whose eyebrow says the same thing: "Models" pointing at a highlights
  strip while the full catalogue lives under `#catalog` reads as a broken menu. After the jump, assert
  `location.hash` and the target section's heading text — not just that the page scrolled. On mobile the
  anchor a user taps lives inside a collapsible menu: a plain `href="#id"` scrolls while that menu is still
  expanded, then the page reflows as it closes and the section lands ~140 px low. Close the menu, wait one
  frame past its collapse (~320 ms), then scroll arithmetically —
  `window.scrollTo({ top: scrollY + target.getBoundingClientRect().top - headerHeight - 16, behavior: 'smooth' })`
  — and assert the section's `top` equals header height + 16 px, not merely that a hash appeared.
- iOS Safari zooms the viewport whenever a focused input computes under 16 px. Only
  `@media (max-width:899px){ input,textarea,select { font-size:16px !important } }` actually lands: the
  per-component `text-[13.5px]` utility outranks an element selector, so without `!important` the rule loses
  and the field still reports 13.5 px. Probe `getComputedStyle(input).fontSize` on the login form.
- Anything interactive that measures under 44 px is a miss on phones, and they hide in the same places every
  build: icon-only buttons (`size-9`), switches (`size-10`), `h-10` filter selects and search inputs, `h-8`
  segmented controls, breadcrumb/footer/"View all" text links, terminal tabs and copy buttons, sort buttons
  inside `<th>`, row-action kebab buttons, and the header's sign-in CTA hidden below `sm`. Fix the shared
  component (Button `size="sm"` → `h-11 sm:h-9`, Switch, FilterSelect, SearchInput) so every call site
  inherits it; for `<th>` give the button `h-11` and drop the cell's vertical padding, or the header row
  becomes 68 px tall. On phones the sign-in CTA has to live inside the menu sheet — hiding it with
  `hidden sm:inline-flex` leaves no way in from the header.
- When the user reports a heading "repeating further down" or "pushed down again", check the breakpoint
theme: a hero whose two-column grid starts at `lg` while its compact graphic variant swaps at `md` stacks
the text above a graphic that carries the same brand label. Measure `h1.y` vs `hub.y` at 390/768/900/1024/
1280 and make both switches happen at the same width.

- **A controlled text input loses the caret when its parent re-renders on every keystroke.** The user
  reports "the cursor keeps jumping after one letter", not a crash: each character updates page state, the
  filtered table and the count-up KPIs re-render, and a slightly stale `value` write throws the caret to the
  end. Make search fields self-buffered — local state per keystroke, propagate to the parent on a ~140 ms
  debounce, and mirror an external reset only when the incoming prop differs from what this field last
  emitted — so a re-render can never rewrite the value mid-typing. Same family: do **not** put
  `onFocus={e => e.currentTarget.select()}` on edit fields (it re-fires every time the caret is clicked
  back in, so the first keystroke wipes the number and it reads as a jumping cursor); select the value once
  when the row enters edit mode instead. Stabilise the layout too: give table bodies `min-h` plus their own
  `max-h`/`overflow-auto` so filtering cannot resize the page under the pointer. Probe by sending one
  `Input.insertText` per character and asserting `document.activeElement === input` and `selectionStart`
  after each; typing the whole string in one call hides the bug completely.

## References

- `references/verification-checklist.md` — browser probes, pixel checks, acceptance-flow scripts.
- `references/responsive-mobile-pass.md` — native baseline (meta + CSS), 360/390/414 audit probe, 44 px fix
  table, menu-sheet and drawer interaction proofs.
- `references/publish-and-share.md` — Cloudflare quick tunnel, Vite `allowedHosts`, permanent options.
- `templates/share-cloudflare.sh` — copy-paste share script (preview + tunnel + URL).
- `references/brand-assets.md` — supplied logo → component + full favicon/manifest icon set, verification.
- `references/real-auth-local.md` — demo → real client-side auth: PBKDF2 seeding, login/sign-up, guards,
  invite passwords, reset semantics, verification matrix.
- `references/hero-code-quickstart.md` — terminal-style API quickstart panel for the hero (3 language tabs,
  palette-only tokenizer, auto-advance that honours reduced motion, copy with fallback).
- `references/nav-and-panel-polish.md` — 3D pill nav, docs mega panel, status popover, centring/overlay
  probes and the Motion pitfalls.
- `references/design-skill-packs.md` — installing external UI/UX skill packs (uipro, impeccable) into
  Hermes before a design-heavy build.
- `references/dark-surface-backdrop.md` — layered dark backdrop for dashboards (wash, blooms, masked
  grid, grain, vignette), calibration alphas, pixel-sampling proof, invalid gradient-modifier trap.
- Animation of hub/spoke hero graphics: see the `gsap-svg-signal-diagram` skill (also holds
  `scripts/fetch-model-logos.py` for official vendor marks).
