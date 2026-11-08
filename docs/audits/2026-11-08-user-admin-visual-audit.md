# Audit visual — user & admin (2026-11-08)

Scope: 19 halaman terautentikasi (6 user, 13 admin) + /portal + /admin/login.
Metode: screenshot 1440 & 390, audit DOM (overflow, tap target, ukuran font, duplikasi h1),
lalu perbaikan di layer bersama supaya semua halaman ikut.

## Layer bersama (berlaku ke semua halaman)

| Objek | Sebelum | Sesudah |
|---|---|---|
| Topbar | input "Search anything…" yang tidak terhubung ke apa pun; judul halaman dobel di desktop | search mati dihapus; judul hanya tampil < lg, h1 jadi satu-satunya judul |
| PageHeader | label eyebrow "ADMIN/WORKSPACE" + garis gradien, mengulang breadcrumb | eyebrow dihapus, h1 26/30 px, deskripsi 13.5 px |
| StatCard | garis gradien bawah + "vs previous period" walau tanpa delta | garis bawah dihapus, label 10.5/0.14em, nilai 24/28 px, deltaLabel hanya saat ada delta/hint |
| Button secondary | terlalu redup | bg warm/8%, border ash/22, hover warm/12 |
| Field / SearchInput | bg #141518, border ash/25 | bg #101113 / #141416, border ash/18 |
| DataTable | angka rupiah wrap dua baris | sel saldo `whitespace-nowrap` |
| Chart legend | Requests vs Tokens sama-sama oranye | seri kedua #B4B6B9 |
| DateRangeTabs | tab aktif solid oranye, bersaing dengan CTA | tint flame/14 + inset ring |

## Per halaman

| Halaman | Temuan | Tindakan |
|---|---|---|
| /admin/overview | CTA "+ Add user" dua kali (header + kartu revenue); judul "Admin overview" | CTA dalam kartu dihapus, h1 "Overview", kartu revenue radius 18 + gradien diturunkan |
| /admin/access | header buatan sendiri (eyebrow "Access control", h1 22 px), 4 kartu stat manual, chip RPM 24 px | pakai PageHeader + StatCard, h1 "Access & keys", chip RPM 32 px & 11.5 px |
| /admin/users | saldo pecah dua baris | nowrap |
| /admin/models | judul "Katalog & Harga" vs h1 "Katalog & harga" | topbar mengikuti h1 |
| /admin/pricing | judul "Packages & Pricing" vs h1 "Paket & RPM" | topbar mengikuti h1 |
| /admin/bansos | "Salurkan" dan "Program" sama-sama secondary | Salurkan jadi primary |
| /admin/monitor, model-live, routing, fallbacks, usage, settings, api-keys | casing judul tidak seragam | disamakan ke sentence case |
| /app/overview | glow kartu saldo pekat, tab rentang solid oranye | glow & gradien diturunkan, tab jadi tint |
| /app/models | kartu Claude diberi tag "DeepSeek" (fallback hardcoded), konteks "1000K" vs "1M" | provider dari id/brand (Anthropic, Gateway), konteks pakai formatCompact |
| /app/billing | chip "Credit balance" ganda, label stat 9.5 px | chip dihapus, Refresh jadi secondary, label 10.5 px |
| /app/api-keys | field pencarian menyatu dengan kartu | bg #101113 |
| /portal | copy informal ("nggak", "kedetect", "lu") + paragraf mengulang | copy profesional, ringkas |

## Verifikasi

- 1440 & 390: tidak ada overflow horizontal di 19 halaman.
- Tidak ada teks < 10 px; tombol/tautan < 36 px: 0 di halaman user.
- /app/models: Claude Fable 5 → tag `Anthropic`, konteks `1M context`.
- Suite: access 40/40, link 32/32, payments 9/9, adversarial 20/20; audit landing IN SYNC; healthcheck HEALTHY.
