import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  Gift,
  KeyRound,
  Loader2,
  LogOut,
  Minus,
  Receipt,
  RefreshCw,
  ShieldAlert,
  Timer,
  Wallet,
} from "lucide-react";
import { Wordmark } from "@/components/layout/BrandLogo";
import { AppAmbient } from "@/components/layout/AppAmbient";
import { TelegramConnect } from "@/components/portal/TelegramConnect";
import { cancelOrder, createPayment, fetchOrders, fetchPending, fetchShop, localOrderStatus, placeOrder,
  topupOrder, type PendingOrder, type Pkg, type PortalOrder, type TopupPolicy } from "@/lib/portal";
import { cn } from "@/lib/cn";

/**
 * Buyer portal, no email, no password. A purchaser pastes the API key they got from the
 * Telegram store once; the gateway trades it for a read-only 12h token.
 */

const TOKEN_KEY = "aethink-portal-token";

type Session = { token: string; expires_at: string };
type Me = {
  buyer: { id: string | null; tg_id: number | null; username: string | null; name: string | null; status: string };
  key: { id: string; prefix: string; label: string | null; rpm_limit: number; last_used_at: string | null; created_at: string } | null;
  balance_micro: number;
  lifetime: { requests: number; cost_micro: number; tokens_in: number; tokens_out: number; models_used: number };
  keys: Array<{ id: string; prefix: string; label: string | null; rpm_limit: number; status: string; last_used_at: string | null }>;
};
type Usage = {
  days: number;
  totals: { requests: number; tokens_in: number; tokens_out: number; cost_micro: number; avg_latency_ms: number; errors: number };
  daily: Array<{ day: string; requests: number; tokens_in: number; tokens_out: number; cost_micro: number }>;
};
type Models = { days: number; models: Array<{ model_id: string; requests: number; tokens_in: number; tokens_out: number; cost_micro: number; last_used_at: string | null }> };
type Reqs = { requests: Array<{ request_id: string; model_id: string; tokens_in: number; tokens_out: number; cost_micro: number; latency_ms: number; status: string; stream: boolean; client_ip: string | null; created_at: string }> };

