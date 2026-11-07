# Hero code-quickstart panel (terminal in the hero)

When a gateway/API product's hero right column should show *how to call it* instead of a dashboard mock:
a terminal card with language tabs and a response bar. Build it as a component, never an image.

## Anatomy

```
title bar   ● ● ●   aethinkai — quickstart        [ cURL | Python | Node.js ]   role=tablist
file strip  bash · slide 1/3                                            Copy
body        numbered lines, palette-only syntax colours, blinking prompt caret
response    200 OK · 1.2s · chatcmpl_demo_01
            { "model": "…", "usage": { "in": 96, "out": 214 } }
footer      Demo key — not valid for API requests        Open demo dashboard →
```

## Implementation notes

- **Snippets are data, not JSX.** One array per language: `{ id, label, filename, lines: string[] }`, rendered
  line by line. Adding a language must be a data edit.
- **Do not add a syntax-highlighting dependency.** A ~30-line tokenizer is enough: regex over
  `("[^"]*"|'[^']*'|`[^`]*`|\b\d+\b|[A-Za-z_$][\w$]*|\s+|.)`, then map token kind → class. Only palette
  hues: keyword/accent = flame, string = warm white, number = accent/80, comment = gray, punctuation =
  gray/70, identifier = a light tint of accent. Brand-neutral, no blue/purple, no rainbow.
- **Line numbers** as a separate `aria-hidden` span with fixed width; the code block is `overflow-x-auto` so
  long lines scroll inside the card and the page never scrolls sideways at 390 px.
- **Fixed min-height** on the body (`min-h-[248px]`) so switching between a 7-line and a 12-line snippet does
  not jump the hero.
- **Auto-advance** every 6–7 s via `setInterval` in an effect keyed on `[index, hovered, reduce]`; clear on
  cleanup. Pause while the pointer is inside or focus is captured. Skip entirely when `prefers-reduced-motion`
  or the in-app reduced-motion pref is on — a rotating panel is motion.
- **Tab click wins**: selecting a language sets the index and resets the timer (the effect re-runs on index).
- **Keys stay masked** (`sk-•••`) with an explicit "Demo key — not valid for API requests" line in the footer.
- **Base URL comes from env**, not a literal from the user's example: `import.meta.env.VITE_GATEWAY_BASE_URL`
  with the product's own host as the default, plus a committed `.env.example` and `vite-env.d.ts` typings.
- **Copy** button: `navigator.clipboard.writeText` then a hidden `textarea` + `document.execCommand('copy')`
  fallback; toast either way. Script-issued `.click()` is untrusted, so a passing copy test needs CDP
  `Input.dispatchMouseEvent` (mousePressed + mouseReleased at the button centre).

## Verify

```js
// tab switching changes the first line of code and the filename strip
// wait ~7 s without hover: slide index increments (frozen when reduced motion is on)
// palette check: no computed colour with b > r + 25 in the token spans
// desktop: pre.scrollWidth === pre.parentElement.clientWidth; mobile: page overflow 0
```

`document.body.innerText` should contain `200 OK`, the latency, and the demo-key disclaimer — that is the
cheapest proof the response bar and footer actually rendered.
