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
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Wordmark } from "@/components/layout/BrandLogo";
import { TelegramConnect } from "@/components/portal/TelegramConnect";
import { createPayment, fetchOrders, fetchPackages, placeOrder, type Pkg, type PortalOrder } from "@/lib/portal";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";

/**
 * Buyer portal — no email, no password. A purchaser pastes the API key they got from the
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

const idr = (micro: number) => {
  const v = Number(micro || 0) / 1_000_000;
  return `Rp ${v.toLocaleString("id-ID", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
};
const compact = (n: number) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
};
const when = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
};

function StorePanel({ token, onChanged }: { token: string; onChanged: () => void }) {
  const navigate = useNavigate();
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setPackages(await fetchPackages()); } catch { /* keep empty */ }
    try { setOrders(await fetchOrders(token)); } catch { /* session may be key-only */ }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const buy = async (sku: string) => {
    setBusy(sku);
    setNotice(null);
    try {
      const order = await placeOrder(token, sku);
      setNotice(`Order ${order.order_id} dibuat — lanjut ke pembayaran QRIS…`);
      await refresh();
      onChanged();
      try {
        const pay = await createPayment(token, order.order_id);
        navigate(`/pay/${order.order_id}?t=${encodeURIComponent(pay.checkout_token)}`);
      } catch (err) {
        // provider unavailable: fall back to the manual/admin flow, order stays pending
        setNotice(`Order ${order.order_id} dibuat (${idr(order.price_idr * 1_000_000)}). ` +
          "Pembayaran otomatis belum aktif — hubungi admin, key dikirim ke bot Telegram." +
          (err instanceof Error ? ` (${err.message})` : ""));
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal membuat order");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#FAF8F4]">Beli paket</h2>
        <p className="text-[11px] text-[#85888B]">Bayar Rupiah, saldo dipotong per token.</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {packages.map((p) => (
          <div key={p.sku} className="rounded-lg border border-[#3A3B3D] bg-[#141518] p-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-semibold text-[#FAF8F4]">{p.name}</p>
              <p className="text-[12px] tabular-nums text-[#E7893C]">{idr(p.credits_micro)}</p>
            </div>
            <p className="mt-1 text-[11px] text-[#85888B]">{p.rpm} req/menit · {p.blurb}</p>
            <button
              type="button"
              onClick={() => void buy(p.sku)}
              disabled={busy !== null}
              className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[#E7893C] text-[12px] font-semibold text-[#18191B] transition hover:bg-[#F09A55] disabled:opacity-50"
            >
              {busy === p.sku ? <Loader2 size={12} className="animate-spin" /> : null} Beli
            </button>
          </div>
        ))}
      </div>
      {notice ? (
        <p className="mt-3 rounded-md border border-[#E7893C]/35 bg-[#E7893C]/10 px-3 py-2 text-[11.5px] leading-5 text-[#E7893C]">
          {notice}
        </p>
      ) : null}
      {orders.length ? (
        <div className="mt-3 divide-y divide-[#2A2B2E] rounded-lg border border-[#3A3B3D]">
          {orders.slice(0, 5).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={async () => {
                setReceiptBusy(o.id);
                try {
                  const res = await fetch(`/api/portal/orders/${encodeURIComponent(o.id)}/receipt`, {
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
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left transition hover:bg-[#22242a]"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-[#FAF8F4]">{o.id}</p>
                <p className="text-[10.5px] text-[#85888B]">
                  {o.sku} · {idr(o.price_idr * 1_000_000)}
                  {receiptBusy === o.id ? " · memuat…" : " · lihat invoice"}
                </p>
              </div>
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10.5px]",
                o.status === "granted" ? "bg-[#E7893C]/12 text-[#E7893C]" : "bg-[#FAF8F4]/6 text-[#85888B]")}>
                {o.status}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {receipt ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
          onClick={() => setReceipt(null)}
        >
          <div
            className="w-full max-w-[440px] rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">Invoice</p>
                <p className="mt-1 font-mono text-[14px] text-[#FAF8F4]">{String(receipt.invoice_id)}</p>
              </div>
              <button type="button" onClick={() => setReceipt(null)} className="text-[11.5px] text-[#85888B] hover:text-[#FAF8F4]">
                tutup
              </button>
            </div>
            <div className="mt-4 space-y-1.5 text-[12px]">
              {(() => {
                const pkg = receipt.package as { sku?: string; name?: string; rpm_limit?: number } | undefined;
                const amount = receipt.amount as { price_idr?: number; credits_idr?: number } | undefined;
                const used = receipt.usage_since_issue as { requests?: number; tokens_in?: number; tokens_out?: number } | undefined;
                const rows: Array<[string, string]> = [
                  ["Paket", `${pkg?.name ?? pkg?.sku ?? "—"} · ${pkg?.rpm_limit ?? "—"} rpm`],
                  ["Dibayar", `Rp ${Number(amount?.price_idr ?? 0).toLocaleString("id-ID")}`],
                  ["Kredit masuk", `Rp ${Number(amount?.credits_idr ?? 0).toLocaleString("id-ID")}`],
                  ["Status", String(receipt.status)],
                  ["Terbit", when(String(receipt.issued_at))],
                  ["Dibayar", receipt.paid_at ? when(String(receipt.paid_at)) : "—"],
                  ["Saldo sekarang", idr(Number(receipt.balance_micro ?? 0))],
                  ["Pemakaian sejak invoice", `${used?.requests ?? 0} req · ${(used?.tokens_in ?? 0) + (used?.tokens_out ?? 0)} token`],
                ];
                return rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-b border-[#23252A] pb-1.5 last:border-0">
                    <span className="text-[#85888B]">{k}</span>
                    <span className="text-right font-mono text-[11.5px] text-[#FAF8F4]">{v}</span>
                  </div>
                ));
              })()}
            </div>
            <p className="mt-3 text-[10.5px] leading-5 text-[#6f6a63]">{String(receipt.note ?? "")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function usePortalApi(token: string | null, onInvalid: () => void) {
  return useCallback(
    async <T,>(path: string): Promise<T> => {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (res.status === 401) {
        onInvalid();
        throw new Error("Sesi habis — tempel ulang API key");
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

  if (!token) {
    return (
      <div className="relative grid min-h-screen place-items-center px-4 py-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_50%_-10%,rgba(231,137,60,0.10),transparent_65%)]" />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-[460px] rounded-2xl border border-[#3A3B3D] bg-[#1B1C1F] p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.9)]"
        >
          <Link to="/" className="inline-flex"><Wordmark /></Link>
          <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[#FAF8F4]">Masuk ke portal</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-[#85888B]">
            Pakai Telegram — nggak ada email atau password. Akun otomatis kedetect dari bot,
            dan semua pembelian tercatat di sana.
          </p>

          <div className="mt-5">
            <TelegramConnect
              onToken={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }}
            />
          </div>

          <details className="mt-5 rounded-lg border border-[#3A3B3D] bg-[#141518]/60 p-3">
            <summary className="cursor-pointer text-[12px] text-[#85888B] marker:content-none">
              Punya API key? Tempel di sini
            </summary>
          <form onSubmit={openSession} className="mt-3 space-y-3">
            <label htmlFor="apikey" className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#85888B]">API key</label>
            <div className="relative">
              <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#85888B]" />
              <input
                id="apikey"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(null); }}
                placeholder="sk-aeth_…"
                spellCheck={false}
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-[#3A3B3D] bg-[#141518] pl-9 pr-3 font-mono text-[13px] text-[#FAF8F4] placeholder:text-[#85888B]/60 focus:border-[#E7893C]/60 focus:outline-none focus:ring-2 focus:ring-[#E7893C]/20"
              />
            </div>
            {error ? (
              <p className="flex items-start gap-1.5 text-[12px] text-[#E7893C]">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" /> {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || apiKey.trim().length < 12}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#E7893C] text-[13.5px] font-semibold text-[#18191B] transition-colors hover:bg-[#F09A55] disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="min-h-screen bg-[#18191B]">
      <header className="sticky top-0 z-20 border-b border-[#2A2B2E] bg-[#18191B]/90 backdrop-blur-md">
        <div className="mx-auto flex h-[64px] max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/"><Wordmark /></Link>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-[#3A3B3D] px-2.5 py-1 text-[11px] text-[#85888B] sm:flex">
              <KeyRound size={11} /> {me?.key?.prefix ?? "belum ada key"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="grid size-9 place-items-center rounded-lg border border-[#3A3B3D] text-[#85888B] transition hover:bg-[#292B2E] hover:text-[#FAF8F4]"
              aria-label="Muat ulang"
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#3A3B3D] px-3 text-[12.5px] text-[#85888B] transition hover:bg-[#292B2E] hover:text-[#FAF8F4]"
            >
              <LogOut size={13} /> Keluar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] space-y-5 px-4 py-6 sm:px-6">
        {fresh ? (
          <div className="rounded-xl border border-[#E7893C]/40 bg-[#E7893C]/10 p-4">
            <p className="text-[12.5px] font-semibold text-[#FAF8F4]">Key baru — simpan sekarang, tidak ditampilkan lagi</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-[#141518] p-2 font-mono text-[12px] text-[#E7893C]">{fresh}</code>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(fresh).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="grid size-9 place-items-center rounded-lg border border-[#3A3B3D] text-[#FAF8F4]"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="rounded-lg border border-[#E7893C]/40 bg-[#E7893C]/10 px-3 py-2 text-[12.5px] text-[#E7893C]">{error}</p> : null}

        <StorePanel token={token} onChanged={() => void load()} />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Wallet, label: "Sisa kredit", value: idr(me?.balance_micro ?? 0) },
            { icon: Activity, label: "Request total", value: compact(me?.lifetime.requests ?? 0) },
            { icon: BarChart3, label: "Token terpakai", value: compact((me?.lifetime.tokens_in ?? 0) + (me?.lifetime.tokens_out ?? 0)) },
            { icon: Gift, label: "RPM", value: String(me?.key?.rpm_limit ?? "—") },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
              <s.icon size={14} className="text-[#85888B]" />
              <p className="mt-2 text-[19px] font-semibold tabular-nums text-[#FAF8F4]">{s.value}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-[#85888B]">{s.label}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[#FAF8F4]">Pemakaian harian</h2>
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={cn("rounded-md px-2 py-1 text-[11px] transition", days === d ? "bg-[#292B2E] text-[#FAF8F4]" : "text-[#85888B] hover:text-[#FAF8F4]")}
                >
                  {d}h
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex h-28 items-end gap-1">
            {(usage?.daily ?? []).length ? (
              usage!.daily.map((d) => (
                <div key={d.day} className="group relative flex-1" title={`${d.day} · ${idr(d.cost_micro)}`}>
                  <div
                    className="w-full rounded-sm bg-[linear-gradient(180deg,#E7893C,#9C542F)] opacity-80 transition group-hover:opacity-100"
                    style={{ height: `${Math.max(4, (d.cost_micro / maxDay) * 100)}%` }}
                  />
                </div>
              ))
            ) : (
              <p className="text-[12px] text-[#85888B]">Belum ada pemakaian pada rentang ini.</p>
            )}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-[#3A3B3D] bg-[#1B1C1F]">
            <h2 className="border-b border-[#2A2B2E] px-4 py-3 text-[13px] font-semibold text-[#FAF8F4]">Per model</h2>
            <div className="divide-y divide-[#2A2B2E]">
              {(models?.models ?? []).length ? models!.models.map((m) => (
                <div key={m.model_id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] text-[#FAF8F4]">{m.model_id}</p>
                    <p className="text-[11px] text-[#85888B]">{m.requests} req · {compact(m.tokens_in + m.tokens_out)} token</p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-[#FAF8F4]">{idr(m.cost_micro)}</span>
                </div>
              )) : <p className="px-4 py-6 text-[12px] text-[#85888B]">Belum ada request.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-[#3A3B3D] bg-[#1B1C1F]">
            <h2 className="border-b border-[#2A2B2E] px-4 py-3 text-[13px] font-semibold text-[#FAF8F4]">Key saya</h2>
            <div className="divide-y divide-[#2A2B2E]">
              {(me?.keys ?? []).map((k) => (
                <div key={k.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="font-mono text-[12px] text-[#FAF8F4]">{k.prefix}…</p>
                    <p className="text-[11px] text-[#85888B]">{k.label ?? "key"} · {k.rpm_limit} rpm · dipakai {when(k.last_used_at)}</p>
                  </div>
                  <span className={cn("rounded-md px-2 py-0.5 text-[10.5px]", k.status === "active" ? "bg-[#E7893C]/12 text-[#E7893C]" : "bg-[#FAF8F4]/5 text-[#85888B]")}>
                    {k.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-[#2A2B2E] p-4">
              {rotStep === "idle" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void rotate()}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-[#3A3B3D] px-3 text-[12.5px] text-[#FAF8F4]/85 transition hover:bg-[#292B2E] disabled:opacity-50"
                >
                  <RefreshCw size={12} /> Rotasi key
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11.5px] text-[#E7893C]">{rotMsg}</p>
                  <div className="flex gap-2">
                    <input
                      value={rotCode}
                      onChange={(event) => setRotCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      onKeyDown={(event) => event.key === "Enter" && void confirmRotate()}
                      placeholder="kode dari bot"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="h-9 w-32 rounded-lg border border-[#3A3B3D] bg-[#141518] px-2 text-center font-mono text-[13px] tracking-[0.2em] text-[#FAF8F4] focus:border-[#E7893C] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || rotCode.trim().length < 4}
                      onClick={() => void confirmRotate()}
                      className="h-9 rounded-lg bg-[#E7893C] px-3 text-[12.5px] font-medium text-[#141518] disabled:opacity-50"
                    >
                      {busy ? "Memproses…" : "Konfirmasi"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRotStep("idle"); setRotCode(""); setRotMsg(""); }}
                      className="h-9 rounded-lg border border-[#3A3B3D] px-3 text-[12.5px] text-[#85888B]"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-[11px] text-[#85888B]">
                Rotasi mematikan key lama seketika, saldo tetap, dan key baru ditampilkan satu kali.
                Kode verifikasi dikirim ke chat bot — atau ketik /rotate di bot.
              </p>
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-xl border border-[#3A3B3D] bg-[#1B1C1F]">
          <h2 className="border-b border-[#2A2B2E] px-4 py-3 text-[13px] font-semibold text-[#FAF8F4]">Request terakhir</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-[#2A2B2E] text-[10.5px] uppercase tracking-[0.1em] text-[#85888B]">
                  <th className="px-4 py-2 font-medium">Waktu</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 text-right font-medium">Token</th>
                  <th className="px-4 py-2 text-right font-medium">Biaya</th>
                  <th className="px-4 py-2 text-right font-medium">Latency</th>
                  <th className="px-4 py-2 font-medium">IP</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(requests?.requests ?? []).map((r) => (
                  <tr key={r.request_id} className="border-b border-[#2A2B2E]/60 text-[12px] last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-[#85888B]">{when(r.created_at)}</td>
                    <td className="px-4 py-2 font-mono text-[11.5px] text-[#FAF8F4]">{r.model_id}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#85888B]">{r.tokens_in}/{r.tokens_out}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#FAF8F4]">{idr(r.cost_micro)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#85888B]">{r.latency_ms}ms</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-[#85888B]">{r.client_ip ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10.5px]", r.status === "ok" ? "bg-[#E7893C]/12 text-[#E7893C]" : "bg-[#FAF8F4]/6 text-[#85888B]")}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!(requests?.requests ?? []).length ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-[12px] text-[#85888B]">Belum ada request tercatat.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
