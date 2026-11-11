# Dashboard user final polish (2026-11-11)

File: `frontend/src/pages/public/Portal.tsx`, `frontend/src/styles/globals.css`
(hover rule only). Backend, API, auth, pricing, RPM and invoice logic untouched.

## Density

| Panel | Empty | Populated |
|:--|--:|--:|
| Aktivitas API (content area) | 180px | 270px chart |
| Penggunaan Model | 140px | rows |
| Riwayat Request | 160px | table, internal scroll |

Dashed outline removed from empty panels; each is one small icon, one heading,
one line of copy. Panel heights measured on the live page: API 281, key 269,
models 210, requests 230. API key card is no longer stretched by the chart: the
grid uses `items-start` and the card owns its height. Rotate sits 16px under the
key information.

## Copy

- KPI: Saldo Kredit / Total Request / Token Terpakai / Batas Permintaan.
- Chart sub: "Biaya penggunaan API berdasarkan periode."
- Empty states: "Belum ada aktivitas API", "Belum ada penggunaan model",
  "Belum ada request tercatat", each with the reason and no fake data.
- Packages: descriptive Indonesian copy; Pro keeps the only accent CTA and the
  `Pilihan Praktis` badge.
- Rotate note shortened to two sentences.
- Footer: "Saldo dan statistik diperbarui berdasarkan data penggunaan akun Anda."

## Transactions

- 5 newest rows by default, `Lihat Semua Transaksi (n)` expands in place, no new
  endpoint, nothing hidden permanently.
- Row 60px: invoice ID and `Lihat Invoice` on the first line, date, package and
  amount on the second. Status badge keeps semantic colours; `granted` reads
  `Kredit Ditambahkan`.

## Money formatting

`idr(micro)` now renders sub-rupiah charges with two decimals only when the
fraction is real (`Rp 1,25`), and whole rupiah otherwise (`Rp 55.000`,
`Rp 26`). Top-up policy still uses `rp()` because it arrives as plain IDR.

## Motion and states

- Package hover written as `.aethink-package-card:hover` outside Tailwind's
  hover media wrapper: `translate: 0 -3px`, border to `rgba(231,137,60,.5)` for
  Pro, 200ms.
- `prefers-reduced-motion: reduce` removes the translate and the transition.
- Focus ring stays 2px flame, Tab order verified.

## Verification

- `tsc -b` clean, build and deploy OK.
- Overflow false at 320, 390, 768, 1440.
- Refresh, package CTA, top-up CTA, input and preset chips measure 44px.
- Empty state: 5 transaction rows by default, toggle expands to all.
- Populated state rendered with a temporary `window.fetch` stub injected through
  CDP `Page.addScriptToEvaluateOnNewDocument` for `/api/portal/requests`,
  `/usage`, `/models` only. Production data files untouched, stub removed after
  the screenshot. Result: 30 bars at 270px, 6 request rows, 2 model rows,
  sub-rupiah costs `Rp 1,25`.
- Hover probed with CDP mouse move: `translate: 0px -3px`, border
  `rgba(231, 137, 60, 0.5)`, `transition-duration: 0.2s`.
