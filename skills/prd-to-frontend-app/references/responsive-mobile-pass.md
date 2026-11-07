# Responsive / mobile pass for a dashboard build

Run this before claiming a dashboard is finished. Desktop-first builds pass their own acceptance tests and
still fall apart at 390 px; the user will ask for mobile explicitly and judge the answer by what they see on
their phone. "Support mobile" means phone layout first, then the platform behaviours that make it feel like
an app rather than a narrow website.

## 0. Native baseline — CSS and meta first, layout second

Do this in one pass before hunting individual controls; it removes whole classes of defects.

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="color-scheme" content="dark" />
<meta name="format-detection" content="telephone=no" />
```

```css
@layer base {
  html { -webkit-text-size-adjust: 100%; scroll-padding-top: 4.5rem; }
  body { -webkit-tap-highlight-color: transparent; overscroll-behavior-y: none; }

  @media (max-width: 899px) {
    /* !important is required: per-component text-[13.5px] outranks this selector,
       and iOS zooms the whole layout when a focused input computes under 16px */
    input, textarea, select { font-size: 16px !important; }
    button, a, [role="button"], summary { touch-action: manipulation; }
    .tap-44 { min-height: 44px; }
  }
}

.safe-t { padding-top: env(safe-area-inset-top); }
.safe-b { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }
```

Apply `safe-t` on the sticky header, `safe-b` on the menu sheet and on `<main>` so the last card clears the
home indicator. Every control needs an `active:` state (scale 0.95–0.985 or a background flash) because
`hover:` never fires on touch — a phone UI with only hover feedback feels dead.

## 1. Measure, don't eyeball

Loop every authenticated route at 390×844 and collect numbers. Batch the probe into one `browser_exec` call
so a timeout does not lose the whole sweep:

```js
// run per route after goto_url + wait_for_load
(() => {
  const of = document.documentElement.scrollWidth - innerWidth;      // page-level overflow
  const wide = [...document.querySelectorAll('main *')].filter(e => {
    const b = e.getBoundingClientRect();
    return b.right > innerWidth + 1 && b.width > 0 && !e.closest('.overflow-x-auto');
  }).length;                                                        // elements escaping the viewport
  const small = [...document.querySelectorAll('a,button,select,[role=switch]')]
    .filter(e => {
      const b = e.getBoundingClientRect();
      return b.height > 0 && b.height < 44;                         // 44px is the floor, not 36
    })
    .map(e => Math.round(e.getBoundingClientRect().height) + ':' +
                (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 18)));
  const tables = [...document.querySelectorAll('main table')]
    .map(t => ({ sw: t.scrollWidth, cw: t.parentElement.clientWidth }));
  const chart = document.querySelector('.recharts-responsive-container');
  return JSON.stringify({ of, wide, small, tables, chartH: chart ? Math.round(chart.getBoundingClientRect().height) : null });
})()
```

`of` must be `0` (a negative value just means the scrollbar). Table scroll inside its own wrapper is fine;
the page scrolling sideways is not.

## 2. The fix set that answers "support mobile too"

| Symptom | Fix |
| --- | --- |
| Table 640 px inside a 316 px wrapper | `min-w-[430px] sm:min-w-[640px]`, `px-3 sm:px-4`, **sticky first column** (`sticky left-0 z-10 bg-<card> group-hover:bg-<card-hover>`) and a right-edge fade + `sm:hidden` hint "Swipe sideways". A silent clipped table reads as broken. |
| KPI cards one per row, page 3 000 px tall | `grid-cols-2` at base, `xl:grid-cols-4`; drop the number size to ~20 px on phones |
| Chart 280 px tall on a 390 px screen | Clamp inside the chart component: `useMediaQuery('(max-width:639px)')` → `Math.min(height, 200)` so every call site is fixed at once |
| Sidebar drawer scrolls the page behind it | `useEffect` on `open`: set `document.body.style.overflow = 'hidden'`, restore the previous value on cleanup |
| Icon buttons / switches 24–40 px | 44 px hit area on phones, original size restored from `sm` up: icon buttons `size-11 … sm:size-9`, switches `size-11 … sm:size-10`, row-action kebabs the same. `min-h-11` on text links that must stay 11–13 px type |
| Modal off-screen or half-width | Bottom sheet: `items-end` + `rounded-t-2xl` on phones, `sm:items-center sm:rounded-2xl` |
| Content flush to the bottom edge | `pb-16` on `<main>` |
| Hero two-column only from `lg` | Start it around 900 px (`min-[900px]:grid-cols-…`) so tablets do not stack the text above the graphic |

A shared `Switch` component (track inside a 44 px hit box) beats copy-pasted toggle markup — hand-rolled
toggles are where the small targets hide. Same for `Button`: give `size="sm"` a `h-11 sm:h-9` floor so
pagination, "Choose a plan", "Start building" and every other compact button clears 44 px on a phone
without touching each call site. Segmented controls (`h-8`) and filter selects (`h-10`) are the next
culprits; `h-11 sm:h-8`/`h-11 sm:h-10` keeps desktop identical.

### 2b. Delete what does not convert

A marketing graphic built for a 600×430 canvas — hub, lanes, four provider cards — has no honest phone
form. Stacking the four cards into a mini list was accepted by nobody: it was the single element called
"jelek banget". Removing it below 900 px (`<div className="hidden">` around the mobile variant) dropped the
hero 818 → 558 px and the page read better, because the catalogue and the popular-models list already carry
the same information. Keep the desktop block untouched, and say in the code comment *why* the phone has no
graphic so nobody "fixes" it back in.

Same test for a wide marketing table (catalogue, pricing matrix): if sideways scrolling is the only way to
see column 4, render cards instead.

```tsx
{/* table: desktop only */}
<div className="surface overflow-hidden p-0 max-[899px]:hidden"> … <table className="min-w-[680px]" /> … </div>

