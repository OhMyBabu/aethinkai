# Mini App — 9Remote pass (2026-11-09)

Scope: `frontend/src/pages/tg/MiniApp.tsx`, `frontend/src/lib/tg.ts`.
No backend, auth, routing or pricing changes.

## Problem
The Mini App still carried the pre-revision palette (`#232426` cards, `#383A3E`
borders) and a brown gradient wallet, so it did not match the landing page or the
user/admin dashboard that already use the `#0A0A0A` + grid + neutral card recipe.

## Changes
- Atmosphere: `AppAmbient` mounted behind the shell; root `pb-112px` keeps the
  last card 46px clear of the bottom nav at scroll end.
- Cards: `#232426 → #171717`, `#2B2D30 → #1E1E20`, `#383A3E → white/10`,
  `#1B1C1F → #141414`; wallet gradient replaced with a white radial highlight.
- Header: sticky glass (`bg-[#0A0A0A]/72 backdrop-blur-xl`, hairline border).
- Bottom nav: `/72 backdrop-blur-2xl` so the grid reads through it.
- Orange reserved for state: active tab, primary CTA, filter chip, status dot.
  Quick-action icons, "Lihat detail"/"Katalog" links and the account shortcut
  icons moved to `#C9CBCF`/`#A1A3A7`.
- Typography: greeting `Control center kamu.`; account eyebrows consistent.
- Prices: `idr()` → `Rp 50.000` (space), `price1m()` → `Rp 96.5K` compact so a
  phone row never wraps. Under Rp 1.000 stays `Rp 570`.
- Empty usage: sparkline shows "Belum ada request di periode ini" instead of a
  flat zero line.
- Copy: `terakhir dipakai: belum dipakai`, `aktif`, `dibayar`, `Saldo Rp 50.000`.

## Verification
- `tsc -b` clean, `npm run build` OK, deployed.
- 390×844: `scrollWidth > innerWidth` false on every tab.
- Models/Akun at scroll end: nav top 778, last card bottom 732 (gap 46–47px).
- Gate state (`/tg` without Telegram initData) keeps the dark card + single
  orange CTA; reads as the same product.
- Auth preview used a locally minted buyer token in `sessionStorage`; no
  credentials committed.
