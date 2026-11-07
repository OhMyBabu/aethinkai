# 9Router (v0.5.x) — local install and integration

## Package layout

```
<npm-global>/9router/
├── cli.js              # launcher (tray/TUI modes)
├── app/
│   ├── server.js       # ← run this
│   ├── custom-server.js
│   ├── .next-cli-build # prebuilt Next output (npm ships dot-dirs)
│   ├── src/{lib,sse,mitm,shared}
│   └── node_modules    # 500-700 MB after install; required by server.js
└── hooks/postinstall.js   # warms sqlite + tray deps into ~/.9router/runtime
```

`~/.9router/` holds `db/data.sqlite` (driver `node:sqlite`), `model-catalog.json`,
`jwt-secret`, `machine-id`.

## Run headless

```bash
A=$(npm root -g)/9router/app
cd "$A"
export PORT=20128 HOSTNAME=0.0.0.0 NODE_ENV=production
pm2 start server.js --name 9router --cwd "$A" --update-env
ss -ltnp | grep 20128
curl -s -o /dev/null -w '%{http_code}\n' http://<lan-ip>:20128/api/health
pm2 save && pm2 startup systemd -u root --hp /root
```

Why not the CLI: `9router --skip-update` on a non-TTY stdin flips to **tray mode**
(`if (skipUpdate && !trayMode && !process.stdin.isTTY) trayMode = true`), prints
"Router is now running in system tray", and exits — systray needs a display, so nothing listens.

`npm run build` inside `app/` fails: the published tarball has no `app/`/`pages/` routes, only
`.next-cli-build`. Delete any `.next` a failed build creates.

## Dashboard auth

Login handler logic (route `app/api/auth/login`):

```
storedHash ? bcrypt.compare(password, storedHash)
           : password === (process.env.INITIAL_PASSWORD || "123456")
blockIf = !storedHash && !INITIAL_PASSWORD && !isLocalRequest   // 403 mustChangePassword
```

So remote/LAN login needs `INITIAL_PASSWORD` set:

```bash
export INITIAL_PASSWORD='<password>'
pm2 restart 9router --update-env && pm2 save
curl -s -X POST http://<lan-ip>:20128/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"<password>"}'
# {"success":true,"mustChangePassword":false}  + auth_token cookie
```

Changing the password in `/dashboard/profile` writes a bcrypt hash into settings; the env is then
unused (`hasPassword:true`). Cookie: `auth_token`, HS256 JWT, 24h, from `JWT_SECRET` or
`~/.9router/jwt-secret`.

## API credential (the masked-key problem)

`SELECT * FROM apiKeys` returns masked values (`sk-194...216e`); the UI and the create-key response
mask them too. Key auth therefore cannot be reconstructed, and crafted keys of the same shape 401.

Use peer auth on loopback instead:

```bash
TOK=$(openssl rand -hex 24); printf '%s' "$TOK" > /root/services/.9router-peer; chmod 600 $_
export NINEROUTER_PEER_TOKEN="$TOK"    # server side, then pm2 restart --update-env
```

Client request headers:

```
x-9r-peer-token: $TOK
x-9r-real-ip: 127.0.0.1        # middleware checks the real client ip is local
```

Route-level key check is separate: turn it off for the local hop with
`PATCH /api/settings {"requireApiKey":false}` (cookie-authenticated). LAN callers without the peer
token still get `401 {"error":"API key required for remote API access"}` — middleware guards the hop.

## Endpoint map (cookie-authenticated unless noted)

| Endpoint | Use |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/status` | session |
| `GET /api/providers`, `POST /api/providers` | provider connections + status |
| `GET /api/models` | catalogue with caps and `fullModel` |
| `GET /api/pricing` | USD price card per provider/model (input/output/cached/reasoning) |
| `GET /api/usage/history` | aggregates: requests, tokens, cost, `byProvider/byModel/byApiKey` |
| `GET /api/keys`, `POST /api/keys` | keys (masked) |
| `GET/PATCH /api/settings` | `requireApiKey`, `requireLogin`, tunnel flags |
| `GET /api/health` | liveness only |
| `POST /v1/chat/completions`, `GET /v1/models` | data plane (peer token or real key) |

Dashboard routes: `/dashboard/providers/new`, `/dashboard/combos`, `/dashboard/endpoint`,
`/dashboard/usage`, `/dashboard/basic-chat`, `/dashboard/settings/pricing`.

## Smoke test

```bash
M=$(curl -s -H "x-9r-peer-token: $TOK" -H 'x-9r-real-ip: 127.0.0.1' \
     http://127.0.0.1:20128/v1/models | jq -r '.data[0].id')
curl -s -X POST http://127.0.0.1:20128/v1/chat/completions \
  -H "x-9r-peer-token: $TOK" -H 'x-9r-real-ip: 127.0.0.1' -H 'Content-Type: application/json' \
  -d "{\"model\":\"$M\",\"messages\":[{\"role\":\"user\",\"content\":\"say pong\"}],\"max_tokens\":8}"
```

Success returns `choices[0].message.content` plus `usage.prompt_tokens/completion_tokens` — the numbers
your metering will bill from.

## Response shape (breaks naive JSON parsing)

`/v1/chat/completions` answers with `Content-Type: text/event-stream` **even when the request has
`stream:false`**, and the body is a full JSON completion followed by `data: [DONE]`:

```
{"id":"msg_...","object":"chat.completion","choices":[...],"usage":{...}}\n\ndata: [DONE]\n\n
```

`json.loads(body)` therefore raises `Extra data: line 1 column N`. Parse tolerantly in the proxy:

```python
text = body.decode("utf-8", "ignore").strip()
if text.startswith("{"):
    obj, _ = json.JSONDecoder().raw_decode(text)   # stops after the first object
    return obj
if b"data:" in body:
    return aggregate_sse(body)                      # pure stream: concat deltas, take last usage
```

Real streaming sends deltas with `choices[].delta.content` and emits `usage` only in the final chunk before
`[DONE]` — aggregate content and keep the last non-empty `usage`, or your counters bill zero.

## Failure modes seen in practice

| Symptom | Meaning |
|---|---|
| `503` + `[..provider/model] [403]: ...account has been frozen... (reset after Ns)` | Provider account/billing issue; upstream marks the connection in cooldown. Fix the provider, not the proxy |
| `401 {"error":"API key required for remote API access"}` | Middleware rejected the hop: missing/incorrect `x-9r-peer-token` or `x-9r-real-ip` not local |
| `401 Missing API key` on `/v1/chat/completions` while `/v1/models` is 200 | Route-level `requireApiKey` still on; `PATCH /api/settings {"requireApiKey":false}` |
| Model appears in `/v1/models` but `/api/pricing` has no entry | Price card only lists providers with a configured cost source; served ids are namespaced `provider/model`, so key your price table on the exact served id |

## Ops

```bash
pm2 list ; pm2 logs 9router --lines 50 ; pm2 restart 9router --update-env ; pm2 save
pm2 env 0 | grep -E 'INITIAL_PASSWORD|NINEROUTER_PEER_TOKEN|PORT|HOSTNAME'
```

Guard: the dashboard binds `0.0.0.0` for LAN access; keep the data plane private to loopback and never
tunnel port 20128 to the internet — tunnel your own gateway instead.
