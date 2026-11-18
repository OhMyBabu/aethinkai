import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BarChart3, Check, ChevronRight, Copy, Home, LayoutGrid, Loader2, LogOut,
  Plus, RefreshCw, Search, Send, User, X,
} from "lucide-react";
import {
  buy, clearToken, compact, getCatalog, getMe, getModelsUsed, getOrders, getPackages, getUsage,
  idr, price1m, readToken, rotateKey, tgSession, waitForWebApp, when, writeToken,
  type CatalogModel, type KeyRow, type Me, type ModelUse, type Order, type Pkg, type Usage, type UsageDay,
} from "@/lib/tg";
import { createPayment } from "@/lib/portal";
import { cn } from "@/lib/cn";
import { AppAmbient } from "@/components/layout/AppAmbient";
import { BrandLogo } from "@/components/layout/BrandLogo";

type Tab = "home" | "models" | "usage" | "account";

const CAP_LABEL: Record<string, string> = {
  reasoning: "Reasoning", tools: "Tools", vision: "Vision", pdf: "PDF",
  search: "Search", thinkingCanDisable: "Thinking",
};

const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const initials = (me: Me | null) => (me?.buyer.name || me?.buyer.username || "A").slice(0, 2).toUpperCase();
const firstName = (me: Me | null) => (me?.buyer.name || me?.buyer.username || "").split(" ")[0];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 19) return "Selamat sore";
  return "Selamat malam";
}

const dayKey = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

