export type GwUser = { id: string; email: string; role: "admin" | "customer" };

const TOKEN_KEY = "aethinkai-gw-token";
const USER_KEY = "aethinkai-gw-user";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionUser(): GwUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as GwUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: GwUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (auth && token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = body as { error?: { message?: string; code?: string } } | null;
    const message = err?.error?.message || `Request failed (${res.status})`;
    const failure = new Error(message) as Error & { code?: string; status?: number };
    failure.code = err?.error?.code;
    failure.status = res.status;
    throw failure;
  }
  return body as T;
}

export async function login(email: string, password: string, totp?: string) {
  const data = await request<{ token: string; user: GwUser }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }) },
    false,
  );
  setSession(data.token, data.user);
  return data;
}

export async function me() {
  return request<{ user: GwUser; balance_micro: number; balance_idr: number }>("/api/me");
}

export type GwModel = {
  model_id: string;
  public_id: string;
  provider_label: string | null;
  display_name: string;
  enabled: boolean;
  priced: boolean;
  price_in_idr: number;
  price_out_idr: number;
  price_cached_idr: number;
  requests_30d: number;
  revenue_micro_30d: number;
  cost_usd_in: number | null;
  cost_usd_out: number | null;
  margin_in_pct: number | null;
  availability?: "on" | "maintenance" | "off";
  context_window?: number | null;
  max_output?: number | null;
};

export async function adminModels() {
  return request<{ models: GwModel[]; count: number; priced: number }>("/api/admin/models");
}

