import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/common/Button";
import {
  Ban,
  Check,
  Copy,
  CreditCard,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import {
  adminAuthFailures,
  adminBuyerDetail,
  adminBuyers,
  adminCreditBuyer,
  adminAccessKeys,
  adminOrders,
  adminPatchKey,
  adminRotateKey,
  type GwAccessKey,
  type GwAuthFailure,
  type GwBuyer,
  type GwBuyerDetail,
  type GwOrder,
} from "@/lib/gw";
import { cn } from "@/lib/cn";

const idr = (micro: number) => {
  const v = Number(micro || 0) / 1_000_000;
  return `Rp ${v.toLocaleString("id-ID", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
};
const when = (iso: string | null) => {
  if (!iso) return "n/a";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

type Tab = "buyers" | "keys" | "orders" | "security";

export default function AccessPage() {
  const [tab, setTab] = useState<Tab>("keys");
  const [buyers, setBuyers] = useState<GwBuyer[]>([]);
  const [keys, setKeys] = useState<GwAccessKey[]>([]);
  const [orders, setOrders] = useState<GwOrder[]>([]);
  const [failures, setFailures] = useState<GwAuthFailure[]>([]);
  const [detail, setDetail] = useState<GwBuyerDetail | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creditFor, setCreditFor] = useState<GwBuyer | null>(null);
  const [creditAmount, setCreditAmount] = useState("50000");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (tab === "buyers") setBuyers((await adminBuyers(query)).buyers);
      if (tab === "keys") setKeys((await adminAccessKeys({ status: statusFilter, q: query })).keys);
      if (tab === "orders") setOrders((await adminOrders()).orders);
      if (tab === "security") setFailures((await adminAuthFailures()).failures);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal memuat");
    } finally {
      setBusy(false);
    }
  }, [tab, query, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(
    () => ({
      active: keys.filter((k) => k.status === "active").length,
      suspended: keys.filter((k) => k.status === "suspended").length,
      spend: keys.reduce((sum, k) => sum + k.spend_micro, 0),
      requests: keys.reduce((sum, k) => sum + k.requests, 0),
    }),
    [keys],
  );

  const patch = async (id: string, body: { rpm_limit?: number; status?: string; label?: string }) => {
    setBusy(true);
    try {
      await adminPatchKey(id, body);
      setKeys((rows) => rows.map((r) => (r.id === id ? { ...r, ...body } as GwAccessKey : r)));
      setNotice("Key diperbarui");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (id: string) => {
    setBusy(true);
    try {
      const res = await adminRotateKey(id);
      setNewKey(res.api_key);
      setNotice("Key baru dibuat, key lama dicabut");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal rotasi");
    } finally {
      setBusy(false);
    }
  };

  const credit = async () => {
    if (!creditFor) return;
    setBusy(true);
    try {
      await adminCreditBuyer(creditFor.id, Number(creditAmount));
      setNotice(`Kredit ${idr(Number(creditAmount) * 1_000_000)} ditambahkan ke ${creditFor.username ?? creditFor.tg_id}`);
      setCreditFor(null);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal menambah kredit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Akses & key"
        description="Bot yang menjual, gateway yang mencatat. Semua key aktif di sini."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Akses" }]}
        actions={
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={13} />} onClick={() => void load()} disabled={busy}>
            Muat ulang
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Key aktif" value={totals.active} icon={KeyRound} />
        <StatCard label="Disuspend" value={totals.suspended} icon={Ban} />
        <StatCard label="Pemakaian" value={totals.spend} format={(v) => idr(v)} icon={Wallet} />
        <StatCard label="Request" value={totals.requests} icon={Users} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-ash/15 pb-2">
        {([
          ["keys", "Key"],
          ["buyers", "Pembeli"],
          ["orders", "Order"],
          ["security", "Keamanan"],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id); setDetail(null); }}
            className={cn(
              "h-8 cursor-pointer rounded-lg px-3 text-[12.5px] font-medium transition",
              tab === id ? "bg-flame/12 text-flame" : "text-ash hover:bg-warm/[0.05] hover:text-warm",
            )}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {tab === "keys" ? (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg border border-ash/25 bg-panel px-2 text-[12px] text-warm focus:border-flame/50 focus:outline-none"
            >
              <option value="">Semua status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="revoked">Revoked</option>
            </select>
          ) : null}
          {tab !== "security" ? (
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ash" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="cari…"
                className="h-8 w-[190px] rounded-lg border border-ash/25 bg-panel pl-8 pr-2 text-[12px] text-warm placeholder:text-ash/60 focus:border-flame/50 focus:outline-none"
              />
            </div>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p className="rounded-lg border border-flame/30 bg-flame/[0.07] px-3 py-2 text-[12px] text-flame">{notice}</p>
      ) : null}

      {newKey ? (
        <div className="rounded-xl border border-flame/40 bg-flame/[0.08] p-3.5">
          <p className="text-[12px] font-semibold text-warm">Key baru, kirim ke pembeli sekarang</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-[#0f1012] p-2 font-mono text-[12px] text-flame">{newKey}</code>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(newKey).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="grid size-8 place-items-center rounded-lg border border-ash/30 text-warm"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button type="button" onClick={() => setNewKey(null)} className="text-[12px] text-ash hover:text-warm">tutup</button>
          </div>
        </div>
      ) : null}

      {tab === "keys" ? (
        <div className="surface overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-ash/15 bg-warm/[0.02] text-[12px] text-ash">
                  <th className="px-4 py-2.5 font-medium">Key</th>
                  <th className="px-4 py-2.5 font-medium">Pembeli</th>
                  <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-4 py-2.5 text-right font-medium">Req</th>
                  <th className="px-4 py-2.5 font-medium">RPM</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Terakhir</th>
                  <th className="px-4 py-2.5 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-ash/10 text-[12px] last:border-0 hover:bg-warm/[0.02]">
                    <td className="px-4 py-2.5">
                      <p className="font-mono text-[12px] text-warm">{k.prefix}…</p>
                      <p className="text-[12px] text-ash">{k.label ?? k.name}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      {k.buyer_id ? (
                        <button
                          type="button"
                          onClick={async () => setDetail(await adminBuyerDetail(k.buyer_id!))}
                          className="text-left text-[12px] text-warm hover:text-flame"
                        >
                          {k.username ? `@${k.username}` : `tg ${k.tg_id ?? "n/a"}`}
                          <span className="block text-[12px] text-ash">{k.buyer_name ?? k.email}</span>
                        </button>
                      ) : (
                        <span className="text-[12px] text-ash">{k.email}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-warm">{idr(k.balance_micro)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-warm">{idr(k.spend_micro)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ash">{k.requests}</td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        defaultValue={k.rpm_limit}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v && v !== k.rpm_limit) void patch(k.id, { rpm_limit: v });
                        }}
                        className="h-8 w-[74px] rounded-md border border-ash/18 bg-panel px-2 text-[12px] tabular-nums text-warm focus:border-flame/50 focus:outline-none"
                      />
                      {k.rpm_override ? (
                        <span
                          className="ml-1 rounded-md bg-flame/12 px-1.5 py-0.5 text-[12px] text-flame"
                          title="RPM di-set manual oleh admin, pembelian paket tidak menimpanya"
                        >
                          custom
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-md px-2 py-0.5 text-[12px]",
                        k.status === "active" ? "bg-flame/12 text-flame" : "bg-warm/[0.06] text-ash")}>
                        {k.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-ash">{when(k.last_used_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void patch(k.id, { status: k.status === "active" ? "suspended" : "active" })}
                          className="h-8 rounded-md border border-ash/25 px-2 text-[12px] text-ash transition hover:border-flame/40 hover:text-warm"
                        >
                          {k.status === "active" ? "Suspend" : "Aktifkan"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void rotate(k.id)}
                          className="h-8 rounded-md border border-ash/25 px-2 text-[12px] text-ash transition hover:border-flame/40 hover:text-warm"
                        >
                          Rotate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!keys.length ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-[12px] text-ash">Belum ada key. Grant dari bot akan muncul di sini.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "buyers" ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="surface overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-ash/15 bg-warm/[0.02] text-[12px] text-ash">
                    <th className="px-4 py-2.5 font-medium">Pembeli</th>
                    <th className="px-4 py-2.5 text-right font-medium">Key</th>
                    <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                    <th className="px-4 py-2.5 text-right font-medium">Spend 30h</th>
                    <th className="px-4 py-2.5 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {buyers.map((b) => (
                    <tr key={b.id} className="border-b border-ash/10 text-[12px] last:border-0 hover:bg-warm/[0.02]">
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={async () => setDetail(await adminBuyerDetail(b.id))} className="text-left hover:text-flame">
                          <span className="text-warm">{b.username ? `@${b.username}` : b.name ?? "tanpa nama"}</span>
                          <span className="block text-[12px] text-ash">tg {b.tg_id ?? "n/a"}</span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ash">{b.keys_active}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-warm">{idr(b.balance_micro)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-warm">{idr(b.spend_micro)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setCreditFor(b)}
                          className="inline-flex items-center gap-1 rounded-md border border-ash/25 px-2 py-1 text-[12px] text-ash transition hover:border-flame/40 hover:text-warm"
                        >
                          <CreditCard size={11} /> kredit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!buyers.length ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-[12px] text-ash">Belum ada pembeli terdaftar.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="surface p-4">
            {detail ? (
              <div className="space-y-3">
                <div>
                  <p className="text-[12px] text-ash">Detail pembeli</p>
                  <p className="mt-1 text-[15px] font-semibold text-warm">
                    {detail.buyer.username ? `@${detail.buyer.username}` : detail.buyer.name ?? detail.buyer.id}
                  </p>
                  <p className="text-[12px] text-ash">tg {detail.buyer.tg_id ?? "n/a"} · {detail.buyer.status}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-lg border border-ash/15 p-2.5">
                    <p className="text-[12px] uppercase text-ash">Saldo</p>
                    <p className="text-warm">{idr(detail.balance_micro)}</p>
                  </div>
                  <div className="rounded-lg border border-ash/15 p-2.5">
                    <p className="text-[12px] uppercase text-ash">Spend 30h</p>
                    <p className="text-warm">{idr(detail.usage_30d.cost_micro)}</p>
                  </div>
                  <div className="rounded-lg border border-ash/15 p-2.5">
                    <p className="text-[12px] uppercase text-ash">Request</p>
                    <p className="text-warm">{detail.usage_30d.requests}</p>
                  </div>
                  <div className="rounded-lg border border-ash/15 p-2.5">
                    <p className="text-[12px] uppercase text-ash">Token in/out</p>
                    <p className="text-warm">{detail.usage_30d.tokens_in}/{detail.usage_30d.tokens_out}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[12px] text-ash">Key</p>
                  <ul className="mt-1 space-y-1">
                    {detail.keys.map((k) => (
                      <li key={k.id} className="flex items-center justify-between text-[12px]">
                        <span className="font-mono text-warm">{k.prefix}…</span>
                        <span className="text-ash">{k.rpm_limit} rpm · {k.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[12px] text-ash">Order</p>
                  <ul className="mt-1 space-y-1">
                    {detail.orders.map((o) => (
                      <li key={o.id} className="flex items-center justify-between text-[12px]">
                        <span className="text-warm">{o.sku} · {idr(o.credits_micro)}</span>
                        <span className="text-ash">{o.status}</span>
                      </li>
                    ))}
                    {!detail.orders.length ? <li className="text-[12px] text-ash">Belum ada order.</li> : null}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-ash">Pilih pembeli untuk melihat detail key dan order.</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="surface overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-ash/15 bg-warm/[0.02] text-[12px] text-ash">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Pembeli</th>
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 text-right font-medium">Kredit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Harga</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Waktu</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-ash/10 text-[12px] last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ash">{o.id}</td>
                    <td className="px-4 py-2.5 text-warm">{o.username ? `@${o.username}` : `tg ${o.tg_id ?? "n/a"}`}</td>
                    <td className="px-4 py-2.5 text-ash">{o.sku}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-warm">{idr(o.credits_micro)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ash">{idr(o.price_idr * 1_000_000)}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-md px-2 py-0.5 text-[12px]", o.status === "granted" ? "bg-flame/12 text-flame" : "bg-warm/[0.06] text-ash")}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-ash">{when(o.created_at)}</td>
                  </tr>
                ))}
                {!orders.length ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-[12px] text-ash">Belum ada order dari bot.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "security" ? (
        <div className="surface overflow-hidden p-0">
          <div className="border-b border-ash/12 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warm">
              <ShieldAlert size={13} className="text-flame" /> Percobaan login gagal
            </p>
            <p className="mt-0.5 text-[12px] text-ash">Portal session dan admin login. Lockout otomatis setelah 5 percobaan.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-ash/15 bg-warm/[0.02] text-[12px] text-ash">
                  <th className="px-4 py-2.5 font-medium">Waktu</th>
                  <th className="px-4 py-2.5 font-medium">Scope</th>
                  <th className="px-4 py-2.5 font-medium">Identitas</th>
                  <th className="px-4 py-2.5 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f, i) => (
                  <tr key={`${f.at}-${i}`} className="border-b border-ash/10 text-[12px] last:border-0">
                    <td className="px-4 py-2.5 text-ash">{when(f.at)}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-warm">{f.scope}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ash">{f.ident ?? "n/a"}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ash">{f.ip ?? "n/a"}</td>
                  </tr>
                ))}
                {!failures.length ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-[12px] text-ash">Tidak ada percobaan gagal.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {creditFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[380px] rounded-xl border border-white/12 bg-panel-2 p-5">
            <p className="text-[14px] font-semibold text-warm">Tambah kredit</p>
            <p className="mt-1 text-[12px] text-ash">
              {creditFor.username ? `@${creditFor.username}` : `tg ${creditFor.tg_id}`} · saldo {idr(creditFor.balance_micro)}
            </p>
            <input
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="mt-3 h-10 w-full rounded-lg border border-ash/25 bg-panel px-3 text-[13px] text-warm focus:border-flame/50 focus:outline-none"
            />
            <p className="mt-1 text-[12px] text-ash">dalam Rupiah</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCreditFor(null)} className="h-9 rounded-lg border border-ash/25 px-3 text-[12.5px] text-ash hover:text-warm">Batal</button>
              <button type="button" onClick={() => void credit()} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-lg bg-flame px-3 text-[12.5px] font-semibold text-[#18191B] disabled:opacity-60">
                {busy ? <Loader2 size={13} className="animate-spin" /> : null} Tambah
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
