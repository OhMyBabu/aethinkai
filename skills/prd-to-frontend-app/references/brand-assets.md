# Brand identity swap (supplied logo → app icons)

Use when the user drops a logo/app-icon image and says variants of "replace <brand> with this, favicon included".
The job is asset plumbing plus one component, not a redraw.

## Rules

1. **Ship the supplied artwork verbatim.** No SVG retrace, no "cleaner" redraw. The user picked that exact
tile; a hand-traced approximation is a fidelity regression, and every detail (bevel, gradient, sparkle) is
something they can see and you cannot reliably reproduce.
2. **Never key out a dark tile to fake transparency.** `alpha = max(r,g,b)` on an icon with a glow/reflection
picks up the halo as opaque pixels and leaves stray arcs and a noise row along the edges. If a transparent
mark is genuinely needed, ask for a transparent source; otherwise render the tile with a proportional
corner radius and move on.
3. **Derive the whole icon set from the one source**, never from the old hand-drawn favicon:
   square crops at 16 / 32 / 180 (apple-touch) / 192 / 512, plus `manifest.webmanifest` (name, start_url,
   theme/background = app charcoal, all four icon entries) and `og:image` → `icon-512.png`.
4. **Delete the previous favicon and its `<link>`**, then prove the built HTML no longer mentions it.
5. **Optimise before committing**: a 1254 px source is ~1.4 MB; the component copy should be 256 px
   (~30 KB PNG) and the 512 icon ~200 KB. Resize with PIL `LANCZOS` + `optimize=True`.

## Component shape

```tsx
export function BrandLogo({ size = 32 }: { size?: number }) {
  return (
    <img src="/brand/brand-icon-256.png" alt="" aria-hidden draggable={false}
      width={size} height={size}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} />
  );
}
```

Keep the `size` prop — nav (30), hub (34), 404 (44), drawer (26) all call the same component, so one change
must reach every surface. Do not carry `text-*` colour classes over from an SVG-era logo: an `<img>` ignores
them and the prop becomes dead weight.

## Verification (no eyes required)

```bash
# built HTML must reference the new set and nothing old
python3 - <<'EOF'
import urllib.request, re
html = urllib.request.urlopen(BASE, timeout=20).read().decode()
print([l for l in re.findall(r'<link[^>]+>', html) if any(k in l for k in ('icon', 'manifest'))])
print('old svg favicon present:', 'favicon.svg' in html)
EOF
```

- Fetch every asset over the **public** URL and assert `200` + `image/png` + sane byte size. A stale
  `dist/` or preview process can hide a correct `public/` tree.
- In the browser: `img.naturalWidth` is the asset size (256), rendered box matches `size`, radius > 0.
- Pixel-sample a crop of the rendered icon: both white and orange counts must be non-zero (proves the mark
  painted, not a broken src). At 2× DPR crop `x*2 … (x+w)*2` from the screenshot.
- `vision_analyze` may report "background appears black" on a transparent PNG — that is the viewer's matte.
  Check alpha with PIL (`im.getpixel((0,0))[3] == 0`) instead of trusting that remark.

## Pitfalls

- Favicons are cached aggressively by the browser; after shipping, tell the user to hard-refresh and give a
  cache-busting query on the URL, otherwise they will report the old icon as still live.
- A detailed mark loses legibility at 16 px. That is acceptable — do **not** silently substitute a simplified
glyph at small sizes; the identity must stay consistent across tab, nav and home screen.
- If the source has non-square padding, crop to `getbbox()` first, then pad symmetrically, or the mark sits
  off-centre inside the favicon at every size.
