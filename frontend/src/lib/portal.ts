/** Web store client: Telegram linking, catalogue, orders. All calls are same-origin. */

export type Pkg = {
  sku: string;
  name: string;
  idr: number;
  rpm: number;
  blurb: string;
  credits_micro: number;
  price_idr: number;
  rpm_limit: number;
  credits?: number;
  kind?: "plan" | "topup";
  active?: boolean;
  sort?: number;
};

export type TopupPolicy = { min_idr: number; max_idr: number | null; enabled: boolean };

export type LinkStart = {
  code: string;
  deep_link: string;
  bot_username: string;
  expires_in: number;
};

export type LinkStatus = {
  status: "pending" | "confirmed" | "expired" | "consumed" | "unknown";
  token?: string;
  expires_at?: string;
  deep_link?: string;
  buyer?: { id: string; tg_id: number | null; username: string | null; name?: string | null };
};

export async function fetchShop(): Promise<{ packages: Pkg[]; topup: TopupPolicy }> {
  const res = await fetch("/api/packages", { headers: { Accept: "application/json" } });
  const body = await res.json();
  return {
    packages: (body?.packages ?? []) as Pkg[],
    topup: (body?.topup ?? { min_idr: 2000, max_idr: null, enabled: true }) as TopupPolicy,
  };
}

export async function fetchPackages(): Promise<Pkg[]> {
  return (await fetchShop()).packages;
}

export async function topupOrder(token: string, amount_idr: number) {
  const res = await fetch("/api/portal/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount_idr }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal membuat top-up");
  return body as { order_id: string; credits_micro: number; price_idr: number; status: string };
}

export async function startLink(): Promise<LinkStart> {
  const res = await fetch("/api/portal/telegram/start", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal membuat kode");
  return body as LinkStart;
}

export async function pollLink(code: string): Promise<LinkStatus> {
  const res = await fetch(`/api/portal/telegram/status?code=${encodeURIComponent(code)}`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal cek status");
  return body as LinkStatus;
}

export async function placeOrder(token: string, sku: string) {
  const res = await fetch("/api/portal/order", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sku }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal membuat order");
  return body as { order_id: string; name: string; price_idr: number; status: string };
}

export type PayPayload = {
  order_id: string;
  sku: string;
  status: "pending" | "paid" | "expired" | "granted" | string;
  provider: string | null;
  amount_idr: number;
  total_bayar: number;
  fee_idr: number;
  qr_string?: string | null;
  qr_image?: string | null;
  trx_reference?: string | null;
  expires_at?: string | null;
  tutorial?: string | null;
  checkout_token: string;
  pay_url: string;
};

/** Create (or reuse) the QRIS transaction for an order of the logged-in buyer. */
export async function createPayment(token: string, orderId: string): Promise<PayPayload> {
  const res = await fetch("/api/portal/pay/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ order_id: orderId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal membuat pembayaran");
  return body as PayPayload;
}

/** Public status poll, the checkout token is the only credential needed. */
export async function payStatus(orderId: string, checkoutToken: string): Promise<PayPayload> {
  const res = await fetch(
    `/api/pay/status?order_id=${encodeURIComponent(orderId)}&t=${encodeURIComponent(checkoutToken)}`,
    { headers: { Accept: "application/json" } },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal cek status pembayaran");
  return body as PayPayload;
}

export type PendingPayment = {
  status: string;
  live: boolean;
  expires_at: string | null;
  qr_string: string | null;
  qr_image: string | null;
  total_bayar: number;
  fee_idr: number;
};

export type PendingOrder = {
  order_id: string;
  sku: string;
  price_idr: number;
  credits_micro: number;
  status: string;
  created_at: string | null;
  payment: PendingPayment;
};

export async function fetchPending(token: string): Promise<PendingOrder | null> {
  const res = await fetch("/api/portal/pending", { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal memuat pembayaran pending");
  return (body.order ?? null) as PendingOrder | null;
}

export type LocalOrderStatus = {
  order_id: string;
  status: string;
  payment_status: string;
  live: boolean;
  expires_at: string | null;
  granted_at: string | null;
};

/** Reads our tables only; never asks the payment provider. */
export async function localOrderStatus(token: string, orderId: string): Promise<LocalOrderStatus> {
  const res = await fetch(`/api/portal/orders/${encodeURIComponent(orderId)}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal cek status order");
  return body as LocalOrderStatus;
}

export async function cancelOrder(token: string, orderId: string): Promise<{ order_id: string; status: string }> {
  const res = await fetch(`/api/portal/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal membatalkan pembayaran");
  return body as { order_id: string; status: string };
}

export type PortalOrder = {
  id: string;
  sku: string;
  credits_micro: number;
  price_idr: number;
  status: string;
  created_at: string;
  granted_at: string | null;
};

export async function fetchOrders(token: string): Promise<PortalOrder[]> {
  const res = await fetch("/api/portal/orders", { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Gagal memuat order");
  return (body.orders ?? []) as PortalOrder[];
}