{/* cards: phones only — one card per model, no horizontal scroll */}
<ul className="space-y-2.5 min-[900px]:hidden">
  <li className="rounded-xl border border-ash/18 bg-[#1a1b1e]/70 p-3.5">
    <div className="flex items-start justify-between gap-3">
      <span className="grid size-9 place-items-center rounded-xl border border-ash/20">logo</span>
      <div className="min-w-0"><p className="truncate text-[15px]">Name</p><p className="truncate font-mono text-[12px]">model-id</p></div>
      <span className="text-[12px] text-flame">online</span>
    </div>
    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-ash/10 pt-2.5"> … </dl>
  </li>
</ul>
```

Then bump the phone type floors the table was hiding: body copy 15 px / leading-7, card meta 12–13 px,
code 12 px. A mobile font histogram dominated by 12–13 px is the real "not native" signal — the 11 px
threshold in the audit only catches the extremes.

## 3. Prove the interactions, not just the layout

- Drawer: open → `aside.getBoundingClientRect().right` ≈ 264 and `getComputedStyle(document.body).overflow === 'hidden'`; close → back to 0 and the previous overflow value.
- Mobile menu sheet: rows measure 48 px, the sheet carries `safe-b`, opening it locks body scroll, and both
  **Escape** and a route tap close it (`document.body.style.overflow` returns to its previous value). Its
  CTA is 48 px tall and points at the same `dashboardHref` the desktop button uses.
- Sticky header gains elevation after scroll: `scrollY > 6` → background opacity rises and a shadow appears;
  assert `header.getBoundingClientRect().top === 0` while scrolled.
- Modal: `role="dialog"` box width equals the viewport and `bottom === innerHeight` on phones (bottom sheet).
- Switch: `role="switch"` is 40×40, toggling flips `aria-checked` **and** the app effect (e.g. `html[data-reduced-motion]`).
- Table: `scrollWidth > clientWidth` inside the wrapper while page `scrollWidth - innerWidth === 0`.

## 4. Desktop regression

Probe with the metrics override re-applied at the start of the call, and report `vw` with the numbers:
under emulation an overflowing page can return `innerWidth: 456` on a 390 px device, so `innerWidth` is not
the layout width — use `document.documentElement.clientWidth`. Clearing the override between calls silently
puts you back at 1440 px, which is how a "mobile" sweep ends up measuring the desktop build.

If the page overflows by a few tens of px and no element is obviously too wide, suspect a grid track's
min-content rather than the page frame: a `grid-cols-3` strip pins its `display:block` child to the sum of
the three min-contents (440 px inside a 358 px column). Fix the container (`grid-cols-[minmax(0,1fr)]` for
the implicit single column) and add `min-w-0` to the children; `overflow-x: hidden` on `html` only hides the
symptom.

Re-check one table page at 1440 px: `table.scrollWidth === parent.clientWidth` and page overflow negative.
A sticky first column must be the same colour as the card, otherwise it paints a visible stripe on desktop.

**Scope phone-only fixes with `max-sm:`, not `sm:`.** Once the desktop has been signed off, the safest
mobile override changes nothing at ≥640 px by construction:

```
/* safe: desktop untouched */        className="rounded-md px-2 py-1 text-[10.5px] max-sm:h-11 max-sm:px-3 max-sm:text-[12px]"
/* risky: pair can be written backwards and silently re-styles desktop */
                                      className="h-11 px-3 text-[12px] sm:h-auto sm:text-[10.5px]"
```

A `sm:` reversion written in the wrong direction (`text-[11.5px] … sm:text-[11px]`) ships a *smaller*
desktop than the approved one and comes back as "why did you change it, it was good". Before the sweep,
record the approved computed metrics of any dense component you touch (code panel, tab strip, compact
chrome); after it, `getComputedStyle` the same nodes at 1440 and diff the numbers, not the class list.
For reference, the approved terminal chrome was: tab 43×24 at 10.5 px, copy 51×19 at 10 px, code
11.5 px / 20.1 px line-height, panel 264 px tall.

## 5. Report

Quote per-route numbers (`/app/usage overflow 0, under-44 0`) and the widths you actually ran (360/390/414).
Do **not** attach screenshots — this user opens the page on his own phone and treats unsolicited captures as
noise. "Looks responsive" without measurements is the answer that gets re-requested.
