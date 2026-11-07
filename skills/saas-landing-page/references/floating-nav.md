# Floating nav + dropdowns (Tailwind v4, React/Motion)

Recipe for a premium minimal SaaS header: 72px sticky bar, flat nav items, floating popovers, one accent CTA.
All numbers below were measured on a real build.

## 1. Structure

```tsx
<header className="sticky top-0 z-40 border-b backdrop-blur-md"
        style={{ borderBottomColor: scrolled ? "rgba(58,59,61,0.7)" : "#2A2B2E" }}>
  <div className="mx-auto flex h-[72px] max-w-[1320px] items-center gap-4 px-4 sm:px-6">
    <Logo />
    <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">…</nav>
    <div className="ml-auto flex items-center gap-2"><CTA /></div>
  </div>
  <AnimatePresence>{open && <Panel />}</AnimatePresence>
</header>
```

- Full nav at `lg` (1024px); burger below. A 5-item centred nav over a wordmark starts colliding around
  900–1000px — gate it and re-measure rather than shrinking type.
- Secondary brand label (e.g. "Gateway") only at `xl`; it widens the logo box enough to collide on tablets.

## 2. Nav item

```
inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium
        transition-[background-color,color] duration-200
inactive: text-[#85888B] hover:bg-[#292B2E]/70 hover:text-[#FAF8F4]
active:   bg-[#292B2E] text-[#FAF8F4]  + accent icon #E7893C + chevron rotate-180
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
```

Dropdown triggers carry `aria-haspopup="true"` and `aria-expanded={open}`. Keep one open at a time: each
`onClick` closes the siblings; document-level `mousedown` (outside) and `keydown` Escape close everything.

## 3. Popover shell

```ts
const FLOATING = "absolute left-1/2 top-[54px] z-50 mt-2 -translate-x-1/2 rounded-xl border "
  + "bg-[#222325] shadow-[0_20px_48px_-20px_rgba(0,0,0,0.85)]";
const FLOATING_STYLE = { borderColor: "#3A3B3D" } as const;   // see pitfall 1
```

`top-[54px]` is the trigger bottom inside a 72px header (centre 36 + half of a 36px item); `mt-2` supplies the
8px gap. Motion preset: `initial {opacity:0,y:-6} animate {opacity:1,y:0} exit {opacity:0,y:-4}`,
`duration 0.18, ease [0.22,1,0.36,1]`. No spring and no blur filter on the panel — blur on a floating card reads
as glassmorphism.

## 3b. Panel content must not widen the panel

A wide popover hides a second clipping bug: grid children default to `min-width:auto`, so a long code line makes
the grid wider than the card and the far column renders outside the panel, cut off.

```
grid:  w-full min-w-0 gap-7 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]
child: min-w-0
pre:   w-full min-w-0 whitespace-pre-wrap break-words   (no overflow-x scroll for short snippets)
urls:  break-all instead of truncate
```

Height: give the card `max-h-[calc(100vh-4rem)]` (not `-7rem`) and check `scrollHeight === clientHeight` at
1024x720; a 3px overflow still reads as "cut off" in a screenshot. Probe every descendant: `rect.bottom >
panel.bottom` or `scrollWidth > clientWidth` = still clipped.

## 4. Pitfalls

**Global `* { border-color: … }` beats Tailwind utilities.** A reset outside `@layer base` is *unlayered*, and
unlayered author CSS wins over everything Tailwind emits in `@layer utilities`, so `border-[#3A3B3D]` renders as
the global tint. Fix locally with `style={{ borderColor: ... }}`; propose moving the reset into `@layer base`.
Confirm with `getComputedStyle(el).borderColor`, never by eye.

**AnimatePresence never finishes in a background/inactive tab.** `requestAnimationFrame` is throttled, so the
panel stalls at `opacity:0` and stays mounted. Symptom: a probe reports "Escape didn't close it" and screenshots
show an invisible panel. Before probing, `Page.bringToFront` +
`Emulation.setFocusEmulationEnabled {enabled:true}`; the same probe then passes. Do not change the component for this.

**`Page.captureScreenshot` at `scale: 2` on a tall viewport times out** through the browser daemon (5s). Capture
at `scale: 1` with an explicit clip, or use `capture_screenshot()`; keep measurement in a separate call.

## 5. Verification probe

```js
(() => {
  const p = document.querySelector('[aria-label=Documentation]');
  const trig = [...document.querySelectorAll('nav button')].find(b => b.innerText.trim() === 'Docs');
  const cs = getComputedStyle(p), r = p.getBoundingClientRect(), t = trig.getBoundingClientRect();
  return { gap: +(r.top - t.bottom).toFixed(1), bg: cs.backgroundColor, border: cs.borderColor,
           radius: cs.borderRadius, opacity: cs.opacity };
})()
```

Acceptance set: header 72–73px · gap 8–10px · radius 12px · border equals the intended hex · active item bg is
graphite · chevron rotates 180° · `scrollWidth <= innerWidth` at 390/834/1024/1280/1440 · no nav↔CTA/logo
collision wherever the nav is visible.
