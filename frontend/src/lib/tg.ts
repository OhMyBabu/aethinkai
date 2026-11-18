/** Telegram Mini App client: initData session + portal reads. No secrets in localStorage. */

export type Buyer = { id: string; tg_id: number | null; username: string | null; name: string | null; status: string };
export type KeyRow = { id: string; prefix: string; label: string | null; rpm_limit: number; status: string; last_used_at: string | null; created_at?: string };
export type Me = {
  buyer: Buyer;
  key: KeyRow | null;
  balance_micro: number;
  lifetime: { requests: number; cost_micro: number; tokens_in: number; tokens_out: number; models_used: number };
  keys: KeyRow[];
};
export type UsageDay = { day: string; requests: number; tokens_in: number; tokens_out: number; tokens_cached: number; cost_micro: number };
export type Usage = {
  days: number;
  totals: { requests: number; tokens_in: number; tokens_out: number; cost_micro: number; avg_latency_ms: number; errors: number };
  daily: UsageDay[];
};
export type ModelUse = { model_id: string; requests: number; tokens_in: number; tokens_out: number; cost_micro: number; last_used_at: string | null };
export type CatalogModel = {
  id: string;
  display_name: string;
  provider: string;
  context_length: number | null;
  max_completion_tokens: number | null;
  capabilities: Record<string, boolean>;
  pricing_idr_per_1m: { input: number; output: number; cached_input: number };
};
export type Order = {
  id: string; sku: string; credits_micro: number; price_idr: number; status: string;
  created_at: string; granted_at: string | null;
};
export type Pkg = { sku: string; name: string; idr: number; rpm: number; blurb: string; credits_micro: number };

const TOKEN_KEY = "aethink-tg-token";
export const readToken = () => sessionStorage.getItem(TOKEN_KEY);
export const writeToken = (t: string) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

async function req<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export async function tgSession(initData: string) {
  return req<{ token: string; expires_at: string; buyer: Buyer }>("/api/tg/session", null, {
    method: "POST",
    body: JSON.stringify({ init_data: initData }),
  });
}

export const getMe = (t: string) => req<Me>("/api/portal/me", t);
export const getUsage = (t: string, days: number) => req<Usage>(`/api/portal/usage?days=${days}`, t);
export const getModelsUsed = (t: string, days: number) => req<{ models: ModelUse[] }>(`/api/portal/models?days=${days}`, t);
export const getCatalog = () => req<{ data: CatalogModel[] }>("/api/models", null);
export const getPackages = () => req<{ packages: Pkg[] }>("/api/packages", null);
export const getOrders = (t: string) => req<{ orders: Order[] }>("/api/portal/orders", t);
export const buy = (t: string, sku: string) =>
  req<{ order_id: string; price_idr: number; status: string }>("/api/portal/order", t, {
    method: "POST",
    body: JSON.stringify({ sku }),
  });
export const rotateKey = (t: string) =>
  req<{ api_key: string; rpm_limit: number }>("/api/portal/keys/rotate", t, { method: "POST" });

/** micro-IDR -> "Rp 24.999.823" */
export function idr(micro: number): string {
  const rp = Math.round((micro ?? 0) / 1_000_000);
  return "Rp " + rp.toLocaleString("id-ID");
}

/** per-1M price -> "Rp 96.5K" so a phone row never wraps the number. */
export function price1m(v: number): string {
  const n = Math.round(v ?? 0);
  if (n >= 1000) {
    const text = (n / 1000).toFixed(1).replace(/\.0$/, "");
    return `Rp ${text}K`;
  }
  return `Rp ${n}`;
}

export function compact(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function when(iso: string | null): string {
  if (!iso) return "belum dipakai";
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return "n/a";
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins}m lalu`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
}

export type TgWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme?: string;
  themeParams?: Record<string, string>;
  HapticFeedback?: { impactOccurred: (s: string) => void };
  openTelegramLink?: (url: string) => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
};

export function webApp(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp ?? null;
}

const SDK_URL = "https://telegram.org/js/telegram-web-app.js";
let sdkLoading: Promise<void> | null = null;

/** Only the mini app needs the SDK, so it is fetched on demand instead of blocking every page. */
function loadTelegramSdk(): Promise<void> {
  if (webApp()) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return sdkLoading;
}

/** Load the SDK, then give Telegram a moment to hand over initData before falling back. */
export async function waitForWebApp(timeoutMs = 1500): Promise<TgWebApp | null> {
  await Promise.race([loadTelegramSdk(), new Promise<void>((r) => setTimeout(r, 4000))]);
  const started = Date.now();
  for (;;) {
    const app = webApp();
    if (app && app.initData) return app;
    if (Date.now() - started > timeoutMs) return app;
    await new Promise((r) => setTimeout(r, 100));
  }
}
