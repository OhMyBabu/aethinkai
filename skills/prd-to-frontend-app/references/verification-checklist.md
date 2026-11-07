# Verification checklist (browser + pixels)

Run these through the browser tool. Every claim in the delivery report must map to one of them.

## 1. Route sweep, both widths

```python
for path in routes:
    goto_url(BASE + path); wait_for_load(); time.sleep(0.7)
    print(path, js("location.pathname"), js("document.querySelector('h1')?.innerText"),
          js("document.documentElement.scrollWidth-innerWidth"))
```

- Guarded routes: enter the role first through the UI, otherwise everything lands on the login route and
the sweep proves nothing.
- Expect `scrollWidth - innerWidth <= 0` at 1440 px and 390 px (`-10` is just the scrollbar).

## 2. Find the overflow offender (don’t guess)

```js
[...document.querySelectorAll('*')]
  .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
  .map(e => e.tagName + ':' + String(e.className).slice(0, 60))
```

Invisible absolute elements (closed tooltips, off-canvas panels) count. Render them conditionally instead
of toggling `visibility/opacity`.

## 3. Console errors

```js
window.__errs = [];
window.addEventListener('error', e => window.__errs.push(e.message));
window.addEventListener('unhandledrejection', e => window.__errs.push('rej:' + e.reason));
```

Install the hook, then navigate every route; report `[]` only after the sweep.

## 4. Geometry without eyes

```js
const b = el => { const r = el.getBoundingClientRect();
  return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          right: Math.round(r.right), bottom: Math.round(r.bottom)}; };
```

- Clearance: `hub.x - chip.right > 0` (aim ≥ 40 px).
- Card rhythm: `cards[i+1].y - cards[i].bottom` ≈ 30 px.
- Overlap test: `!(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)`.

## 5. Animation actually running

```js
// strokes finished
[...document.querySelectorAll('.nexus-route')].every(p => getComputedStyle(p).strokeDashoffset === '0px')
// packets move: sample the same element twice, positions must differ
// reveal wrappers: min opacity across [data-reveal] must reach 1 after scroll
```

## 6. Pixel proof (PIL) when screenshot analysis is unavailable

```python
from PIL import Image
im = Image.open(shot).convert("RGB")
hits = sum(1 for x in range(862, 909) for y in range(316, 352)
           if (lambda r, g, b: r > 100 and r > g > b and r - b > 35)(*im.getpixel((x, y))))
# hits > 0 proves the connector is painted inside the gap band
```

- Mean brightness of a card row vs a gap row proves spacing/contrast.
- Hue scan for forbidden colours: flag saturated pixels with hue 160–300° (cyan/blue/purple).

## 7. Screenshots for the user

`cdp("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)`
for desktop, `width=390, height=844, deviceScaleFactor=2, mobile=True` for mobile, then
`capture_screenshot()` + copy into `<project>/screenshots/`. Send with `MEDIA:/abs/path`.

## 8. Acceptance flows (each must mutate observable state)

1. Create key → reveal dialog → **reload** → masked key still listed.
2. Top-up → balance changes → new ledger row → toast shown.
3. Filter range/model → chart data-point count **and** table rows change.
4. Admin edit (model/package) → user-side page reflects it.
5. CSV export → hook `HTMLAnchorElement.prototype.click` to capture the filename.
6. Typed-confirm reset → fixtures restored, session preserved.
7. Reduced-motion toggle → packets hidden, strokes complete, content readable.
