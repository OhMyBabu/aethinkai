# Dark-surface backdrop (dashboards & marketing pages)

When the user says the background "is just flat grey / too plain / bisa lebih manis", the fix is a
*stack* of near-invisible layers, not one big gradient. Keep every layer `pointer-events-none`,
`fixed inset-0 -z-10`, and CSS-only — no JS, no scroll listeners, nothing that repaints while the
page scrolls.

Two surfaces, two answers — do not mix them:

- **Marketing / landing** → organic atmosphere: blooms, grain, vignette, a diagonal light sweep.
  **No grid, no dot field, no boxes.** Geometric patterns get rejected ("kotak-kotak gitu diletakkan di
  landing kurang"). Ships as `LandingAurora`.
- **Dashboard / app shell** → the flat charcoal field is normally *fine*; only touch it when he
  actually says "background dashboard". If you guessed wrong, revert your own layer completely
  (delete the component, restore `bg-charcoal` on the shell and the solid sidebar) before proposing
  alternatives.

## Layer order (verified recipe)

```tsx
export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#141518]">
      {/* 1 base wash — lifted top, deeper bottom */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#1A1B1F_0%,#17181C_30%,#141518_70%,#121316_100%)]" />

      {/* 2 warm light sources */}
      <div className="absolute right-[-260px] top-[-260px] h-[720px] w-[820px] opacity-80 blur-[130px]"
           style={{ background: "radial-gradient(closest-side, rgba(231,137,60,0.115), rgba(156,84,47,0.055) 55%, transparent 76%)" }} />
      <div className="absolute bottom-[-320px] left-[-180px] h-[560px] w-[760px] opacity-60 blur-[140px]"
           style={{ background: "radial-gradient(closest-side, rgba(133,136,139,0.10), transparent 74%)" }} />

      {/* 3 hairline grid, radially masked so it melts at the edges */}
      <div className="absolute inset-0" style={{
        backgroundImage:
          "linear-gradient(to right, rgba(250,248,244,0.075) 1px, transparent 1px), linear-gradient(to bottom, rgba(250,248,244,0.075) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
        backgroundPosition: "center top",
        maskImage: "radial-gradient(135% 105% at 50% 0%, #000 0%, rgba(0,0,0,0.6) 52%, transparent 88%)",
        WebkitMaskImage: "radial-gradient(135% 105% at 50% 0%, #000 0%, rgba(0,0,0,0.6) 52%, transparent 88%)",
      }} />

      {/* 4 film grain — kills banding on wide monitors */}
      <div className="absolute inset-0 opacity-[0.055] mix-blend-soft-light" style={{
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23g)'/%3E%3C/svg%3E\")",
        backgroundSize: "160px 160px",
      }} />

      {/* 5 vignette — pushes attention to the centre */}
      <div className="absolute inset-0 bg-[radial-gradient(130%_100%_at_50%_0%,transparent_45%,rgba(9,10,12,0.34)_100%)]" />
    </div>
  );
}
```

Mount it once in the app shell (`<div className="relative flex min-h-screen"><AppBackdrop />…`) and
drop the flat `bg-charcoal` from that wrapper so the layers are visible. Give the sidebar a
translucent gradient + `backdrop-blur-xl` so the light bleeds through it and it reads *in front of*
the canvas:

```
bg-[linear-gradient(180deg,rgba(23,24,28,0.93)_0%,rgba(21,22,26,0.95)_55%,rgba(18,19,22,0.96)_100%)] backdrop-blur-xl
```

## Marketing variant — aurora, zero geometry

Same mounting rules, different content. Two blooms that drift on a long loop, a diagonal sweep, no
pattern layer at all:

```tsx
export function LandingAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#15161A]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#1C1D22_0%,#18191D_44%,#15161A_100%)]" />

      {/* bloom A — behind the headline */}
      <div className="aurora-a absolute left-[-14%] top-[-24%] h-[880px] w-[1080px] rounded-full opacity-90 blur-[120px]"
           style={{ background: "radial-gradient(closest-side, rgba(231,137,60,0.17), rgba(156,84,47,0.075) 55%, transparent 78%)" }} />

      {/* bloom B — behind the hero graphic */}
      <div className="aurora-b absolute right-[-16%] top-[22%] h-[720px] w-[820px] rounded-full opacity-80 blur-[130px]"
           style={{ background: "radial-gradient(closest-side, rgba(156,84,47,0.15), transparent 74%)" }} />

      {/* cool lift so the page does not end in a black hole */}
      <div className="absolute bottom-[-32%] left-[18%] h-[560px] w-[980px] rounded-full opacity-70 blur-[140px]"
           style={{ background: "radial-gradient(closest-side, rgba(133,136,139,0.09), transparent 76%)" }} />

      {/* diagonal light sweep */}
      <div className="absolute inset-0" style={{ background:
        "linear-gradient(112deg, transparent 26%, rgba(231,137,60,0.055) 46%, rgba(250,248,244,0.02) 52%, transparent 68%)" }} />

      {/* grain + vignette (same values as the app version) */}
      <div className="absolute inset-0 opacity-[0.05] mix-blend-soft-light" style={{ backgroundImage: GRAIN_URL }} />
      <div className="absolute inset-0 bg-[radial-gradient(125%_100%_at_50%_-6%,transparent_36%,rgba(9,10,12,0.36)_82%,rgba(8,9,11,0.5)_100%)]" />
    </div>
  );
}
```

```css
@keyframes aurora-drift-a { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(2.5%,-2%,0) scale(1.06); } }
@keyframes aurora-drift-b { 0%,100% { transform: translate3d(0,0,0) scale(1.04); } 50% { transform: translate3d(-2%,2.5%,0) scale(1); } }
.aurora-a { animation: aurora-drift-a 34s ease-in-out infinite; will-change: transform; }
.aurora-b { animation: aurora-drift-b 46s ease-in-out infinite; will-change: transform; }
@media (prefers-reduced-motion: reduce) { .aurora-a, .aurora-b { animation: none; } }
```

Measured on a 1440×900 canvas with the UI hidden: top-left warm `(38,30,28)`, right `(26,26,32)`,
centre `(26,23,26)`, bottom `(12,13,16)`; the headline sits over `(43,35,32)` and warm-white text keeps
its contrast. Drift proof: `getComputedStyle('.aurora-a').transform` differs across a 2 s sleep
(`translate 0.75px → 3.98px`).

## Calibration (what actually reads on screen)

- Grid: 1 px lines at **7.5 %** white on a `#17-1F` base land at ~+11 RGB units at DPR 2. At 5.5 %
they antialias into the grain and are invisible; above ~14 % the grid becomes a texture the user
notices as "patterned".
- Blooms: two, opposite corners, 10-12 % alpha, `blur-[130px]`. One bloom alone reads as a smudge;
  two give a light direction.
- Vertical wash: ~9 RGB units of falloff from top to bottom is enough to feel lit.
- Grain: `mix-blend-soft-light` at 5 %, one 160 px tile.
- Vignette: max 0.34 alpha at the corners, otherwise the top bar goes muddy.

## Verification (do this, screenshots alone lie)

1. Hide the UI so you sample the backdrop, not a card:
   `document.querySelectorAll('main, aside, header, footer').forEach(e => e.style.visibility='hidden')`.
2. Screenshot + PIL sample a vertical column and a horizontal row. Expect top-to-bottom falloff of
   ~8-10 units and two warm corners.
3. Grid check: with `background-position: center top`, the 1 px lines sit at `center ± k·tile`
   (e.g. 715, 795, 875 for an 1430 px box at 80 px). Sampling at a fixed 100 px step misses them and
   makes you think the layer is dead. Scan a contiguous 200 px row and look for periodic +8-11 spikes.
4. Measure at `deviceScaleFactor: 2` — at DPR 1 a 1 px line is antialiased to roughly half alpha and
   reads ~+5, which is indistinguishable from grain noise.
5. Contrast after: `ash` on the sidebar must stay ≥ 4.5:1 (measured 5.07:1 with the recipe above).

## Pitfalls

- **A `bg-*` on the page-root wrapper hides the whole stack.** A negative-z child paints above the
  canvas but *below* its ancestor's block background, so `<div className="min-h-screen bg-charcoal">`
  swallows a `fixed inset-0 -z-10` backdrop completely — every sampled pixel comes back `(24,25,27)`
  while `getComputedStyle` still reports the gradients and the layer count looks right. Remove the
  wrapper's background (the body already paints it) and keep `relative` on the wrapper.
- `bg-[linear-gradient(...)]/95` is **invalid** — the opacity modifier cannot attach to an arbitrary
  gradient and Tailwind silently drops the whole class, leaving `background-image: none` (fully
  transparent sidebar). Put alpha in the stops: `rgba(23,24,28,0.93)`.
- Changing the surface he did not name is scope creep and gets reverted: "maksudku landing bukan
  dashboard, tapi yang di dashboard biarin aja gitu". Restore the untouched surface to its pre-change
  state in the same pass (component deleted, shell `bg-charcoal` back, sidebar solid) and say so, then
  re-propose on the surface he actually meant.
- Animate **transform only**, on layers that are already blurred (compositor work, 34-46 s loops).
  Never animate `blur()`/`filter` radius, never attach a scroll listener: animated filters re-blur the
  viewport every frame and show up as jank.