export async function savePrice(
  modelId: string,
  body: {
    price_in_idr: number;
    price_out_idr: number;
    price_cached_idr: number;
    active: boolean;
    display_name?: string;
    public_id?: string;
    availability?: "on" | "maintenance" | "off";
  },
) {
  return request<{ model: GwModel }>(`/api/admin/models/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function keys() {
  return request<{ keys: Array<{ id: string; prefix: string; name: string; created_at: string; revoked_at: string | null }> }>(
    "/api/keys",
  );
}

export async function myUsage(days = 7) {
  return request<{
    days: number;
    total: { requests: number; cost_micro: number; tokens_in: number; tokens_out: number };
    by_day_model: Array<{ day: string; model_id: string; requests: number; tokens_in: number; tokens_out: number; cost_micro: number }>;
  }>(`/api/me/usage?days=${days}`);
}
export type PublicModel = {
  id: string;
  status?: "on" | "maintenance" | "off";
  display_name: string;
  provider: string;
  context_length: number;
  max_completion_tokens: number;
  capabilities: Record<string, boolean>;
  pricing_idr_per_1m: { input: number; output: number; cached_input: number };
};

/**
 * Live catalogue channel. The gateway emits `catalog` when a price, name, state or
 * route limit changes, so open tabs update without a reload or a re-login.
 */
export function apiStream(handlers: { catalog?: () => void; status?: () => void }): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return () => {};
  let es: EventSource | null = null;
  try {
    es = new EventSource("/api/stream");
    if (handlers.catalog) es.addEventListener("catalog", handlers.catalog);
    if (handlers.status) es.addEventListener("status", handlers.status);
  } catch {
    return () => {};
  }
  return () => es?.close();
}

export function catalogStream(onChange: () => void): () => void {
  return apiStream({ catalog: onChange });
}

export type GwPackage = {
  sku: string;
  name: string;
  blurb: string | null;
  price_idr: number;
  credits_micro: number;
  rpm_limit: number;
  kind: "plan" | "topup";
  active: boolean;
  sort: number;
};

export type GwTopup = { min_idr: number; max_idr: number | null; enabled: boolean };

export async function adminPackages() {
  return request<{ packages: GwPackage[]; topup: GwTopup }>("/api/admin/packages");
}

export async function createPackage(body: {
  sku: string;
  name: string;
  price_idr: number;
  credits_micro?: number | null;
  rpm_limit: number;
  blurb?: string | null;
  kind?: "plan" | "topup";
  active?: boolean;
  sort?: number;
}) {
  return request<{ package: GwPackage }>("/api/admin/packages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchPackage(
  sku: string,
  body: Partial<{
    name: string;
    price_idr: number;
    credits_micro: number;
    rpm_limit: number;
    blurb: string;
    kind: "plan" | "topup";
    active: boolean;
    sort: number;
  }>,
) {
  return request<{ package: GwPackage }>(`/api/admin/packages/${encodeURIComponent(sku)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deletePackage(sku: string) {
  return request<{ deleted?: boolean; deactivated?: boolean; sku?: string; reason?: string }>(
    `/api/admin/packages/${encodeURIComponent(sku)}`,
    { method: "DELETE" },
  );
}

export async function patchTopup(body: Partial<GwTopup>) {
  return request<{ topup: GwTopup }>("/api/admin/topup", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function publicModels() {
  return request<{ object: string; data: PublicModel[]; count: number }>("/api/models", {}, false);
}
export type GwKey = {
  id: string;
  prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type GwAdminKey = GwKey & {
  user_id: string;
  email: string;
  requests: number;
  cost_micro: number;
};

export async function listKeys() {
  return request<{ keys: GwKey[] }>("/api/keys");
}

export async function createKey(name: string) {
  return request<{ key: string; meta: GwKey; notice: string }>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function renameKey(id: string, name: string) {
  return request<{ id: string; name: string }>(`/api/keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function revokeKey(id: string) {
  return request<{ revoked: string }>(`/api/keys/${id}`, { method: "DELETE" });
}

export async function adminKeys() {
  return request<{ keys: GwAdminKey[] }>("/api/admin/keys");
}

export async function adminRevokeKey(id: string) {
  return request<{ revoked: string }>(`/api/admin/keys/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ billing */

export type GwUsageRow = { day: string; model_id: string; requests: number; tokens_in: number; tokens_out: number; cost_micro: number };
export type GwUsage = { days: number; total: { requests: number; cost_micro: number; tokens_in: number; tokens_out: number }; by_day_model: GwUsageRow[] };
export type GwRequestRow = {
  id: string;
  model_id: string;
  tokens_in: number;
  tokens_out: number;
  cost_micro: number;
  latency_ms: number;
  status: string;
  created_at: string;
  key_name?: string | null;
  display_name?: string;
  email?: string;
  cost_usd?: number;
};
export type GwMeSummary = {
  balance_micro: number;
  balance_idr: number;
  spend_30d: number;
  spend_today: number;
  requests_30d: number;
  last_request: string | null;
};
export type GwLedgerRow = {
  id: string;
  kind: string;
  amount_micro: number;
  balance_after: number;
  ref: string | null;
  note: string | null;
  created_at: string;
};

export async function meSummary() {
  return request<GwMeSummary>("/api/me/summary");
}
export async function meUsage(days = 7) {
  return request<GwUsage>(`/api/me/usage?days=${days}`);
}
export async function meRequests(days = 7, limit = 50) {
  return request<{ requests: GwRequestRow[] }>(`/api/me/requests?days=${days}&limit=${limit}`);
}
export async function meLedger(limit = 50) {
  return request<{ ledger: GwLedgerRow[] }>(`/api/me/ledger?limit=${limit}`);
}

export type GwAdminUser = {
  id: string;
  email: string;
  role: string;
  plan: string;
  status: string;
  created_at: string;
  balance_micro: number;
  keys: number;
  requests: number;
};

export async function adminUsers() {
  return request<{ users: GwAdminUser[] }>("/api/admin/users");
}
export async function adminUsage(days = 7) {
  return request<GwUsage>(`/api/admin/usage?days=${days}`);
}
export async function adminRequests(days = 7, limit = 100) {
  return request<{ requests: GwRequestRow[] }>(`/api/admin/requests?days=${days}&limit=${limit}`);
}
export async function adminSummary() {
  return request<{
    requests: number;
    requests_24h: number;
    failed_requests: number;
    active_users: number;
    users_total: number;
    models_active: number;
    revenue_micro: number;
    revenue_idr: number;
    revenue_today_idr: number;
    cost_idr: number;
    margin_idr: number;
    margin_pct: number | null;
    /** false when upstream cost was never recorded, margin is unknown, not 100%. */
    cost_known?: boolean;
    cost_tracked_requests?: number;
    topup_idr: number;
    topup_count: number;
    liability_idr: number;
    ledger_diff_micro: number;
    negative_wallets: number;
  }>("/api/admin/summary");
}
export async function adminReconciliation(days = 7) {
  return request<{
    days: number;
    billed_idr: number;
    upstream_cost_idr: number;
    by_day: Array<{ day: string; requests: number; billed_idr: number; upstream_cost_idr: number; margin_idr: number }>;
  }>(`/api/admin/reconciliation?days=${days}`);
}
export async function adminCredit(userId: string, amountIdr: number, note?: string) {
  return request<{ balance_micro: number; balance_idr: number }>(`/api/admin/users/${userId}/credit`, {
    method: "POST",
    body: JSON.stringify({ amount_idr: amountIdr, note }),
  });
}
export async function adminCreateUser(body: { email: string; password: string; name?: string; credit_idr?: number }) {
  return request<{ user: { id: string; email: string } }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type GwAudit = { actor: string; action: string; target: string | null; meta: Record<string, unknown>; created_at: string };

export async function adminAudit(limit = 20) {
  return request<{ entries: GwAudit[] }>(`/api/admin/audit?limit=${limit}`);
}

export type GwMonitorModel = {
  model_id: string;
  public_id: string;
  display_name: string;
  provider: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_micro: number;
  last_seen: string | null;
};

export type GwMonitorIp = {
  ip: string;
  user_agent: string;
  requests: number;
  cost_micro: number;
  first_seen: string;
  last_seen: string;
};

export type GwMonitorDay = { day: string; requests: number; tokens_in: number; tokens_out: number };

export type GwMonitorKey = {
  id: string;
  user_id: string;
  email: string;
  user_name: string | null;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  created_at: string;
  last_used_at: string | null;
  last_request: string | null;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  cost_micro: number;
  ip_count: number;
  models: GwMonitorModel[];
  ips: GwMonitorIp[];
  daily: GwMonitorDay[];
};

export type GwMonitorUser = {
  user_id: string;
  email: string;
  user_name: string | null;
  keys_total: number;
  keys_active: number;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_micro: number;
  ip_count: number;
  key_names: string[];
};

export async function adminMonitor(days = 7) {
  return request<{ days: number; users: GwMonitorUser[]; keys: GwMonitorKey[] }>(
    `/api/admin/monitor?days=${days}`,
  );
}

export type GwTrafficIp = {
  client_ip: string;
  requests: number;
  keys: number;
  users: number;
  cost_micro: number;
  last_seen: string;
};

export type GwTrafficClient = GwTrafficIp & {
  client_ua: string;
  email: string;
  key_name: string;
  first_seen: string;
};

export async function adminTraffic(days = 7, limit = 50) {
  return request<{ clients: GwTrafficClient[]; ips: GwTrafficIp[] }>(
    `/api/admin/traffic?days=${days}&limit=${limit}`,
  );
}

// ------------------------------------------------------- model monitor (live)
export type GwModelIp = {
  ip: string;
  user_agent: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  last_seen: string;
};

export type GwModelUser = {
  user_id: string;
  email: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_micro: number;
  ips: GwModelIp[];
  ip_count: number;
};

export type GwModelUsage = {
  model_id: string;
  display_name: string;
  public_id: string;
  provider: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_micro: number;
  users: GwModelUser[];
  user_count: number;
  ip_count: number;
  last_seen: string;
};

export async function adminModelUsage(days = 7) {
  return request<{ days: number; models: GwModelUsage[] }>(`/api/admin/model-usage?days=${days}`);
}

// --------------------------------------------------------------------- bansos
export type GwSharedKey = {
  id: string;
  masked: string;
  key: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type GwBansosProgram = {
  id: string;
  name: string;
  active: boolean;
  credit_micro: number;
  models: string[];
  auto_grant: boolean;
  per_user_limit: number;
  note: string | null;
  created_at: string;
  grants: number;
  active_grants: number;
  granted_idr: number;
  used_idr: number;
  shared_key?: GwSharedKey;
};

export type GwBansosGrant = {
  id: string;
  program_id: string;
  program_name: string;
  user_id: string;
  email: string;
  amount_micro: number;
  used_micro: number;
  remaining_micro: number;
  status: "active" | "exhausted" | "revoked";
  note: string | null;
  created_at: string;
};

export async function adminBansosPrograms() {
  return request<{ programs: GwBansosProgram[] }>("/api/admin/bansos/programs");
}

export async function createBansosProgram(body: {
  name: string;
  credit_idr: number;
  models: string[];
  auto_grant: boolean;
  per_user_limit: number;
  note?: string;
  active?: boolean;
}) {
  return request<{ program: GwBansosProgram }>("/api/admin/bansos/programs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateBansosProgram(
  id: string,
  body: Partial<{
    name: string;
    credit_idr: number;
    models: string[];
    auto_grant: boolean;
    per_user_limit: number;
    active: boolean;
    note: string;
  }>,
) {
  return request<{ program: GwBansosProgram }>(`/api/admin/bansos/programs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function rotateBansosKey(id: string) {
  return request<{ shared_key: GwSharedKey }>(`/api/admin/bansos/programs/${id}/rotate-key`, {
    method: "POST",
  });
}

export async function deleteBansosProgram(id: string) {
  return request<{ ok: boolean }>(`/api/admin/bansos/programs/${id}`, { method: "DELETE" });
}

export async function adminBansosGrants(programId?: string, limit = 100) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (programId) query.set("program_id", programId);
  return request<{ grants: GwBansosGrant[] }>(`/api/admin/bansos/grants?${query.toString()}`);
}

export async function createBansosGrants(body: {
  program_id: string;
  emails: string[];
  amount_idr?: number;
  note?: string;
}) {
  return request<{ created: Array<{ id: string; user_id: string; amount_micro: number }> }>(
    "/api/admin/bansos/grants",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function revokeBansosGrant(id: string) {
  return request<{ ok: boolean }>(`/api/admin/bansos/grants/${id}/revoke`, { method: "POST" });
}

// ------------------------------------------------------------------- fallbacks
export type GwFallback = {
  id: string;
  model_id: string;
  fallback_model_id: string;
  provider_label: string | null;
  priority: number;
  active: boolean;
  model_name: string;
  public_id: string;
  fallback_name: string;
  created_at: string;
};

export async function adminFallbacks() {
  return request<{ fallbacks: GwFallback[] }>("/api/admin/fallbacks");
}

export async function createFallback(body: {
  model_id: string;
  fallback_model_id: string;
  provider_label?: string;
  priority: number;
  active: boolean;
}) {
  return request<{ fallback: GwFallback }>("/api/admin/fallbacks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateFallback(
  id: string,
  body: Partial<{ fallback_model_id: string; provider_label: string; priority: number; active: boolean }>,
) {
  return request<{ fallback: GwFallback }>(`/api/admin/fallbacks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteFallback(id: string) {
  return request<{ ok: boolean }>(`/api/admin/fallbacks/${id}`, { method: "DELETE" });
}

export async function upstreamModels() {
  return request<{ models: string[] }>("/api/admin/upstream/models");
}


/* ------------------------------------------------------------------ */
/*  Buyer access (portal rework)                                       */
/* ------------------------------------------------------------------ */

export type GwBuyer = {
  id: string;
  tg_id: number | null;
  username: string | null;
  name: string | null;
  status: string;
  created_at: string;
  keys_active: number;
  spend_micro: number;
  balance_micro: number;
};

export type GwAccessKey = {
  id: string;
  prefix: string;
  name: string;
  label: string | null;
  rpm_limit: number;
  rpm_override?: boolean;
  status: "active" | "suspended" | "revoked";
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  buyer_id: string | null;
  tg_id: number | null;
  username: string | null;
  buyer_name: string | null;
  email: string;
  spend_micro: number;
  requests: number;
  balance_micro: number;
};

export type GwOrder = {
  id: string;
  sku: string;
  credits_micro: number;
  price_idr: number;
  status: string;
  key_id: string | null;
  created_at: string;
  granted_at: string | null;
  tg_id: number | null;
  username: string | null;
  buyer_name: string | null;
};

export type GwAuthFailure = { scope: string; ident: string | null; ip: string | null; at: string };

export type GwBuyerDetail = {
  buyer: { id: string; tg_id: number | null; username: string | null; name: string | null; status: string; created_at: string; note: string | null };
  balance_micro: number;
  usage_30d: { requests: number; tokens_in: number; tokens_out: number; cost_micro: number };
  keys: Array<{ id: string; prefix: string; name: string; label: string | null; rpm_limit: number; status: string; last_used_at: string | null; created_at: string; revoked_at: string | null }>;
  orders: Array<{ id: string; sku: string; credits_micro: number; price_idr: number; status: string; created_at: string; granted_at: string | null }>;
};

export const adminBuyers = (q = "") =>
  request<{ buyers: GwBuyer[] }>(`/api/admin/access/buyers?q=${encodeURIComponent(q)}`);

export const adminBuyerDetail = (id: string) =>
  request<GwBuyerDetail>(`/api/admin/access/buyers/${id}`);

export const adminAccessKeys = (params: { status?: string; q?: string } = {}) => {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  return request<{ keys: GwAccessKey[] }>(`/api/admin/access/keys?${search.toString()}`);
};

export const adminPatchKey = (id: string, body: { rpm_limit?: number; status?: string; label?: string }) =>
  request<{ key: { id: string; prefix: string; rpm_limit: number; status: string; label: string | null } }>(
    `/api/admin/access/keys/${id}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );

export const adminRotateKey = (id: string) =>
  request<{ api_key: string; prefix: string; id: string }>(`/api/admin/access/keys/${id}/rotate`, { method: "POST" });

export const adminOrders = () => request<{ orders: GwOrder[] }>("/api/admin/access/orders");

export const adminAuthFailures = () => request<{ failures: GwAuthFailure[] }>("/api/admin/access/auth-failures");

export const adminCreditBuyer = (id: string, amountIdr: number, note = "manual credit") =>
  request<{ buyer_id: string; balance_micro: number }>(`/api/admin/access/buyers/${id}/credit`, {
    method: "POST",
    body: JSON.stringify({ amount_idr: amountIdr, note }),
  });


/* ------------------------------------------------------------------ */
/*  Provider routes per catalogue model                                */
/* ------------------------------------------------------------------ */

export type GwRoute = {
  id: string;
  model_id: string;
  upstream_model: string;
  provider_label: string | null;
  priority: number;
  active: boolean;
  note: string | null;
  created_at: string;
  public_id?: string | null;
  display_name?: string | null;
  fallback_enabled?: boolean;
  context_window?: number | null;
  max_output?: number | null;
  model_active?: boolean;
};

export type GwRouterModel = {
  id: string;
  provider: string;
  context_window: number | null;
  max_output: number | null;
  in_use: boolean;
};

export async function createProduct(body: {
  upstream_model: string;
  public_id?: string | null;
  display_name?: string | null;
  provider_label?: string | null;
  source_model_id?: string | null;
  price_in_idr?: number;
  price_out_idr?: number;
  price_cached_idr?: number;
}) {
  return request<{ model: GwModel; next: string }>("/api/admin/products", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminRoutes() {
  return request<{ routes: GwRoute[] }>("/api/admin/routes");
}

export async function modelRoutes(modelId: string) {
  return request<{
    model_id: string;
    model: { public_id: string | null; display_name: string | null; fallback_enabled: boolean;
             context_window: number | null; max_output: number | null } | null;
    routes: GwRoute[];
  }>(`/api/admin/model-routes?model_id=${encodeURIComponent(modelId)}`);
}

export async function createModelRoute(body: {
  model_id: string; upstream_model: string; provider_label?: string | null;
  priority?: number; active?: boolean; note?: string | null;
}) {
  return request<{ route: GwRoute }>("/api/admin/model-routes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchModelRoute(
  id: string,
  body: Partial<{ upstream_model: string; provider_label: string; priority: number; active: boolean; note: string }>,
) {
  return request<{ route: GwRoute }>(`/api/admin/routes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteModelRoute(id: string) {
  return request<{ ok: boolean }>(`/api/admin/routes/${id}`, { method: "DELETE" });
}

export async function toggleModelFallback(modelId: string, enabled: boolean) {
  return request<{ model_id: string; fallback_enabled: boolean }>(
    `/api/admin/model-fallback?model_id=${encodeURIComponent(modelId)}`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );
}

export async function upstreamCatalogue(q: string) {
  return request<{ count: number; models: GwRouterModel[] }>(
    `/api/admin/upstream/catalogue?q=${encodeURIComponent(q)}&limit=80`,
  );
}
