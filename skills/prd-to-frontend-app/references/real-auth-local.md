# Demo frontend → real client-side auth

Trigger: the user says the build must stop being a demo ("jangan pake demo, beneran jalanin frontend-nya"),
backend deferred. Result: a frontend that signs users in, remembers them and guards routes — with
provider/billing calls still unimplemented.

## 1. Copy sweep before any code

```bash
cd <project> && grep -rn -iE 'demo|simulat|illustrat|fixture|mock' src index.html README.md | wc -l   # → 0
```

Sweep toasts, table captions, empty states, footers, activity text, `/demo-login` routes and seed data
(`aeth_demo_` key prefixes, `@demo.` emails, `demo/model-id`). Bulk-rename identifiers first
(`DemoState` → `AppState`, `resetDemo` → `resetWorkspace`), then fix copy per page — the rename alone leaves
"Demo Mode — simulated data" in the topbar.

## 2. Data model + storage

`User` gains `role: 'user' | 'admin'`, `passwordHash: string`, `salt: string`. Bump the persisted store
version: the key change logs every returning browser out (say so in the hand-off); old payloads must fall
back to fixtures rather than hydrate users without hashes.

## 3. `src/lib/auth.ts`

```ts
const ITERATIONS = 120_000;
makeSalt()                                      // 16 random bytes → hex
export async function hashPassword(pw, salt) {  // PBKDF2-SHA256 via crypto.subtle.deriveBits
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, baseKey, 256);
  return toHex(bits);
}
verifyPassword(pw, salt, expected)              // hash, then constant-time compare
isValidEmail / passwordChecks / passwordScore   // length ≥ 8, upper, number, symbol
```

`crypto.subtle` needs a secure context: `localhost` and an HTTPS tunnel qualify, plain `http://<lan-ip>` does
not — keep a deterministic fallback hash for that case instead of throwing.

## 4. Seed accounts must be pre-computed

The browser can only verify a digest, so compute seed digests offline with **identical** parameters and pin
the salt next to the hash:

```python
import hashlib
hashlib.pbkdf2_hmac("sha256", b"<password>", b"<salt>", 120000, 32).hex()
```

- One fixed salt per seeded account, stored in the fixture row.
- Analytics-filler users get `passwordHash: ""` — they populate tables but cannot sign in.
- Verify by actually signing in: a parameter mismatch (iterations, salt encoding, `salt:pw` vs `pw+salt`) is
  invisible until the login fails.

## 5. Store actions

`authenticate(userId)` sets `role` + `currentUserId` from the account. `signUp(user, welcomeCredits)`
prepends the user, appends a welcome ledger entry and activity row, and authenticates in one dispatch.
`updatePassword`. `logout` clears both fields. Guards live in the router:

- no session → `/login` with `state.next = location.pathname`
- role mismatch → the caller's own dashboard (admin → `/admin/overview`, customer → `/app/overview`)

## 6. Pages

`/login`: email + password, show/hide toggle, inline error, one generic "Email or password is incorrect"
(never reveal which field), 5 failures → 15 s lock with countdown, suspended account refused after a correct
password. `/signup`: name, email, password + strength meter (4 checks), confirm, terms checkbox, duplicate
email rejected before hashing, then hash → dispatch → land on the dashboard with credits visible.

Topbar gets an account menu (initials, email, role/plan pill, Settings, Sign out); delete the old role-picker
route, the "Demo Mode" pill and the banner.

## 7. Admin-created users need credentials

Generate a temp password (`Aeth-<8 alnum>!`), hash it, dispatch, then show it **once** in a modal with a copy
button. Prove the account works by signing out and signing back in with it — otherwise "Add user" produces
rows nobody can log in as.

## 8. Reset semantics

`case "reset"`: rebuild the baseline, then keep the session only if `fixture.users` still contains
`currentUserId`; keep `prefs`. A sign-up user disappears on reset and is correctly bounced to `/login`; a
seeded admin stays signed in.

## 9. Verification matrix (measured, not assumed)

| Probe | Expected |
|---|---|
| wrong password | inline error, no navigation |
| correct password, customer | `/app/overview`, plan + credits rendered |
| correct password, admin | `/admin/overview` |
| reload on a deep route | session persists |
| customer → `/admin/*` | redirect `/app/overview` |
| admin → `/app/*` | redirect `/admin/overview` |
| sign out, then guarded route | `/login` |
| weak password / mismatch / duplicate email | each a distinct inline error |
| sign-up success | dashboard + welcome credits |
| admin invite → login with temp password | dashboard, correct email in sidebar |
| mobile 390 px on `/login`, `/signup` | `scrollWidth - innerWidth === 0` |
| console | 0 errors |

## Pitfalls

- React controlled inputs ignore a plain `el.value = …` + `input` event; use the prototype `value` setter,
  then dispatch (`change` too for selects). Otherwise every probe reports "Enter your full name" while the
  field is visibly filled.
- Never describe auth as working without a login probe: hash parameter drift passes code review and only
  surfaces at sign-in.
- `passwordHash: ""` on managed rows is deliberate — do not "fix" it by hashing a random string, or those
  accounts become guessable inventory.
- Resetting logs out accounts that no longer exist; the toast should say the baseline was restored.