/** Request count of the last 7 days against the 7 days before them. null when there is no baseline. */
function weekOverWeek(daily: UsageDay[] | undefined): number | null {
  if (!daily?.length) return null;
  const from = dayKey(7);
  const before = dayKey(14);
  const current = daily.filter((d) => d.day.slice(0, 10) > from).reduce((sum, d) => sum + d.requests, 0);
  const previous = daily.filter((d) => d.day.slice(0, 10) > before && d.day.slice(0, 10) <= from).reduce((sum, d) => sum + d.requests, 0);
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const primaryBtn = "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-flame text-[15px] font-medium text-[#1a1305] active:bg-[#d9792f] disabled:opacity-60";
const ghostBtn = "flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-white/12 text-[14px] text-warm active:bg-white/[0.06]";
const panel = "rounded-xl border border-white/8 bg-panel";

export default function MiniAppPage() {
  const [phase, setPhase] = useState<"boot" | "ready" | "no-telegram" | "error">("boot");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(readToken());
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    return wanted === "models" || wanted === "usage" || wanted === "account" ? wanted : "home";
  });
  const [me, setMe] = useState<Me | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usage30, setUsage30] = useState<Usage | null>(null);
  const [used, setUsed] = useState<ModelUse[]>([]);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [topUp, setTopUp] = useState(false);
  const [detail, setDetail] = useState<CatalogModel | null>(null);

  const load = useCallback(async (t: string) => {
    const [m, u7, u30, mu, cat, pk, ord] = await Promise.all([
      getMe(t), getUsage(t, 7), getUsage(t, 30), getModelsUsed(t, 30), getCatalog(), getPackages(), getOrders(t),
    ]);
    setMe(m); setUsage(u7); setUsage30(u30); setUsed(mu.models); setCatalog(cat.data); setPackages(pk.packages); setOrders(ord.orders);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const app = await waitForWebApp();
        app?.ready?.();
        app?.expand?.();
        app?.setHeaderColor?.("#0A0A0A");
        app?.setBackgroundColor?.("#0A0A0A");
        (app as { setBottomBarColor?: (c: string) => void } | null)?.setBottomBarColor?.("#0A0A0A");
        let t = readToken();
        if (app?.initData) {
          const s = await tgSession(app.initData);
          t = s.token;
          writeToken(t);
        }
        if (!alive) return;
        if (!t) { setPhase("no-telegram"); return; }
        setToken(t);
        await load(t);
        if (alive) setPhase("ready");
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Gagal memuat");
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, [load]);

  const refresh = async () => {
    if (!token) return;
    setBusy(true);
    try { await load(token); } catch (err) { setError(err instanceof Error ? err.message : "Gagal memuat ulang"); }
    finally { setBusy(false); }
  };

  const spend = usage?.totals.cost_micro ?? 0;
  const weekRequests = usage?.totals.requests ?? 0;
  const delta = useMemo(() => weekOverWeek(usage30?.daily), [usage30]);

  if (phase === "boot") {
    return (
      <div className="grid min-h-screen place-items-center bg-charcoal text-ash">
        <div className="flex flex-col items-center gap-4">
          <BrandLogo size={44} />
          <span className="inline-flex items-center gap-2 text-[13px]"><Loader2 size={15} className="animate-spin" /> Memuat akun…</span>
        </div>
      </div>
    );
  }

  if (phase === "no-telegram" || phase === "error") {
    return (
      <div className="grid min-h-screen place-items-center bg-charcoal px-5">
        <div className={cn(panel, "w-full max-w-[380px] p-6")}>
          <BrandLogo size={40} />
          <h1 className="mt-5 text-[20px] font-semibold text-warm">
            {phase === "error" ? "Akun belum bisa dimuat" : "Buka lewat Telegram"}
          </h1>
          <p className="mt-2 text-[14px] leading-6 text-ash">
            {phase === "error"
              ? "Terjadi masalah saat mengambil data kamu."
              : "Mini app ini membaca identitas dari Telegram, jadi tidak ada email atau password."}
          </p>
          {error ? <p className="mt-3 rounded-lg border border-flame/25 bg-flame/[0.07] px-3 py-2 text-[13px] text-warm/90">{error}</p> : null}
          <a href="https://t.me/AethinkBot" className={cn(primaryBtn, "mt-5")}>
            <Send size={15} /> Buka @AethinkBot
          </a>
          <a href="/portal" className={cn(ghostBtn, "mt-2")}>Masuk lewat portal web</a>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Beranda", icon: Home },
    { id: "models", label: "Model", icon: LayoutGrid },
    { id: "usage", label: "Pemakaian", icon: BarChart3 },
    { id: "account", label: "Akun", icon: User },
  ];

  return (
    <div className="relative isolate min-h-screen bg-charcoal pb-[96px] text-warm">
      <AppAmbient />
      <div className="mx-auto w-full max-w-[440px] px-5">
        <BrandRow me={me} onRefresh={() => void refresh()} busy={busy} />

        {error ? (
          <p role="status" className="mt-3 rounded-lg border border-flame/25 bg-flame/[0.07] px-3 py-2 text-[13px] text-warm/90">{error}</p>
        ) : null}

        {tab === "home" ? (
          <HomeScreen
            me={me} usage={usage} used={used} catalog={catalog} weekRequests={weekRequests}
            spend={spend} delta={delta}
            onTopUp={() => setTopUp(true)}
            onTab={setTab}
            onModel={setDetail}
          />
        ) : null}

        {tab === "models" ? <ModelsScreen catalog={catalog} used={used} onModel={setDetail} /> : null}

        {tab === "usage" ? <UsageScreen usage={usage} usage30={usage30} used={used} spend={spend} /> : null}

        {tab === "account" ? (
          <AccountScreen
            me={me} orders={orders} token={token}
            onRotated={() => void refresh()}
            onTopUp={() => setTopUp(true)}
          />
        ) : null}
      </div>

      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-charcoal">
        <div className="mx-auto flex max-w-[440px] items-stretch justify-between px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[12px] transition-colors",
                tab === id ? "text-flame" : "text-ash",
              )}
            >
              <Icon size={20} strokeWidth={tab === id ? 2.2 : 1.8} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {topUp ? (
        <TopUpSheet packages={packages} token={token} onClose={() => setTopUp(false)} />
      ) : null}

      {detail ? <ModelSheet model={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function BrandRow({ me, onRefresh, busy }: { me: Me | null; onRefresh: () => void; busy: boolean }) {
  return (
    <div className="sticky top-0 z-20 -mx-5 flex h-14 items-center justify-between border-b border-white/8 bg-charcoal px-5">
      <div className="flex items-center gap-2.5">
        <BrandLogo size={28} />
        <p className="text-[15px] font-semibold">Aethink<span className="text-flame">AI</span></p>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onRefresh} aria-label="Muat ulang"
          className="grid size-11 place-items-center rounded-lg text-ash active:bg-white/[0.06]">
          <RefreshCw size={16} className={busy ? "animate-spin" : undefined} />
        </button>
        <span className="grid size-8 place-items-center rounded-full bg-white/[0.08] text-[12px] font-semibold">
          {initials(me)}
        </span>
      </div>
    </div>
  );
}

function SectionHead({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mt-7 flex items-baseline justify-between">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      {action ? (
        <button type="button" onClick={action.onClick} className="-my-2 inline-flex h-11 items-center gap-1 text-[13px] text-ash active:text-warm">
          {action.label} <ChevronRight size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ home */

function HomeScreen({ me, usage, used, catalog, weekRequests, spend, delta, onTopUp, onTab, onModel }: {
  me: Me | null; usage: Usage | null; used: ModelUse[]; catalog: CatalogModel[];
  weekRequests: number; spend: number; delta: number | null;
  onTopUp: () => void; onTab: (t: Tab) => void; onModel: (m: CatalogModel) => void;
}) {
  const top = useMemo(() => {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const picked = used.map((u) => byId.get(u.model_id)).filter(Boolean) as CatalogModel[];
    return (picked.length ? picked : catalog).slice(0, 3);
  }, [catalog, used]);
  const name = firstName(me);

  return (
    <div className="pt-5">
      <p className="text-[14px] text-ash">{greeting()}{name ? `, ${name}` : ""}</p>

      <div className={cn(panel, "mt-3 p-5")}>
        <p className="text-[13px] text-ash">Saldo</p>
        <p className="num mt-1.5 text-[38px] font-semibold leading-none tracking-[-0.03em]">
          {idr(me?.balance_micro ?? 0)}
        </p>
        <p className="mt-3 text-[13px] text-ash">{me?.keys.length ?? 0} API key aktif</p>
        <button type="button" onClick={onTopUp} className={cn(primaryBtn, "mt-4")}>
          <Plus size={16} aria-hidden /> Tambah saldo
        </button>
      </div>

      <SectionHead title="7 hari terakhir" action={{ label: "Detail", onClick: () => onTab("usage") }} />
      <div className={cn(panel, "mt-3 p-4")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="num text-[28px] font-semibold leading-none">{compact(weekRequests)}</p>
            <p className="mt-1.5 text-[13px] text-ash">request · biaya {idr(spend)}</p>
          </div>
          {delta !== null ? (
            <span className={cn("num rounded-md px-2 py-1 text-[12.5px] font-medium", delta >= 0 ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
              {delta >= 0 ? "+" : "−"}{Math.abs(delta)}%
            </span>
          ) : null}
        </div>
        <Sparkline points={(usage?.daily ?? []).map((d) => d.requests)} />
        {delta !== null ? <p className="mt-2 text-[12px] text-dim">dibanding 7 hari sebelumnya</p> : null}
      </div>

      <SectionHead title={used.length ? "Model yang kamu pakai" : "Model tersedia"} action={{ label: "Semua", onClick: () => onTab("models") }} />
      <ul className="mt-3 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/8 bg-panel">
        {top.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onModel(m)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-white/[0.04]">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">{m.display_name}</p>
                <p className="num mt-0.5 text-[12.5px] text-ash">masuk {price1m(m.pricing_idr_per_1m.input)} · keluar {price1m(m.pricing_idr_per_1m.output)} /1M</p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-ash" aria-hidden />
            </button>
          </li>
        ))}
        {!top.length ? <li className="px-4 py-4 text-[13px] text-ash">Katalog belum tersedia.</li> : null}
      </ul>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const series = points.length ? points : [];
  if (!series.some((v) => v > 0)) {
    return (
      <div className="mt-4 grid h-[72px] place-items-center rounded-lg border border-dashed border-white/12 text-[13px] text-ash">
        Belum ada request di periode ini
      </div>
    );
  }
  const w = 320, h = 72;
  const max = Math.max(1, ...series);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const coords = series.map((v, i) => [i * step, h - (v / max) * (h - 8) - 4] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-[72px] w-full" preserveAspectRatio="none" role="img" aria-label="Grafik request harian">
      <path d={area} fill="#E7893C" fillOpacity="0.12" />
      <path d={line} fill="none" stroke="#E7893C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ models */

const FILTERS = ["Semua", "Reasoning", "Tools", "Vision"] as const;

function ModelsScreen({ catalog, used, onModel }: { catalog: CatalogModel[]; used: ModelUse[]; onModel: (m: CatalogModel) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Semua");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((m) => {
      const caps = Object.entries(m.capabilities).filter(([, v]) => v).map(([k]) => k);
      const hitCaps = filter === "Semua" || caps.includes(filter.toLowerCase());
      const hitText = !needle || m.display_name.toLowerCase().includes(needle) || m.id.includes(needle) || m.provider.toLowerCase().includes(needle);
      return hitCaps && hitText;
    });
  }, [catalog, filter, q]);

  const usageById = new Map(used.map((u) => [u.model_id, u.requests]));

  return (
    <div className="pt-5">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Model</h1>
      <p className="mt-1 text-[14px] text-ash">Harga per 1 juta token, satu endpoint untuk semuanya.</p>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/12 bg-panel px-3">
        <Search size={15} className="text-ash" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari model…" aria-label="Cari model"
          className="h-11 w-full bg-transparent text-[14px] text-warm placeholder:text-ash/70 focus:outline-none" />
        {q ? <button type="button" onClick={() => setQ("")} aria-label="Bersihkan pencarian" className="grid size-8 place-items-center"><X size={14} className="text-ash" /></button> : null}
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={cn("h-9 shrink-0 rounded-lg border px-3.5 text-[13px] transition-colors",
              filter === f ? "border-flame/40 bg-flame/10 text-flame" : "border-white/12 text-ash")}>
            {f}
          </button>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/8 bg-panel">
        {rows.map((m) => {
          const caps = Object.entries(m.capabilities).filter(([, v]) => v).map(([k]) => CAP_LABEL[k] ?? k).slice(0, 3);
          const reqs = usageById.get(m.id);
          return (
            <li key={m.id}>
              <button type="button" onClick={() => onModel(m)} className="w-full px-4 py-3.5 text-left active:bg-white/[0.04]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[14.5px] font-medium">{m.display_name}</p>
                  {reqs ? <span className="num shrink-0 text-[12px] text-ash">{compact(reqs)} req</span> : null}
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-ash">{[m.provider, ...caps].join(" · ")}</p>
                <div className="num mt-2.5 flex gap-5 text-[13px]">
                  <span><span className="text-ash">Masuk </span>{price1m(m.pricing_idr_per_1m.input)}</span>
                  <span><span className="text-ash">Keluar </span>{price1m(m.pricing_idr_per_1m.output)}</span>
                </div>
              </button>
            </li>
          );
        })}
        {!rows.length ? <li className="px-4 py-4 text-[13px] text-ash">Tidak ada model yang cocok.</li> : null}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ usage */

function UsageScreen({ usage, usage30, used, spend }: { usage: Usage | null; usage30: Usage | null; used: ModelUse[]; spend: number }) {
  const [days, setDays] = useState<7 | 30>(7);
  const data = days === 7 ? usage : usage30;
  const totals = data?.totals;
  const maxCost = Math.max(1, ...used.map((x) => x.cost_micro));

  return (
    <div className="pt-5">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Pemakaian</h1>
      <p className="mt-1 text-[14px] text-ash">Angka yang sama dengan dashboard web.</p>

      <div role="tablist" aria-label="Rentang waktu" className="mt-4 inline-flex rounded-lg border border-white/10 p-0.5">
        {[7, 30].map((d) => (
          <button key={d} role="tab" aria-selected={days === d} type="button" onClick={() => setDays(d as 7 | 30)}
            className={cn("h-10 rounded-md px-4 text-[13.5px] font-medium", days === d ? "bg-white/10 text-warm" : "text-ash")}>
            {d} hari
          </button>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        {[
          { label: "Request", value: compact(totals?.requests ?? 0) },
          { label: "Biaya", value: idr(totals?.cost_micro ?? spend) },
          { label: "Token masuk", value: compact(totals?.tokens_in ?? 0) },
          { label: "Token keluar", value: compact(totals?.tokens_out ?? 0) },
        ].map((s) => (
          <div key={s.label} className={cn(panel, "p-3.5")}>
            <dt className="text-[13px] text-ash">{s.label}</dt>
            <dd className="num mt-1 text-[19px] font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className={cn(panel, "mt-3 p-4")}>
        <p className="text-[13px] text-ash">Request per hari</p>
        <Sparkline points={(data?.daily ?? []).map((d) => d.requests)} />
        <div className="mt-2 flex justify-between text-[12px] text-dim">
          <span>{days} hari lalu</span><span>hari ini</span>
        </div>
      </div>

      <SectionHead title="Per model" />
      <ul className="mt-3 space-y-2">
        {used.slice(0, 6).map((m) => (
          <li key={m.model_id} className={cn(panel, "p-3.5")}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-[14px] font-medium">{m.model_id}</p>
              <p className="num shrink-0 text-[13px] text-ash">{idr(m.cost_micro)}</p>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-flame/80" style={{ width: `${Math.max(4, (m.cost_micro / maxCost) * 100)}%` }} />
            </div>
            <p className="num mt-2 text-[12.5px] text-ash">{compact(m.requests)} request · {when(m.last_used_at)}</p>
          </li>
        ))}
        {!used.length ? <li className={cn(panel, "p-4 text-[13px] text-ash")}>Belum ada pemakaian.</li> : null}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ account */

const ORDER_LABEL: Record<string, string> = { granted: "dibayar", pending: "menunggu bayar", expired: "kedaluwarsa" };

function AccountScreen({ me, orders, token, onRotated, onTopUp }: {
  me: Me | null; orders: Order[]; token: string | null; onRotated: () => void; onTopUp: () => void;
}) {
  const [reveal, setReveal] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const rotate = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await rotateKey(token);
      setReveal(r.api_key);
      setMsg("Key baru aktif. Simpan sekarang, tidak akan ditampilkan lagi.");
      setConfirm(false);
      onRotated();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Gagal merotasi key");
    } finally { setBusy(false); }
  };

  return (
    <div className="pt-5">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-white/[0.08] text-[15px] font-semibold">{initials(me)}</span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold">{me?.buyer.name || "Tanpa nama"}</p>
          <p className="truncate text-[13px] text-ash">
            {me?.buyer.username ? `@${me.buyer.username}` : "Telegram"} · id {me?.buyer.tg_id ?? "n/a"}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        <button type="button" onClick={onTopUp} className={primaryBtn}>
          <Plus size={16} aria-hidden /> Tambah saldo · {idr(me?.balance_micro ?? 0)}
        </button>
        <a href="/portal" className={ghostBtn}>Buka portal web <ArrowRight size={14} aria-hidden /></a>
      </div>

      <SectionHead title="API key" />
      <ul className="mt-3 space-y-2">
        {(me?.keys ?? []).map((k: KeyRow) => (
          <li key={k.id} className={cn(panel, "p-3.5")}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[13px]">{k.prefix}••••••••</p>
              <span className={cn("rounded-md px-2 py-0.5 text-[12px]", k.status === "active" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
                {k.status === "active" ? "aktif" : k.status}
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] text-ash">{k.rpm_limit} req/menit · terakhir dipakai {when(k.last_used_at)}</p>
          </li>
        ))}
        {!(me?.keys ?? []).length ? (
          <li className={cn(panel, "p-4 text-[13px] leading-5 text-ash")}>Belum ada key. Selesaikan pembelian, key dikirim ke chat bot.</li>
        ) : null}
      </ul>

      {reveal ? (
        <div className="mt-2 rounded-xl border border-flame/35 bg-flame/[0.07] p-3.5">
          <p className="text-[13px] font-medium text-warm">Key baru, hanya tampil sekali</p>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{reveal}</code>
            <button type="button" aria-label="Salin key"
              onClick={() => { navigator.clipboard?.writeText(reveal).catch(() => undefined); setMsg("Key disalin."); }}
              className="grid size-10 shrink-0 place-items-center rounded-lg border border-flame/40">
              <Copy size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {me?.keys.length ? (
        confirm ? (
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void rotate()} className={primaryBtn}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Ya, rotasi
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={ghostBtn}>Batal</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className={cn(ghostBtn, "mt-2")}>
            <RefreshCw size={14} aria-hidden /> Rotasi key
          </button>
        )
      ) : null}
      {confirm ? <p className="mt-2 text-[12.5px] leading-5 text-ash">Key lama langsung berhenti bekerja setelah rotasi.</p> : null}

      <SectionHead title="Pembelian" />
      <ul className="mt-3 space-y-2">
        {orders.slice(0, 5).map((o) => (
          <li key={o.id} className={cn(panel, "flex items-center justify-between gap-3 px-3.5 py-3")}>
            <div className="min-w-0">
              <p className="truncate font-mono text-[12.5px]">{o.id}</p>
              <p className="num mt-0.5 text-[12.5px] text-ash">{o.sku} · {rupiah(o.price_idr)}</p>
            </div>
            <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[12px]", o.status === "granted" ? "bg-ok/10 text-ok" : o.status === "pending" ? "bg-flame/10 text-flame" : "bg-white/[0.06] text-ash")}>
              {ORDER_LABEL[o.status] ?? o.status}
            </span>
          </li>
        ))}
        {!orders.length ? <li className="text-[13px] text-ash">Belum ada pembelian.</li> : null}
      </ul>

      {msg ? <p role="status" className="mt-3 text-[13px] text-flame">{msg}</p> : null}

      <button type="button" onClick={() => { clearToken(); window.location.reload(); }} className={cn(ghostBtn, "mt-6 text-ash")}>
        <LogOut size={14} aria-hidden /> Keluar dari sesi ini
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ sheets */

function TopUpSheet({ packages, token, onClose }: { packages: Pkg[]; token: string | null; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (sku: string) => {
    if (!token) return;
    setBusy(sku); setErr(null);
    try {
      const order = await buy(token, sku);
      const pay = await createPayment(token, order.order_id);
      window.location.assign(pay.pay_url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat pembayaran");
      setBusy(null);
    }
  };

  return (
    <Sheet onClose={onClose} title="Tambah saldo">
      <p className="mb-3 text-[13.5px] leading-5 text-ash">Pilih paket, lalu bayar lewat QRIS. Saldo dan key masuk otomatis setelah pembayaran terverifikasi.</p>
      <ul className="space-y-2">
        {packages.map((p) => (
          <li key={p.sku}>
            <button type="button" disabled={busy !== null} onClick={() => void pick(p.sku)}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-panel px-4 py-3 text-left active:bg-white/[0.05] disabled:opacity-60">
              <div className="min-w-0">
                <p className="text-[15px] font-medium">{p.name}</p>
                <p className="num mt-0.5 text-[12.5px] text-ash">Saldo {idr(p.credits_micro)} · {p.rpm} req/menit</p>
              </div>
              <span className="num inline-flex shrink-0 items-center gap-2 text-[15px] font-semibold">
                {busy === p.sku ? <Loader2 size={15} className="animate-spin" /> : null}
                {rupiah(p.idr)}
              </span>
            </button>
          </li>
        ))}
        {!packages.length ? <li className="text-[13px] text-ash">Belum ada paket yang dibuka.</li> : null}
      </ul>
      {err ? <p role="alert" className="mt-3 rounded-lg border border-flame/25 bg-flame/[0.07] px-3 py-2 text-[13px] leading-5 text-warm/90">{err}</p> : null}
    </Sheet>
  );
}

function ModelSheet({ model, onClose }: { model: CatalogModel; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const caps = Object.entries(model.capabilities).filter(([, v]) => v).map(([k]) => CAP_LABEL[k] ?? k);
  const base = `${window.location.origin}/v1`;
  return (
    <Sheet onClose={onClose} title={model.display_name}>
      <p className="text-[13px] text-ash">{model.provider} · <span className="font-mono">{model.id}</span></p>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {[
          { label: "Masuk /1M", value: price1m(model.pricing_idr_per_1m.input) },
          { label: "Keluar /1M", value: price1m(model.pricing_idr_per_1m.output) },
          { label: "Cache /1M", value: price1m(model.pricing_idr_per_1m.cached_input) },
        ].map((p) => (
          <div key={p.label} className="rounded-lg border border-white/10 bg-charcoal p-2.5">
            <dt className="text-[12px] text-ash">{p.label}</dt>
            <dd className="num mt-0.5 text-[14px] font-semibold">{p.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-4 space-y-2 text-[13.5px]">
        <div className="flex justify-between"><dt className="text-ash">Konteks</dt><dd className="num">{model.context_length ? `${compact(model.context_length)} token` : "n/a"}</dd></div>
        <div className="flex justify-between"><dt className="text-ash">Output maksimum</dt><dd className="num">{model.max_completion_tokens ? `${compact(model.max_completion_tokens)} token` : "n/a"}</dd></div>
      </dl>
      {caps.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {caps.map((c) => <span key={c} className="rounded-md border border-white/12 px-2 py-1 text-[12px] text-ash">{c}</span>)}
        </div>
      ) : null}
      <button type="button"
        onClick={() => { navigator.clipboard?.writeText(model.id).catch(() => undefined); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
        className={cn(ghostBtn, "mt-4")}>
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Model ID disalin" : "Salin model ID"}
      </button>
      <p className="mt-3 text-[12.5px] leading-5 text-ash">
        Base URL <span className="font-mono text-warm/85">{base}</span>, header <span className="font-mono text-warm/85">Authorization: Bearer API_KEY_KAMU</span>
      </p>
    </Sheet>
  );
}

function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="panel-enter w-full max-w-[440px] rounded-t-2xl border border-white/10 bg-panel px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Tutup" className="grid size-11 place-items-center rounded-lg text-ash active:bg-white/[0.06]">
            <X size={17} />
          </button>
        </div>
        <div className="mt-2 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
