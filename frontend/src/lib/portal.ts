/** Web store client: Telegram linking, catalogue, orders. All calls are same-origin. */

export type Pkg = {
  sku: string;
  name: string;
  idr: number;
  rpm: number;
  blurb: string;
  credits_micro: number;
};

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

export async function fetchPackages(): Promise<Pkg[]> {
  const res = await fetch("/api/packages", { headers: { Accept: "application/json" } });
  const body = await res.json();
  return (body?.packages ?? []) as Pkg[];
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
