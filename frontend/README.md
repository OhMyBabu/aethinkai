# AethinkAI Gateway — Frontend

Production-facing frontend for **AethinkAI Gateway**: marketing site, customer workspace and admin console.
Frontend is complete and self-contained; the gateway API (routing, billing, 9Router) connects later.

- Stack: Vite 7 · React 19 · TypeScript · Tailwind CSS 4 · React Router 7 · Motion for React · Recharts · Lucide · GSAP
- State: typed store (`src/data/store.tsx`) persisted to `localStorage` under `aethinkai-app-v1`
- Palette: `#18191B` `#FAF8F4` `#85888B` `#9C542F` `#E7893C`

---

## Run

```bash
npm install
npm run dev -- --host 0.0.0.0        # http://localhost:5173
npm run build                        # tsc -b && vite build -> dist/
npm run preview -- --host 0.0.0.0    # http://localhost:4173
./share.sh                           # preview + Cloudflare quick tunnel
```

---

## Accounts

Sign-in is real inside the browser: PBKDF2-SHA256 (120k iterations, per-account salt) via Web Crypto,
session persisted per device, route guards by role.

| Role | Email | Password | Landing route |
| --- | --- | --- | --- |
| Admin | `admin@aethink.ai` | `Aethink#2026` | `/admin/overview` |
| Customer | `alya@aethink.ai` | `Aethink#2026` | `/app/overview` |

`/signup` creates a real account with Rp 25.000 starting credits. Password policy: 8+ chars
(strength meter shows uppercase/number/symbol checks). Five failed sign-ins lock the form for 15 seconds.
Suspended accounts are refused at sign-in.

Seeded rows in the admin table have no password (`passwordHash: ""`) — they exist to populate analytics
until the backend provisions them.

---

## Routes

| Area | Route | Screen |
| --- | --- | --- |
| Public | `/` | Landing — Signal Nexus hero, terminal quickstart, catalogue, pricing |
| Public | `/login` | Sign in |
| Public | `/signup` | Create workspace |
| User | `/app/overview` | KPIs, traffic chart, recent requests |
| User | `/app/models` | Catalogue, detail drawer, playground |
| User | `/app/api-keys` | Create → reveal once → rename → revoke |
| User | `/app/usage` | 7/30/90 ranges, model + key filters, CSV export |
| User | `/app/billing` | Balance, packages, ledger, top-up |
| User | `/app/settings` | Profile, security, motion, reset, sign out |
| Admin | `/admin/overview` | KPIs, traffic, activity, model status board |
| Admin | `/admin/users` | Search/filter/sort, add, edit, suspend, grant credits |
| Admin | `/admin/models` | Create/edit/delete/enable models (reflected for customers) |
| Admin | `/admin/pricing` | Credit packages (reflected on billing) |
| Admin | `/admin/api-keys` | All customer keys, filter, revoke |
| Admin | `/admin/usage` | Analytics, two chart modes, CSV export |
| Admin | `/admin/settings` | Brand board, preferences, reset |
| Utility | `*` | 404 |

`/app/*` requires an authenticated **customer**, `/admin/*` requires **admin**; wrong role redirects to the
caller's own workspace, no session redirects to `/login?next=…`.

---

## Data model

`src/types/index.ts` — `User` (role, credits, plan, passwordHash, salt), `AIModel` (12 routes across DeepSeek,
Qwen, GLM, Kimi), `ApiKey`, `UsageEntry` (620 deterministic requests over 90 days), `LedgerEntry`,
`CreditPackage`, `ActivityEntry`, `Preferences`.

Fixtures are seeded by a deterministic PRNG, so charts and tables never shift between reloads. Admin edits
(models, pricing, users, credits) mutate the same store and are reflected on customer pages immediately.
**Admin → Settings → Reset workspace data** restores the seeded baseline.

---

## Design system

- `src/styles/globals.css` — tokens, motion primitives, `prefers-reduced-motion` handling
- `src/components/landing/SignalNexus.tsx` — hub-and-spoke hero, GSAP DrawSVG lanes + MotionPath packets
- `src/components/landing/TerminalPreview.tsx` — cURL / Python / Node slides against `https://router.aethink.ai.id/v1`
- `src/components/brand/ModelLogo.tsx` — official DeepSeek, Qwen, GLM, Kimi marks (mono in hero, brand in catalogue)
- `src/components/layout/BrandLogo.tsx` — supplied app icon, also backing favicon + manifest icons

Responsive verified at 390 / 768 / 900 / 1024 / 1280 / 1440: no page overflow, sidebar becomes a drawer with
scroll lock, KPI cards 2×2 on phones, charts clamp to 200 px, tables scroll internally with a sticky first
column and swipe hint, modals render as bottom sheets, all controls have ≥36 px hit areas.

---

## Not wired yet (backend phase)

- `POST /v1/chat/completions` — routing to providers / 9Router
- Real key issuance + verification (`aeth_sk_*` values are generated client-side today)
- Metering, invoicing, payment gateway
- Email delivery (verification, password reset, receipts)
- Server-side RBAC, audit log, rate limiting

`src/lib/auth.ts` isolates hashing/validation so the switch to server sessions touches one file. The
provider, API-key middleware and billing models should move behind the gateway API.
