# Secrets contract

Nothing in this list is committed. Create these on the new server, then start the services.

## Files on the old box (copy values through a secure channel, not through git)

| Path | Contents |
|---|---|
| `/root/.secrets/aethink-db.env` | `DATABASE_URL=postgresql://aethink:<pw>@127.0.0.1:5432/aethink` |
| `/root/.secrets/aethink-bot.env` | `BOT_TOKEN=…`, `AETHINK_ADMINS=<tg ids, comma>`, `AETHINK_GATEWAY=http://127.0.0.1:8080`, `AETHINK_INTERNAL_FILE=/path/to/internal secret`, `PORTAL_URL=https://<public origin>`, `STORE_TEST_MODE=0` |
| `/root/.secrets/aethink-internal` | the HMAC shared secret between bot and gateway (one line) |
| `gateway/.admin` | admin email + password hash pair used by `/api/auth/login` (created at bootstrap) |
| `gateway/.devkey` | local dev key for smoke tests |

## Environment used by the gateway

```
DATABASE_URL            required  Postgres DSN
INTERNAL_SECRET         required  same value as aethink-internal (bot HMAC)
JWT_SECRET              required  portal/auth token signing key
AETHINK_BOT_TOKEN       optional  bot token, needed for Mini App initData verification
AETHINK_BOT_ENV         optional  path to the bot env file (fallback for BOT_TOKEN)
AETHINK_MINIAPP_URL     optional  public HTTPS origin of the Mini App (no /tg suffix)
UPSTREAM_BASE           required  http://127.0.0.1:20128/v1 (9Router)
UPSTREAM_KEY            required  9Router key
USD_IDR                 optional  ledger conversion rate (default 16250)
```

## Environment used by the bot

```
BOT_TOKEN               required  from BotFather
AETHINK_ADMINS          required  comma-separated Telegram ids with admin panel access
AETHINK_GATEWAY         required  http://127.0.0.1:8080
AETHINK_INTERNAL_FILE   required  file holding the HMAC secret
PORTAL_URL              required  public web origin (used for buttons)
STORE_TEST_MODE         optional  "1" auto-grants orders (testing only, never production)
BOT_ENV_FILE            optional  env-file path when run under pm2/systemd
```

## Rules

- Rotate bot token and JWT_SECRET on migration; old tokens are in the old box's env files.
- The Mini App trusts `initData` signed with the bot token — after rotation, Mini App sessions
  issued before the rotation stay valid until their 12 h expiry.
- Never print secrets in logs, screenshots, reports, or git. `BOT_TOKEN` in a URL is enough for
  anyone to take over the bot.