/** Plain Rupiah, whole units: top-up policy and order prices come as IDR. */
const rp = (value: number) => `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;

/** Micro-IDR to Rupiah, for balances and ledger amounts. Sub-rupiah costs keep
 *  two decimals so a real charge never renders as "Rp 0". */
const idr = (micro: number) => {
  const value = (Number(micro) || 0) / 1_000_000;
  if (value > 0 && value < 1000) {
    const fractional = Math.round(value * 100) % 100 !== 0;
    return `Rp ${value.toLocaleString("id-ID", {
      minimumFractionDigits: fractional ? 2 : 0,
      maximumFractionDigits: fractional ? 2 : 0,
    })}`;
  }
  return rp(value);
};

const rpDate = (iso: string | null | undefined) => {
  if (!iso) return "n/a";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const compact = (n: number) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
};
const when = (iso: string | null) => {
  if (!iso) return "n/a";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
};

const PACKAGE_COPY: Record<string, string> = {
  starter: "Cocok untuk mencoba API dan penggunaan pribadi.",
  pro: "Praktis untuk aplikasi kecil dan otomatisasi harian.",
  max: "Untuk kebutuhan saldo dan penggunaan yang lebih besar.",
};

const orderStatusLabel = (status: string) => {
  if (status === "granted") return "Kredit Ditambahkan";
  if (status === "pending") return "Menunggu Pembayaran";
  if (status === "expired") return "Kedaluwarsa";
  if (status === "failed") return "Gagal";
  if (status === "cancelled") return "Dibatalkan";
  return status;
};

export type PurchaseDraft =
  | { kind: "plan"; sku: string; name: string; price_idr: number; credits_micro: number; rpm: number }
  | { kind: "topup"; amount: number };

/** Renders the provider image when there is one, otherwise the QRIS payload
 *  locally, so the panel never depends on an external image host. */
function QrCode({ value, image }: { value: string | null; image: string | null }) {
  const [src, setSrc] = useState<string | null>(image);
  useEffect(() => {
    let alive = true;
    if (image) { setSrc(image); return; }
    if (!value) { setSrc(null); return; }
    void import("qrcode")
      .then((mod) => mod.toDataURL(value, {
        margin: 1,
        width: 360,
        color: { dark: "#0A0A0A", light: "#FFFFFF" },
      }))
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [image, value]);

  if (!src) {
    return (
      <div className="grid h-[220px] w-[220px] place-items-center rounded-xl border border-dashed border-white/12 text-center text-[12px] leading-5 text-dim">
        QRIS belum dibuat
      </div>
    );
  }
  return <img src={src} alt="Kode QRIS pembayaran" className="h-[220px] w-[220px] rounded-xl bg-white p-2" />;
}

function StorePanel({
  token,
  onChanged,
  onPurchase,
  pending,
  onShowPending,
  refreshKey,
}: {
  token: string;
  onChanged: () => void;
  onPurchase: (draft: PurchaseDraft) => void;
  refreshKey: number;
  pending: PendingOrder | null;
  onShowPending: () => void;
}) {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [topup, setTopup] = useState<TopupPolicy>({ min_idr: 2000, max_idr: null, enabled: true });
  const [topupAmount, setTopupAmount] = useState("20000");
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [showAllOrders, setShowAllOrders] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const shop = await fetchShop();
      setPackages(shop.packages);
      setTopup(shop.topup);
    } catch { /* keep empty */ }
    try { setOrders(await fetchOrders(token)); } catch { /* session may be key-only */ }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  // The bot or the webhook can grant an order while this page is open. Poll the
  // list on a slow beat and whenever the tab regains focus, so the transaction
  // status never needs a manual reload.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(beat, 12000);
    window.addEventListener("focus", beat);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", beat);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [refresh]);

  useEffect(() => {
    if (!receipt) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReceipt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [receipt]);

  const amount = Math.round(Number(topupAmount));
  const amountTooSmall = Number.isFinite(amount) && amount > 0 && amount < topup.min_idr;
  const amountTooLarge = Boolean(topup.max_idr && Number.isFinite(amount) && amount > (topup.max_idr ?? 0));
  const amountValid = Number.isFinite(amount) && amount >= topup.min_idr && !amountTooLarge;
  const presets = [2000, 5000, 10000, 20000, 25000, 50000].filter(
    (value) => value >= topup.min_idr && (!topup.max_idr || value <= topup.max_idr),
  );

  const buy = (pkg: Pkg) => {
    setNotice(null);
    if (pending) {
      onShowPending();
      return;
    }
    onPurchase({
      kind: "plan",
      sku: pkg.sku,
      name: pkg.name,
      price_idr: pkg.price_idr,
      credits_micro: pkg.credits_micro,
      rpm: pkg.rpm_limit,
    });
  };

  const buyTopup = async () => {
    const value = Math.round(Number(topupAmount));
    if (!Number.isFinite(value)) return;
    if (value < topup.min_idr) {
      setNotice(`Minimal isi saldo ${rp(topup.min_idr)}.`);
      return;
    }
    if (topup.max_idr && value > topup.max_idr) {
      setNotice(`Maksimal isi saldo ${rp(topup.max_idr)}.`);
      return;
    }
    if (pending) {
      onShowPending();
      return;
    }
    onPurchase({ kind: "topup", amount: value });
  };

  const openReceipt = async (order: PortalOrder) => {
    setReceiptBusy(order.id);
    try {
      const res = await fetch(`/api/portal/orders/${encodeURIComponent(order.id)}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || "Gagal memuat invoice");
      setReceipt(body);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal memuat invoice");
    } finally {
      setReceiptBusy(null);
    }
  };

  return (
    <>
      <section id="isi-saldo" className="mt-6 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-warm">Isi Saldo</h2>
            <p className="mt-1 text-[12.5px] text-ash">
              Pilih nominal kredit untuk menggunakan API. Biaya dihitung berdasarkan pemakaian token.
            </p>
          </div>
        </div>

        {pending ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-flame/30 bg-flame/[0.06] px-3 py-2.5">
            <p className="text-[12px] text-ash">
              Pembayaran <span className="font-mono text-dim">{pending.order_id}</span> masih berjalan. Lunasi atau batalkan dulu sebelum membeli lagi.
            </p>
            <button type="button" onClick={onShowPending}
              className="h-8 rounded-lg border border-flame/40 px-2.5 text-[12px] font-medium text-flame transition hover:bg-flame/10">
              Lihat Invoice
            </button>
          </div>
        ) : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {packages.map((pkg, index) => {
            const featured = pkg.sku === "pro" || (packages.length > 2 && index === 1);
            return (
              <div
                key={pkg.sku}
                className={cn(
                  "aethink-package-card relative flex h-full flex-col rounded-xl border p-4",
                  featured
                    ? "aethink-package-card--featured border-flame/35"
                    : "border-white/8 bg-panel",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-warm">{pkg.name}</h3>
                  {featured ? (
                    <span className="rounded-full border border-flame/30 bg-flame/10 px-2 py-0.5 text-[12px] text-flame">
                      Pilihan Praktis
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm tabular-nums">
                  {rp(pkg.price_idr)}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-ash">{PACKAGE_COPY[pkg.sku] ?? pkg.blurb}</p>
                <p className="mt-1 pb-3 text-[12px] text-dim">{pkg.rpm_limit} RPM</p>
                <button
                  type="button"
                  onClick={() => buy(pkg)}
                  className={cn(
                    "mt-auto flex h-11 w-full items-center justify-center gap-1.5 rounded-xl pt-0 text-[12.5px] font-semibold transition disabled:opacity-50",
                    featured
                      ? "bg-flame text-[#18191B] hover:bg-[#F09A55]"
                      : "border border-white/10 bg-white/[0.03] text-warm hover:bg-white/[0.06]",
                  )}
                >
                  Pilih {pkg.name}
                </button>
              </div>
            );
          })}
        </div>

        {topup.enabled ? (
          <div className="mt-3 rounded-xl border border-white/8 bg-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-warm">Nominal Lainnya</h3>
              <p className="text-[12px] tabular-nums text-dim">
                Min. {rp(topup.min_idr)}{topup.max_idr ? ` · Maks. ${rp(topup.max_idr)}` : ""}
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative w-full sm:w-[190px]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-ash">Rp</span>
                <input
                  value={topupAmount ? Number(topupAmount).toLocaleString("id-ID") : ""}
                  onChange={(event) => setTopupAmount(event.target.value.replace(/\D/g, "").slice(0, 9))}
                  inputMode="numeric"
                  aria-label="Nominal isi saldo"
                  className="h-11 w-full rounded-xl border border-white/10 bg-panel pl-9 pr-3 text-[13px] text-warm tabular-nums placeholder:text-dim focus:border-flame/50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTopupAmount(String(value))}
                    className={cn(
                      "h-11 rounded-lg border px-3 text-[12px] tabular-nums transition sm:h-9 sm:px-2.5",
                      Number(topupAmount) === value
                        ? "border-flame/40 bg-flame/12 text-flame"
                        : "border-white/10 text-ash hover:bg-white/[0.04] hover:text-warm",
                    )}
                  >
                    {rp(value)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void buyTopup()}
                disabled={!amountValid}
                className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-flame px-4 text-[12.5px] font-semibold text-[#18191B] transition hover:bg-[#F09A55] disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto"
              >
                Isi Saldo
              </button>
            </div>
            {amountTooSmall ? (
              <p className="mt-2 text-[12px] text-flame">Minimal isi saldo {rp(topup.min_idr)}.</p>
            ) : null}
            {amountTooLarge ? (
              <p className="mt-2 text-[12px] text-flame">Maksimal isi saldo {rp(topup.max_idr ?? 0)}.</p>
            ) : null}
          </div>
        ) : null}

        {notice ? (
          <p className="mt-3 rounded-xl border border-flame/35 bg-flame/10 px-3 py-2 text-[12px] leading-5 text-flame">
            {notice}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-white/8 bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <h2 className="text-[15px] font-semibold text-warm">Riwayat Transaksi</h2>
          <span className="text-[12px] text-dim">{orders.length} transaksi</span>
        </div>
        {orders.length ? (
          <div className="divide-y divide-white/6">
            {(showAllOrders ? orders : orders.slice(0, 5)).map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => void openReceipt(order)}
                className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] text-warm">{order.id}</p>
                  <p className="mt-0.5 text-[12px] text-dim">
                    {rpDate(order.created_at)} · {order.sku} · {rp(order.price_idr)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[12px]",
                      order.status === "granted"
                        ? "bg-ok/35 text-ok"
                        : "bg-white/[0.06] text-ash",
                    )}
                  >
                    {orderStatusLabel(order.status)}
                  </span>
                  <span className="hidden items-center gap-1 text-[12px] text-ash sm:flex">
                    {receiptBusy === order.id ? "Memuat" : "Lihat Invoice"}
                    <Receipt size={12} aria-hidden />
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-[12px] text-ash">
            Belum ada transaksi. Riwayat pembelian kredit akan tampil di sini.
          </p>
        )}
        {orders.length > 5 ? (
          <button
            type="button"
            onClick={() => setShowAllOrders((value) => !value)}
            className="w-full border-t border-white/8 px-4 py-3 text-[12px] text-ash transition hover:bg-white/[0.03] hover:text-warm"
          >
            {showAllOrders ? "Tampilkan lebih sedikit" : `Lihat Semua Transaksi (${orders.length})`}
          </button>
        ) : null}
      </section>

      {receipt ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
          onClick={() => setReceipt(null)}
        >
          <div
            className="w-full max-w-[440px] rounded-xl border border-white/10 bg-panel p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[12px] text-dim">Invoice</p>
                <p className="mt-1 font-mono text-[14px] text-warm">{String(receipt.invoice_id)}</p>
              </div>
              <button type="button" onClick={() => setReceipt(null)} className="text-[12px] text-ash hover:text-warm">
                tutup
              </button>
            </div>
            <div className="mt-4 space-y-1.5 text-[12px]">
              {(() => {
                const pkg = receipt.package as { sku?: string; name?: string; rpm_limit?: number } | undefined;
                const amount = receipt.amount as { price_idr?: number; credits_idr?: number } | undefined;
                const used = receipt.usage_since_issue as { requests?: number; tokens_in?: number; tokens_out?: number } | undefined;
                const rows: Array<[string, string]> = [
                  ["Paket", `${pkg?.name ?? pkg?.sku ?? "n/a"} · ${pkg?.rpm_limit ?? "n/a"} RPM`],
                  ["Dibayar", rp(Number(amount?.price_idr ?? 0))],
                  ["Kredit masuk", rp(Number(amount?.credits_idr ?? 0))],
                  ["Status", orderStatusLabel(String(receipt.status))],
                  ["Terbit", when(String(receipt.issued_at))],
                  ["Dibayar", receipt.paid_at ? when(String(receipt.paid_at)) : "n/a"],
                  ["Saldo sekarang", idr(Number(receipt.balance_micro ?? 0))],
                  ["Pemakaian sejak invoice", `${used?.requests ?? 0} req · ${(used?.tokens_in ?? 0) + (used?.tokens_out ?? 0)} token`],
                ];
                return rows.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3 border-b border-white/6 pb-1.5 last:border-0">
                    <span className="text-ash">{key}</span>
                    <span className="text-right font-mono text-[12px] text-warm">{value}</span>
                  </div>
                ));
              })()}
            </div>
            <p className="mt-3 text-[12px] leading-5 text-dim">{String(receipt.note ?? "")}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function usePortalApi(token: string | null, onInvalid: () => void) {
  return useCallback(
    async <T,>(path: string): Promise<T> => {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (res.status === 401) {
        onInvalid();
        throw new Error("Sesi habis, tempel ulang API key");
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `Gagal (${res.status})`);
      return body as T;
    },
    [token, onInvalid],
  );
}

export default function PortalPage() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [requests, setRequests] = useState<Reqs | null>(null);
  const [days, setDays] = useState(30);
  const [fresh, setFresh] = useState<string | null>(null);
  const [rotStep, setRotStep] = useState<"idle" | "sent">("idle");
  const [rotCode, setRotCode] = useState("");
  const [rotMsg, setRotMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMe(null);
    setUsage(null);
    setModels(null);
    setRequests(null);
  }, []);

  const call = usePortalApi(token, logout);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [m, u, mo, rq] = await Promise.all([
        call<Me>("/api/portal/me"),
        call<Usage>(`/api/portal/usage?days=${days}`),
        call<Models>(`/api/portal/models?days=${days}`),
        call<Reqs>("/api/portal/requests?limit=40"),
      ]);
      setMe(m); setUsage(u); setModels(mo); setRequests(rq); setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data");
    } finally {
      setBusy(false);
    }
  }, [call, days, token]);

  useEffect(() => { void load(); }, [load]);

  const openSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || "API key tidak valid");
      sessionStorage.setItem(TOKEN_KEY, body.token);
      setToken(body.token);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  };

  // Rotation from a browser needs proof it is the same human: the bot sends a code
  // to the linked Telegram account, and the code is what authorises the swap.
  const rotate = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/keys/rotate/request", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || "Gagal minta kode");
      setRotCode("");
      setRotStep("sent");
      setRotMsg(body.hint || "Kode dikirim ke chat bot Aethink.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal minta kode");
    } finally {
      setBusy(false);
    }
  };

  const confirmRotate = async () => {
    if (!token || rotCode.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/keys/rotate/confirm", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: rotCode.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || "Kode tidak diterima");
      if (body.token) {
        sessionStorage.setItem(TOKEN_KEY, body.token);
        setToken(body.token);
      }
      setFresh(body.api_key);
      setRotStep("idle");
      setRotCode("");
      setRotMsg("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode tidak diterima");
    } finally {
      setBusy(false);
    }
  };

  const maxDay = useMemo(() => Math.max(1, ...(usage?.daily ?? []).map((d) => d.cost_micro)), [usage]);

  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [checkout, setCheckout] = useState<PurchaseDraft | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payNotice, setPayNotice] = useState<string | null>(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [copiedQr, setCopiedQr] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [ordersKey, setOrdersKey] = useState(0);

  // A reload never creates a new order: it only restores the one open payment,
  // minimised, because no money has moved and nothing was cancelled.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    void fetchPending(token)
      .then((order) => { if (alive) { setPending(order); setPayOpen(false); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pending]);

  // Local status only: our webhook settles the payment, this poll never calls
  // the provider, so an open panel cannot spam WijayaPay.
  useEffect(() => {
    if (!token || !pending || pending.status !== "pending") return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await localOrderStatus(token, pending.order_id);
        if (!alive) return;
        if (s.status === "granted" || s.payment_status === "paid") {
          setPending(null);
          setPayOpen(false);
          setPayNotice("Pembayaran diterima. Saldo dan kredit sudah diperbarui.");
          setOrdersKey((key) => key + 1);
          void load();
        } else if (s.status === "cancelled" || s.status === "expired") {
          setPending(null);
          setPayOpen(false);
        }
      } catch {
        /* transient network error: next tick retries */
      }
    };
    const id = window.setInterval(() => void tick(), 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [load, pending, token]);

  const startPurchase = (draft: PurchaseDraft) => {
    setPayError(null);
    setPayNotice(null);
    if (pending) {
      setPayOpen(true);
      return;
    }
    setCheckout(draft);
  };

  const confirmPurchase = async () => {
    if (!token || !checkout) return;
    setPayBusy(true);
    setPayError(null);
    try {
      const payment = { status: "none", live: false, expires_at: null, qr_string: null, qr_image: null, total_bayar: 0, fee_idr: 0 };
      if (checkout.kind === "plan") {
        const order = await placeOrder(token, checkout.sku);
        setPending({
          order_id: order.order_id,
          sku: checkout.sku,
          price_idr: order.price_idr,
          credits_micro: checkout.credits_micro,
          status: "pending",
          created_at: new Date().toISOString(),
          payment: { ...payment, total_bayar: order.price_idr },
        });
      } else {
        const order = await topupOrder(token, checkout.amount);
        setPending({
          order_id: order.order_id,
          sku: "topup",
          price_idr: order.price_idr,
          credits_micro: order.credits_micro,
          status: "pending",
          created_at: new Date().toISOString(),
          payment: { ...payment, total_bayar: order.price_idr },
        });
      }
      setCheckout(null);
      setPayOpen(true);
      setOrdersKey((key) => key + 1);
      void load();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal membuat order");
      const existing = await fetchPending(token).catch(() => null);
      if (existing) {
        setPending(existing);
        setCheckout(null);
        setPayOpen(true);
      }
    } finally {
      setPayBusy(false);
    }
  };

  // Second, explicit step: the provider is only contacted when the buyer asks
  // for the QR, never on page load and never on a package click.
  const createQr = async () => {
    if (!token || !pending) return;
    setPayBusy(true);
    setPayError(null);
    try {
      const pay = await createPayment(token, pending.order_id);
      setPending({
        ...pending,
        payment: {
          status: pay.status,
          live: Boolean(pay.qr_string || pay.qr_image),
          expires_at: pay.expires_at ?? null,
          qr_string: pay.qr_string ?? null,
          qr_image: pay.qr_image ?? null,
          total_bayar: pay.total_bayar,
          fee_idr: pay.fee_idr,
        },
      });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal membuat QRIS");
      const existing = await fetchPending(token).catch(() => null);
      if (existing) setPending(existing);
    } finally {
      setPayBusy(false);
    }
  };

  const cancelPayment = async () => {
    if (!token || !pending) return;
    setPayBusy(true);
    setPayError(null);
    try {
      await cancelOrder(token, pending.order_id);
      setPending(null);
      setPayOpen(false);
      setCancelAsk(false);
      setPayNotice(null);
      setOrdersKey((key) => key + 1);
      void load();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal membatalkan pembayaran");
    } finally {
      setPayBusy(false);
    }
  };

  const copyQr = async () => {
    if (!pending?.payment.qr_string) return;
    try {
      await navigator.clipboard.writeText(pending.payment.qr_string);
      setCopiedQr(true);
      window.setTimeout(() => setCopiedQr(false), 2000);
    } catch {
      /* clipboard blocked: the code is visible in the panel */
    }
  };

  useEffect(() => {
    if (!payOpen && !checkout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPayOpen(false);
      setCheckout(null);
      setCancelAsk(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkout, payOpen]);

  const remaining = (() => {
    if (!pending?.payment.expires_at) return null;
    const ms = new Date(pending.payment.expires_at).getTime() - clock;
    if (ms <= 0) return "kedaluwarsa";
    const total = Math.floor(ms / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();

  if (!token) {
    return (
      <div className="relative grid min-h-screen place-items-center px-4 py-14">
        <div className="pointer-events-none absolute inset-0" />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-[460px] rounded-xl border border-white/10 bg-panel p-6"
        >
          <Link to="/" className="inline-flex"><Wordmark /></Link>
          <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-warm">Masuk ke portal</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-ash">
            Portal pembeli untuk melihat saldo, riwayat pembelian, dan API key. Masuk dengan akun
            Telegram yang dipakai saat membeli.
          </p>

          <div className="mt-5">
            <TelegramConnect
              onToken={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }}
            />
          </div>

          <details className="mt-5 rounded-lg border border-white/10 bg-panel/60 p-3">
            <summary className="cursor-pointer text-[12px] text-ash marker:content-none">
              Sudah punya API key? Masuk langsung
            </summary>
          <form onSubmit={openSession} className="mt-3 space-y-3">
            <label htmlFor="apikey" className="text-[12px] font-medium text-ash">API key</label>
            <div className="relative">
              <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash" />
              <input
                id="apikey"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(null); }}
                placeholder="sk-aeth_…"
                spellCheck={false}
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-white/10 bg-panel pl-9 pr-3 font-mono text-[13px] text-warm placeholder:text-ash/60 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-[#E7893C]/20"
              />
            </div>
            {error ? (
              <p className="flex items-start gap-1.5 text-[12px] text-flame">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" /> {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || apiKey.trim().length < 12}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-flame text-[13.5px] font-semibold text-[#18191B] transition-colors hover:bg-[#F09A55] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Masuk
            </button>
          </form>
          </details>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative isolate min-h-screen bg-charcoal">
      <AppAmbient />
      <header className="sticky top-0 z-20 border-b border-white/8 bg-charcoal/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="AethinkAI home"><Wordmark /></Link>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 font-mono text-[12px] text-ash sm:flex">
              <KeyRound size={11} /> {me?.key?.prefix ?? "belum ada key"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="grid size-11 place-items-center rounded-lg border border-white/10 text-ash transition hover:bg-white/[0.05] hover:text-warm"
              aria-label="Perbarui data"
              title="Perbarui data"
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex h-11 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[12.5px] text-ash transition hover:bg-white/[0.05] hover:text-warm"
            >
              <LogOut size={13} /> Keluar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 sm:px-6">
        {payNotice ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-flame/30 bg-flame/[0.08] px-4 py-3">
            <p className="text-[12.5px] text-warm">{payNotice}</p>
            <button type="button" onClick={() => setPayNotice(null)} className="text-[12px] text-dim hover:text-warm">
              Tutup
            </button>
          </div>
        ) : null}
        {fresh ? (
          <div className="mb-4 rounded-xl border border-flame/40 bg-flame/10 p-4">
            <p className="text-[12.5px] font-semibold text-warm">Key baru, simpan sekarang, tidak ditampilkan lagi</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-panel p-2 font-mono text-[12px] text-flame">{fresh}</code>
              <button
                type="button"
                aria-label="Salin API key"
                onClick={() => { navigator.clipboard?.writeText(fresh).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="grid size-9 place-items-center rounded-lg border border-white/10 text-warm"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-xl border border-flame/40 bg-flame/10 px-3 py-2 text-[12.5px] text-flame">{error}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-warm sm:text-[28px]">Dashboard</h1>
            <p className="mt-1.5 max-w-[52ch] text-[13px] leading-6 text-ash">
              Pantau saldo, API key, dan aktivitas penggunaan API Anda.
            </p>
          </div>
          <a
            href="#isi-saldo"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-flame px-4 text-[12.5px] font-semibold text-[#18191B] transition hover:bg-[#F09A55]"
          >
            <Wallet size={14} aria-hidden /> Isi Saldo
          </a>
        </div>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Ringkasan akun">
          {[
            { icon: Wallet, label: "Saldo Kredit", value: idr(me?.balance_micro ?? 0), note: "Tersedia untuk penggunaan API" },
            { icon: Activity, label: "Total Request", value: compact(me?.lifetime.requests ?? 0), note: "Sejak akun dibuat" },
            { icon: BarChart3, label: "Token Terpakai", value: compact((me?.lifetime.tokens_in ?? 0) + (me?.lifetime.tokens_out ?? 0)), note: "Input dan output" },
            { icon: Timer, label: "Batas Permintaan", value: `${me?.key?.rpm_limit ?? "n/a"} RPM`, note: "Per API key" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/8 bg-panel p-4 sm:p-5">
              <item.icon size={15} className="text-dim" aria-hidden />
              <p className="mt-2.5 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm tabular-nums sm:text-[26px]">
                {item.value}
              </p>
              <p className="mt-2 text-[12px] font-medium text-ash">{item.label}</p>
              <p className="mt-0.5 text-[12px] text-dim">{item.note}</p>
            </div>
          ))}
        </section>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
          <section className="rounded-xl border border-white/8 bg-panel p-4 sm:p-5" aria-label="Aktivitas API">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-warm">Aktivitas API</h2>
                <p className="mt-0.5 text-[12px] text-ash">Biaya penggunaan API berdasarkan periode.</p>
              </div>
              <div className="flex gap-1 rounded-lg border border-white/8 p-0.5" role="tablist" aria-label="Rentang aktivitas">
                {[7, 30, 90].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={days === value}
                    onClick={() => setDays(value)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12px] transition",
                      days === value ? "bg-white/[0.10] text-warm" : "text-ash hover:text-warm",
                    )}
                  >
                    {value} Hari
                  </button>
                ))}
              </div>
            </div>
            {(usage?.daily ?? []).length ? (
              <div className="mt-4 flex h-[270px] items-end gap-1">
                {(usage?.daily ?? []).map((day) => (
                  <div key={day.day} className="group relative flex h-full flex-1 items-end" title={`${day.day} · ${idr(day.cost_micro)}`}>
                    <div
                      className="w-full rounded-sm bg-[linear-gradient(180deg,#E7893C,#9C542F)] opacity-80 transition group-hover:opacity-100"
                      style={{ height: `${Math.max(4, (day.cost_micro / maxDay) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 grid h-[180px] place-items-center px-6 text-center">
                <div>
                  <Activity size={16} className="mx-auto text-dim" aria-hidden />
                  <p className="mt-2 text-[13px] font-medium text-warm">Belum ada aktivitas API</p>
                  <p className="mt-1 text-[12px] leading-5 text-ash">
                    Grafik akan tersedia setelah permintaan API pertama berhasil diproses.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-white/8 bg-panel p-4 sm:p-5" aria-label="API key">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-warm">API Key Anda</h2>
              <span className={cn(
                "rounded-md px-2 py-0.5 text-[12px]",
                (me?.keys ?? []).some((key) => key.status === "active")
                  ? "bg-ok/35 text-ok"
                  : "bg-white/[0.06] text-ash",
              )}>
                {(me?.keys ?? []).some((key) => key.status === "active") ? "Aktif" : "Tidak Aktif"}
              </span>
            </div>

            {(me?.keys ?? []).length ? (
              <div className="mt-3 space-y-2">
                {(me?.keys ?? []).map((key) => (
                  <div key={key.id} className="rounded-xl border border-white/8 bg-panel px-3 py-2.5">
                    <p className="font-mono text-[12px] text-warm">{key.prefix}••••••••</p>
                    <dl className="mt-1.5 space-y-1 text-[12px]">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-ash">Batas</dt>
                        <dd className="tabular-nums text-warm">{key.rpm_limit} RPM</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-ash">Terakhir digunakan</dt>
                        <dd className="text-warm">{key.last_used_at ? when(key.last_used_at) : "Belum pernah"}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-4 text-[12px] leading-5 text-ash">
                Belum ada API key. Selesaikan pembelian, key dikirim ke bot Telegram.
              </p>
            )}

            <div className="mt-4">
              {rotStep === "idle" ? (
                <button
                  type="button"
                  disabled={busy || !(me?.keys ?? []).length}
                  onClick={() => void rotate()}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-[12px] text-warm transition hover:bg-white/[0.04] disabled:opacity-40"
                >
                  <RefreshCw size={12} aria-hidden /> Rotasi API Key
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] text-flame">{rotMsg}</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={rotCode}
                      onChange={(event) => setRotCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      onKeyDown={(event) => event.key === "Enter" && void confirmRotate()}
                      placeholder="kode dari bot"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      aria-label="Kode verifikasi rotasi"
                      className="h-10 w-32 rounded-xl border border-white/10 bg-panel px-2 text-center font-mono text-[13px] text-warm focus:border-flame focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || rotCode.trim().length < 4}
                      onClick={() => void confirmRotate()}
                      className="h-10 rounded-xl bg-flame px-3 text-[12px] font-semibold text-[#18191B] disabled:opacity-40"
                    >
                      {busy ? "Memproses" : "Konfirmasi"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRotStep("idle"); setRotCode(""); setRotMsg(""); }}
                      className="h-10 rounded-xl border border-white/10 px-3 text-[12px] text-ash"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-3 text-[12px] leading-5 text-ash">
                Mengganti key lama dengan key baru. Saldo dan riwayat akun tetap tersimpan. Verifikasi dikirim
                melalui bot Telegram.
              </p>
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-xl border border-white/8 bg-panel" aria-label="Penggunaan per model">
          <div className="border-b border-white/8 px-4 py-3">
            <h2 className="text-[15px] font-semibold text-warm">Penggunaan Model</h2>
            <p className="mt-0.5 text-[12px] text-ash">Ringkasan penggunaan selama {days} hari terakhir.</p>
          </div>
          {(models?.models ?? []).length ? (
            <div className="divide-y divide-white/6">
              {(models?.models ?? []).map((model) => (
                <div key={model.model_id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] text-warm">{model.model_id}</p>
                    <p className="mt-0.5 text-[12px] text-dim">
                      {model.requests} permintaan · {compact(model.tokens_in + model.tokens_out)} token
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-warm">{idr(model.cost_micro)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid h-[140px] place-items-center px-6 text-center">
              <div>
                <BarChart3 size={16} className="mx-auto text-dim" aria-hidden />
                <p className="mt-2 text-[13px] font-medium text-warm">Belum ada penggunaan model</p>
                <p className="mt-1 text-[12px] leading-5 text-ash">
                  Statistik akan muncul setelah permintaan API pertama berhasil diproses.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-panel" aria-label="Permintaan terbaru">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
            <div>
              <h2 className="text-[15px] font-semibold text-warm">Riwayat Request</h2>
              <p className="mt-0.5 text-[12px] text-ash">Hingga 40 permintaan terbaru.</p>
            </div>
            <Link to="/panduan" className="text-[12px] text-ash transition hover:text-warm">Panduan API</Link>
          </div>
          {(requests?.requests ?? []).length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-white/8 text-[12px] text-dim">
                    <th className="px-4 py-2.5 font-medium">Waktu</th>
                    <th className="px-4 py-2.5 font-medium">Model</th>
                    <th className="px-4 py-2.5 text-right font-medium">Token</th>
                    <th className="px-4 py-2.5 text-right font-medium">Biaya</th>
                    <th className="px-4 py-2.5 text-right font-medium">Latensi</th>
                    <th className="px-4 py-2.5 font-medium">IP</th>
                    <th className="px-4 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(requests?.requests ?? []).map((request) => (
                    <tr key={request.request_id} className="border-b border-white/6 text-[12px] transition last:border-0 hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-4 py-2.5 text-ash">{when(request.created_at)}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-warm">{request.model_id}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ash">{request.tokens_in}/{request.tokens_out}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-warm">{idr(request.cost_micro)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ash">{request.latency_ms} ms</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ash">{request.client_ip ?? "n/a"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn(
                          "rounded-md px-1.5 py-0.5 text-[12px]",
                          request.status === "ok" ? "bg-ok/35 text-ok" : "bg-white/[0.06] text-ash",
                        )}>
                          {request.status === "ok" ? "ok" : request.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid h-[160px] place-items-center px-6 text-center">
              <div>
                <Receipt size={16} className="mx-auto text-dim" aria-hidden />
                <p className="mt-2 text-[13px] font-medium text-warm">Belum ada request tercatat</p>
                <p className="mt-1 text-[12px] leading-5 text-ash">
                  Riwayat request akan tampil setelah Anda mulai menggunakan API.
                </p>
              </div>
            </div>
          )}
        </section>

        <StorePanel
          token={token}
          onChanged={() => void load()}
          onPurchase={startPurchase}
          pending={pending}
          onShowPending={() => setPayOpen(true)}
          refreshKey={ordersKey}
        />

        <p className="mt-6 text-center text-[12px] text-ash">
          Saldo dan statistik diperbarui berdasarkan data penggunaan akun Anda.
        </p>

        {checkout ? (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <div className="w-full max-w-[430px] rounded-xl border border-white/10 bg-panel p-5">
              <h2 id="checkout-title" className="text-[16px] font-semibold text-warm">Konfirmasi pembelian</h2>
              <p className="mt-1 text-[12.5px] leading-5 text-ash">
                Periksa nominalnya. QRIS tidak dibuat di langkah ini, jadi tidak ada permintaan ke penyedia pembayaran sampai kamu menekan Buat QRIS.
              </p>
              <dl className="mt-4 space-y-2 rounded-xl border border-white/8 bg-panel p-4 text-[12.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-dim">{checkout.kind === "plan" ? "Paket" : "Isi saldo"}</dt>
                  <dd className="font-medium text-warm">{checkout.kind === "plan" ? checkout.name : rp(checkout.amount)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-dim">Harga</dt>
                  <dd className="font-semibold tabular-nums text-warm">{rp(checkout.kind === "plan" ? checkout.price_idr : checkout.amount)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-dim">Kredit masuk</dt>
                  <dd className="tabular-nums text-ash">{rp((checkout.kind === "plan" ? checkout.credits_micro : checkout.amount * 1_000_000) / 1_000_000)}</dd>
                </div>
                {checkout.kind === "plan" ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-dim">Batas permintaan</dt>
                    <dd className="tabular-nums text-ash">{checkout.rpm} RPM</dd>
                  </div>
                ) : null}
              </dl>
              {payError ? <p className="mt-3 text-[12px] text-flame">{payError}</p> : null}
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setCheckout(null)} disabled={payBusy}
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[12.5px] font-medium text-warm transition hover:bg-white/[0.06] disabled:opacity-50">
                  Batal
                </button>
                <button type="button" onClick={() => void confirmPurchase()} disabled={payBusy}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-flame px-4 text-[12.5px] font-semibold text-[#18191B] transition hover:bg-[#F09A55] disabled:opacity-50">
                  {payBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                  Lanjutkan
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pending && payOpen ? (
          <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="pay-title">
            <div className="w-full max-w-[440px] rounded-xl border border-white/10 bg-panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="pay-title" className="text-[16px] font-semibold text-warm">Pembayaran</h2>
                  <p className="mt-0.5 font-mono text-[12px] text-dim">{pending.order_id}</p>
                </div>
                <button type="button" onClick={() => { setCancelAsk(false); setPayOpen(false); }} aria-label="Minimalkan pembayaran"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-dim transition hover:text-warm">
                  <Minus size={15} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full border px-2.5 py-1 text-[12px] font-medium",
                  pending.payment.live
                    ? "border-flame/40 bg-flame/10 text-flame"
                    : "border-white/10 bg-white/[0.03] text-dim")}>
                  {pending.payment.live ? "Menunggu pembayaran" : "QRIS belum dibuat"}
                </span>
                <span className="text-[12px] tabular-nums text-dim">
                  {pending.sku === "topup" ? "Isi saldo" : pending.sku}
                </span>
                {remaining && pending.payment.live ? (
                  <span className="text-[12px] tabular-nums text-dim">sisa {remaining}</span>
                ) : null}
              </div>

              <div className="mt-4 grid place-items-center rounded-xl border border-white/8 bg-panel p-4">
                <QrCode value={pending.payment.qr_string} image={pending.payment.qr_image} />
                <p className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-warm">
                  {rp(pending.payment.total_bayar)}
                </p>
                {pending.payment.fee_idr > 0 ? (
                  <p className="mt-1 text-[12px] text-dim">
                    termasuk biaya layanan {rp(pending.payment.fee_idr)}
                  </p>
                ) : null}
                <p className="mt-2 max-w-[300px] text-center text-[12px] leading-5 text-ash">
                  {pending.payment.live
                    ? "Scan dengan aplikasi bank atau e-wallet. Status diperbarui otomatis setelah pembayaran diterima."
                    : "Tekan Buat QRIS untuk meminta kode pembayaran. Satu akun hanya boleh punya satu pembayaran berjalan."}
                </p>
              </div>

              {payError ? <p className="mt-3 text-[12px] text-flame">{payError}</p> : null}

              {cancelAsk ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-panel p-3">
                  <p className="text-[12px] leading-5 text-ash">
                    Batalkan pembayaran ini? QRIS yang sudah tampil tidak bisa dipakai lagi, dan kamu bisa membuat yang baru.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => setCancelAsk(false)} disabled={payBusy}
                      className="h-10 rounded-lg border border-white/10 px-3 text-[12px] text-warm disabled:opacity-50">
                      Kembali
                    </button>
                    <button type="button" onClick={() => void cancelPayment()} disabled={payBusy}
                      className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-flame px-3 text-[12px] font-semibold text-[#18191B] disabled:opacity-50">
                      {payBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                      Ya, batalkan
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {pending.payment.live ? (
                    <button type="button" onClick={() => void copyQr()}
                      className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.03] text-[12.5px] font-medium text-warm transition hover:bg-white/[0.06]">
                      {copiedQr ? "Kode disalin" : "Salin kode QR"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void createQr()} disabled={payBusy}
                      className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-flame text-[12.5px] font-semibold text-[#18191B] transition hover:bg-[#F09A55] disabled:opacity-50">
                      {payBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                      Buat QRIS
                    </button>
                  )}
                  <button type="button" onClick={() => setCancelAsk(true)} disabled={payBusy}
                    className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.03] text-[12.5px] font-medium text-ash transition hover:bg-white/[0.06] hover:text-warm disabled:opacity-50">
                    Batalkan pembayaran
                  </button>
                </div>
              )}
              <button type="button" onClick={() => { setCancelAsk(false); setPayOpen(false); }}
                className="mt-3 w-full text-center text-[12px] text-dim transition hover:text-warm">
                Minimalkan, lanjut lihat dashboard
              </button>
            </div>
          </div>
        ) : null}

        {pending && !payOpen ? (
          <div className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-[380px] rounded-xl border border-flame/30 bg-panel/95 p-3 backdrop-blur-xl sm:inset-x-auto sm:right-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-flame">
                  <span className="h-1.5 w-1.5 rounded-full bg-flame" />
                  {pending.payment.live ? "Pembayaran menunggu" : "Pembayaran belum selesai"}
                </p>
                <p className="mt-0.5 truncate font-mono text-[12px] text-dim">{pending.order_id}</p>
                <p className="mt-0.5 text-[12px] tabular-nums text-ash">{rp(pending.payment.total_bayar)}</p>
              </div>
              <button type="button" onClick={() => setPayOpen(true)}
                className="h-9 shrink-0 rounded-lg bg-flame px-3 text-[12px] font-semibold text-[#18191B] transition hover:bg-[#F09A55]">
                Lihat Invoice
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
