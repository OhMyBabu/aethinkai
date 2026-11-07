# Publishing / sharing a local frontend build

"How do other people see this?" — the answer is usually Cloudflare, and it can be live in a minute without
touching the router.

## Quick tunnel (share now)

```bash
# 1. binary
curl -fsSL -o /usr/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /usr/local/bin/cloudflared

# 2. serve the production build (SPA fallback included by `vite preview`)
npm run build
nohup npm run preview -- --host 0.0.0.0 --port 4173 >/tmp/preview.log 2>&1 &

# 3. outbound-only tunnel, no port forwarding, TLS at the edge
nohup cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4173 >/tmp/tunnel.log 2>&1 &
grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tunnel.log | head -1
```

Use `templates/share-cloudflare.sh` instead of retyping this.

## Vite answers 403 to the tunnel host

Vite rejects unknown `Host` headers; the tunnel forwards its own hostname:

```
Blocked request. This host ("xxx.trycloudflare.com") is not allowed.
To allow this host, add … to `preview.allowedHosts`
```

Set it in **both** blocks and restart the server — config changes are not hot-reloaded:

```ts
server:  { host: '0.0.0.0', port: 5173, allowedHosts: true },
preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
```

## Kill the right process

`pkill -f "vite preview"` matches the shell that is running the command and kills your own session
(SIGTERM, no output). Free the port by PID instead:

```bash
PID=$(ss -ltnp | awk '/:4173/ {match($0,/pid=([0-9]+)/,a); print a[1]}' | head -1)
[ -n "$PID" ] && kill "$PID"
```

## Verify through the edge, not on localhost

```bash
U=https://xxx.trycloudflare.com
curl -s -o /tmp/p.html -w '%{http_code} %{time_total}s\n' "$U/"
grep -o '<title>[^<]*</title>' /tmp/p.html          # real build, not a proxy error page
curl -s -o /dev/null -w '%{http_code}\n' "$U/app/overview"   # SPA deep link
```

Then load it in the browser tool, confirm the hero renders, a deep link resolves and the console is clean.
A 200 on `/` alone does not prove the hashed chunks load.

## Permanent hosting, ranked

| Option | URL | Needs | When |
| --- | --- | --- | --- |
| Cloudflare Pages (`npx wrangler pages deploy dist --project-name <app>`) | `<app>.pages.dev` + custom domain | Cloudflare login/token | static SPA, survives the VM, global CDN |
| Named tunnel (`cloudflared tunnel create/route dns/run`) | chosen subdomain | domain on Cloudflare | the VM itself must serve |
| Quick tunnel | random `trycloudflare.com` | — | review links; dies with the process/VM |

Say plainly that a quick tunnel URL is ephemeral and ask for exactly one of: a Cloudflare-managed domain or
a Pages-scoped API token. Do not promise permanence from a quick tunnel.
