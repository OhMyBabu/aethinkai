import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, Check, ChevronRight, Copy, Home, KeyRound,
  LayoutGrid, Loader2, LogOut, Plus, RefreshCw, Search, Send, Sparkles, User, Wallet, X,
} from "lucide-react";
import {
  buy, clearToken, compact, getCatalog, getMe, getModelsUsed, getOrders, getPackages, getUsage,
  idr, price1m, readToken, rotateKey, tgSession, waitForWebApp, when, writeToken,
  type CatalogModel, type KeyRow, type Me, type ModelUse, type Order, type Pkg, type Usage,
} from "@/lib/tg";
import { cn } from "@/lib/cn";

type Tab = "home" | "models" | "usage" | "account";

const CAP_LABEL: Record<string, string> = {
  reasoning: "Reasoning", tools: "Tools", vision: "Vision", pdf: "PDF",
  search: "Search", thinkingCanDisable: "Thinking",
};

const initials = (me: Me | null) => (me?.buyer.name || me?.buyer.username || "A").slice(0, 2).toUpperCase();

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 19) return "Selamat sore";
  return "Selamat malam";
}

export default function MiniAppPage() {
  const [phase, setPhase] = useState<"boot" | "ready" | "no-telegram" | "error">("boot");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(readToken());
  const [tab, setTab] = useState<Tab>("home");
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
        app?.setHeaderColor?.("#18191B");
        app?.setBackgroundColor?.("#18191B");
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
    try { await load(token); } catch (err) { setError(err instanceof Error ? err.message : "Gagal refresh"); }
    finally { setBusy(false); }
  };

  const spend = usage?.totals.cost_micro ?? 0;
  const weekRequests = usage?.totals.requests ?? 0;
  const prevWeek = useMemo(() => {
    const daily = usage?.daily ?? [];
    return daily.slice(0, Math.max(1, Math.floor(daily.length / 2))).reduce((a, d) => a + d.requests, 0);
  }, [usage]);
  const delta = prevWeek ? Math.round(((weekRequests - prevWeek) / prevWeek) * 100) : 0;

  if (phase === "boot") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0A0A0A] text-[#85888B]">
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl border border-[#E7893C]/40 bg-[#9C542F]/20 text-[18px] font-bold text-[#E7893C]">A</span>
          <span className="inline-flex items-center gap-2 text-[12.5px]"><Loader2 size={14} className="animate-spin" /> Menyiapkan control center…</span>
        </div>
      </div>
    );
  }

  if (phase === "no-telegram" || phase === "error") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0A0A0A] px-5">
        <div className="w-full max-w-[380px] rounded-2xl border border-[#383A3E] bg-[#232426] p-6">
          <span className="grid size-11 place-items-center rounded-xl border border-[#E7893C]/40 bg-[#9C542F]/20 text-[16px] font-bold text-[#E7893C]">A</span>
          <h1 className="mt-4 text-[19px] font-semibold text-[#FAF8F4]">Buka lewat Telegram</h1>
          <p className="mt-1.5 text-[12.5px] leading-6 text-[#A1A3A7]">
            Mini App ini membaca identitas dari Telegram — tidak ada login email atau password.
            {error ? <span className="mt-2 block text-[#E7893C]">{error}</span> : null}
          </p>
          <a href="https://t.me/AethinkBot" className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-[#E7893C] text-[13px] font-semibold text-[#18191B]">
            <Send size={14} /> Buka @AethinkBot
          </a>
          <a href="/portal" className="mt-2 flex h-11 items-center justify-center rounded-xl border border-[#383A3E] text-[12.5px] text-[#FAF8F4]">
            Masuk lewat web portal
          </a>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "models", label: "Models", icon: LayoutGrid },
    { id: "usage", label: "Usage", icon: BarChart3 },
    { id: "account", label: "Akun", icon: User },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-[86px] text-[#FAF8F4]">
      <div className="mx-auto w-full max-w-[440px] px-5 pt-4">
        <BrandRow me={me} onRefresh={() => void refresh()} busy={busy} />

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

        {tab === "usage" ? (
          <UsageScreen usage={usage} usage30={usage30} used={used} spend={spend} />
        ) : null}

        {tab === "account" ? (
          <AccountScreen
            me={me} orders={orders} token={token}
            onRotated={() => void refresh()}
            onTopUp={() => setTopUp(true)}
          />
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2B2D30] bg-[#0A0A0A]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[440px] items-stretch justify-between px-3 pb-[max(env(safe-area-inset-bottom),6px)] pt-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10.5px] transition-colors",
                tab === id ? "text-[#E7893C]" : "text-[#85888B] hover:text-[#FAF8F4]")}
            >
              <Icon size={19} strokeWidth={tab === id ? 2.2 : 1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {topUp ? (
        <TopUpSheet
          packages={packages} token={token}
          onClose={() => setTopUp(false)}
          onDone={() => void refresh()}
        />
      ) : null}

      {detail ? <ModelSheet model={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function BrandRow({ me, onRefresh, busy }: { me: Me | null; onRefresh: () => void; busy: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl border border-[#E7893C]/35 bg-[#9C542F]/25 text-[13px] font-bold text-[#E7893C]">A</span>
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold">Aethink<span className="text-[#E7893C]">AI</span></p>
          <p className="text-[9px] uppercase tracking-[0.18em] text-[#85888B]">Gateway · Mini App</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onRefresh} aria-label="Muat ulang"
          className="grid size-8 place-items-center rounded-lg border border-[#383A3E] text-[#A1A3A7] transition hover:bg-[#2B2D30] hover:text-[#FAF8F4]">
          <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
        </button>
        <span className="grid size-8 place-items-center rounded-full bg-[#2B2D30] text-[11px] font-semibold text-[#FAF8F4]">
          {initials(me)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ home */

function HomeScreen({ me, usage, used, catalog, weekRequests, spend, delta, onTopUp, onTab, onModel }: {
  me: Me | null; usage: Usage | null; used: ModelUse[]; catalog: CatalogModel[];
  weekRequests: number; spend: number; delta: number;
  onTopUp: () => void; onTab: (t: Tab) => void; onModel: (m: CatalogModel) => void;
}) {
  const top = useMemo(() => {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const picked = used.map((u) => byId.get(u.model_id)).filter(Boolean) as CatalogModel[];
    return (picked.length ? picked : catalog).slice(0, 3);
  }, [catalog, used]);

  return (
    <div className="mt-5">
      <p className="text-[13px] text-[#A1A3A7]">{greeting()} 👋</p>
      <h1 className="mt-1 text-[27px] font-semibold leading-[1.15] tracking-[-0.03em]">
        Control center AI lu.
      </h1>

      <div className="mt-4 rounded-[22px] border border-[#9C542F]/35 bg-[linear-gradient(160deg,#2A211C_0%,#232426_58%,#232426_100%)] p-5">
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-[#A1A3A7]">Saldo tersedia</p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7893C]/30 bg-[#E7893C]/10 px-2 py-0.5 text-[10px] text-[#E7C9A8]">
            <span className="size-1.5 rounded-full bg-[#E7893C]" /> Wallet aktif
          </span>
        </div>
        <p className="mt-1.5 text-[36px] font-semibold leading-none tracking-[-0.035em] tabular-nums">
          {idr(me?.balance_micro ?? 0)}
        </p>
        <div className="my-3 h-px bg-[#FAF8F4]/8" />
        <div className="flex items-center justify-between">
          <p className="text-[11.5px] text-[#A1A3A7]">Prepaid wallet · IDR · {me?.keys.length ?? 0} key aktif</p>
          <button type="button" onClick={onTopUp} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#FAF8F4]">
            <Plus size={12} /> Tambah saldo
          </button>
        </div>
      </div>

      <h2 className="mt-6 text-[15px] font-semibold">Akses cepat</h2>
      <div className="mt-2.5 grid grid-cols-4 gap-2.5">
        {[
          { label: "Top Up", icon: Plus, action: onTopUp },
          { label: "API Keys", icon: KeyRound, action: () => onTab("account") },
          { label: "Models", icon: Sparkles, action: () => onTab("models") },
          { label: "Billing", icon: BarChart3, action: () => onTab("usage") },
        ].map(({ label, icon: Icon, action }) => (
          <button key={label} type="button" onClick={action}
            className="flex flex-col items-center gap-2 rounded-2xl border border-[#383A3E] bg-[#232426] px-1 py-3 text-[10.5px] text-[#FAF8F4] transition hover:bg-[#2B2D30] active:scale-[0.98]">
            <Icon size={17} className="text-[#E7893C]" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Ringkasan pemakaian</h2>
        <button type="button" onClick={() => onTab("usage")} className="inline-flex items-center gap-1 text-[11.5px] text-[#E7893C]">
          Lihat detail <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="mt-2.5 rounded-[22px] border border-[#383A3E] bg-[#232426] p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11.5px] text-[#A1A3A7]">Request 7 hari terakhir</p>
            <p className="mt-0.5 text-[28px] font-semibold leading-none tabular-nums">{compact(weekRequests)}</p>
            <p className="mt-1 text-[10.5px] text-[#85888B]">Biaya {idr(spend)}</p>
          </div>
          {prevWeekGuard(delta) ? (
            <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-medium",
              delta >= 0 ? "bg-[#3E5E46]/35 text-[#9FD3A9]" : "bg-[#5E3E3E]/35 text-[#D3A9A9]")}>
              {delta >= 0 ? "+" : ""}{delta}%
            </span>
          ) : null}
        </div>
        <Sparkline points={(usage?.daily ?? []).map((d) => d.requests)} />
      </div>

      <div className="mt-6 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Model populer</h2>
        <button type="button" onClick={() => onTab("models")} className="inline-flex items-center gap-1 text-[11.5px] text-[#E7893C]">
          Katalog <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="mt-2.5 space-y-2">
        {top.map((m) => (
          <button key={m.id} type="button" onClick={() => onModel(m)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#383A3E] bg-[#232426] px-3.5 py-3 text-left transition hover:bg-[#2B2D30]">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold">{m.display_name}</p>
              <p className="text-[10.5px] text-[#85888B]">{m.provider} · in {price1m(m.pricing_idr_per_1m.input)} / out {price1m(m.pricing_idr_per_1m.output)}</p>
            </div>
            <ChevronRight size={15} className="shrink-0 text-[#85888B]" />
          </button>
        ))}
        {!top.length ? <p className="text-[11.5px] text-[#85888B]">Katalog belum tersedia.</p> : null}
      </div>
    </div>
  );
}

const prevWeekGuard = (delta: number) => Number.isFinite(delta) && delta !== 0;

function Sparkline({ points }: { points: number[] }) {
  const series = points.length ? points : [0, 0, 0, 0, 0, 0, 0];
  const w = 320, h = 68;
  const max = Math.max(1, ...series);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const coords = series.map((v, i) => [i * step, h - (v / max) * (h - 8) - 4] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-[68px] w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E7893C" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#E7893C" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={line} fill="none" stroke="#E7893C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ models */

const FILTERS = ["Semua", "Reasoning", "Coding", "Vision", "Tools"] as const;

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
    <div className="mt-5">
      <h1 className="text-[24px] font-semibold tracking-[-0.03em]">Jelajahi model</h1>
      <p className="mt-1 text-[12px] leading-5 text-[#A1A3A7]">Harga transparan per 1 juta token, satu endpoint API.</p>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#383A3E] bg-[#232426] px-3">
        <Search size={14} className="text-[#85888B]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari model atau kemampuan…"
          className="h-10 w-full bg-transparent text-[12.5px] text-[#FAF8F4] placeholder:text-[#85888B]/70 focus:outline-none" />
        {q ? <button type="button" onClick={() => setQ("")} aria-label="Bersihkan"><X size={13} className="text-[#85888B]" /></button> : null}
      </div>

      <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn("shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition",
              filter === f ? "border-[#9C542F] bg-[#9C542F]/25 text-[#F1D3B8]" : "border-[#383A3E] text-[#A1A3A7] hover:text-[#FAF8F4]")}>
            {f}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {rows.map((m) => {
          const caps = Object.entries(m.capabilities).filter(([, v]) => v).map(([k]) => CAP_LABEL[k] ?? k).slice(0, 3);
          return (
            <div key={m.id} className="rounded-2xl border border-[#383A3E] bg-[#232426] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#9C542F]/25 text-[12px] font-bold text-[#E7893C]">
                    {m.display_name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">{m.display_name}</p>
                    <p className="truncate text-[10.5px] text-[#85888B]">{caps.join(" · ") || m.provider}</p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-[#9FD3A9]">
                  <span className="size-1.5 rounded-full bg-[#9FD3A9]" /> Aktif
                </span>
              </div>
              <div className="my-2.5 h-px bg-[#FAF8F4]/8" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[#85888B]">Input / 1M token</p>
                  <p className="text-[12.5px] font-semibold tabular-nums">{price1m(m.pricing_idr_per_1m.input)}</p>
                </div>
                <div className="border-l border-[#FAF8F4]/8 pl-3">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[#85888B]">Output / 1M token</p>
                  <p className="text-[12.5px] font-semibold tabular-nums">{price1m(m.pricing_idr_per_1m.output)}</p>
                </div>
              </div>
              <button type="button" onClick={() => onModel(m)} className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-[#E7893C]">
                Lihat detail <ArrowRight size={12} />
                {usageById.get(m.id) ? <span className="ml-1 text-[#85888B]">· {usageById.get(m.id)} req</span> : null}
              </button>
            </div>
          );
        })}
        {!rows.length ? <p className="rounded-xl border border-[#383A3E] bg-[#232426] p-4 text-[11.5px] text-[#85888B]">Tidak ada model yang cocok.</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ usage */

function UsageScreen({ usage, usage30, used, spend }: { usage: Usage | null; usage30: Usage | null; used: ModelUse[]; spend: number }) {
  const [days, setDays] = useState<7 | 30>(7);
  const data = days === 7 ? usage : usage30;
  const totals = data?.totals;

  return (
    <div className="mt-5">
      <h1 className="text-[24px] font-semibold tracking-[-0.03em]">Pemakaian</h1>
      <p className="mt-1 text-[12px] text-[#A1A3A7]">Semua angka dari ledger gateway yang sama dengan web.</p>

      <div className="mt-3 flex gap-2">
        {[7, 30].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d as 7 | 30)}
            className={cn("rounded-full border px-3 py-1.5 text-[11px]",
              days === d ? "border-[#9C542F] bg-[#9C542F]/25 text-[#F1D3B8]" : "border-[#383A3E] text-[#A1A3A7]")}>
            {d} hari
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {[
          { label: "Request", value: compact(totals?.requests ?? 0) },
          { label: "Biaya", value: idr(totals?.cost_micro ?? spend) },
          { label: "Token in", value: compact(totals?.tokens_in ?? 0) },
          { label: "Token out", value: compact(totals?.tokens_out ?? 0) },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-[#383A3E] bg-[#232426] p-3.5">
            <p className="text-[10.5px] text-[#85888B]">{s.label}</p>
            <p className="mt-0.5 text-[17px] font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-[#383A3E] bg-[#232426] p-4">
        <p className="text-[11.5px] text-[#A1A3A7]">Request per hari</p>
        <Sparkline points={(data?.daily ?? []).map((d) => d.requests)} />
        <div className="mt-1 flex justify-between text-[10px] text-[#85888B]">
          <span>{days} hari lalu</span><span>hari ini</span>
        </div>
      </div>

      <h2 className="mt-5 text-[15px] font-semibold">Per model</h2>
      <div className="mt-2 space-y-2">
        {used.slice(0, 6).map((m) => {
          const maxCost = Math.max(1, ...used.map((x) => x.cost_micro));
          return (
            <div key={m.model_id} className="rounded-xl border border-[#383A3E] bg-[#232426] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[12px] font-medium">{m.model_id}</p>
                <p className="shrink-0 text-[11px] tabular-nums text-[#A1A3A7]">{idr(m.cost_micro)}</p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#FAF8F4]/6">
                <div className="h-full rounded-full bg-[#E7893C]" style={{ width: `${Math.max(4, (m.cost_micro / maxCost) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-[#85888B]">{compact(m.requests)} request · in {compact(m.tokens_in)} / out {compact(m.tokens_out)} · {when(m.last_used_at)}</p>
            </div>
          );
        })}
        {!used.length ? <p className="rounded-xl border border-[#383A3E] bg-[#232426] p-4 text-[11.5px] text-[#85888B]">Belum ada pemakaian.</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ account */

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
      setMsg("Key baru aktif. Simpan sekarang — tidak ditampilkan lagi.");
      setConfirm(false);
      onRotated();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Gagal rotasi");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-[#2B2D30] text-[15px] font-semibold">{initials(me)}</span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{me?.buyer.name || "Tanpa nama"}</p>
          <p className="truncate text-[11.5px] text-[#85888B]">
            {me?.buyer.username ? `@${me.buyer.username}` : "Telegram"} · id {me?.buyer.tg_id ?? "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onTopUp} className="rounded-2xl border border-[#383A3E] bg-[#232426] p-3.5 text-left transition hover:bg-[#2B2D30]">
          <Wallet size={15} className="text-[#E7893C]" />
          <p className="mt-2 text-[12px] font-medium">Tambah saldo</p>
          <p className="text-[10.5px] text-[#85888B]">{idr(me?.balance_micro ?? 0)}</p>
        </button>
        <a href="/portal" className="rounded-2xl border border-[#383A3E] bg-[#232426] p-3.5 transition hover:bg-[#2B2D30]">
          <ArrowUpRight size={15} className="text-[#E7893C]" />
          <p className="mt-2 text-[12px] font-medium">Portal lengkap</p>
          <p className="text-[10.5px] text-[#85888B]">Dashboard web</p>
        </a>
      </div>

      <h2 className="mt-5 text-[15px] font-semibold">API keys</h2>
      <div className="mt-2 space-y-2">
        {(me?.keys ?? []).map((k: KeyRow) => (
          <div key={k.id} className="rounded-xl border border-[#383A3E] bg-[#232426] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[11.5px] text-[#FAF8F4]">{k.prefix}••••••••</p>
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]",
                k.status === "active" ? "bg-[#3E5E46]/35 text-[#9FD3A9]" : "bg-[#5E3E3E]/35 text-[#D3A9A9]")}>{k.status}</span>
            </div>
            <p className="mt-1 text-[10.5px] text-[#85888B]">{k.rpm_limit} req/menit · terakhir dipakai {when(k.last_used_at)}</p>
          </div>
        ))}
        {!(me?.keys ?? []).length ? (
          <p className="rounded-xl border border-[#383A3E] bg-[#232426] p-4 text-[11.5px] text-[#85888B]">
            Belum ada key. Selesaikan pembelian — key dikirim ke chat bot.
          </p>
        ) : null}
      </div>

      {reveal ? (
        <div className="mt-2 rounded-xl border border-[#E7893C]/40 bg-[#E7893C]/10 p-3">
          <p className="text-[10.5px] uppercase tracking-[0.1em] text-[#E7C9A8]">Key baru — sekali tampil</p>
          <div className="mt-1 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-[#FAF8F4]">{reveal}</code>
            <button type="button" aria-label="Salin"
              onClick={() => { navigator.clipboard?.writeText(reveal).catch(() => undefined); setMsg("Key disalin."); }}
              className="grid size-7 shrink-0 place-items-center rounded-md border border-[#E7893C]/40 text-[#FAF8F4]">
              <Copy size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {me?.keys.length ? (
        confirm ? (
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void rotate()}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#E7893C] text-[12px] font-semibold text-[#18191B] disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Ya, rotasi
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="h-10 flex-1 rounded-xl border border-[#383A3E] text-[12px] text-[#FAF8F4]">
              Batal
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)}
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#383A3E] text-[12px] text-[#FAF8F4] transition hover:bg-[#2B2D30]">
            <RefreshCw size={13} /> Rotasi key
          </button>
        )
      ) : null}

      <h2 className="mt-5 text-[15px] font-semibold">Pembelian</h2>
      <div className="mt-2 space-y-2">
        {orders.slice(0, 5).map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#383A3E] bg-[#232426] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-mono text-[10.5px]">{o.id}</p>
              <p className="text-[10px] text-[#85888B]">{o.sku} · {idr(o.price_idr * 1_000_000)}</p>
            </div>
            <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px]",
              o.status === "granted" ? "bg-[#3E5E46]/35 text-[#9FD3A9]" : "bg-[#FAF8F4]/6 text-[#A1A3A7]")}>{o.status}</span>
          </div>
        ))}
        {!orders.length ? <p className="text-[11.5px] text-[#85888B]">Belum ada pembelian.</p> : null}
      </div>

      {msg ? <p className="mt-3 text-[11.5px] text-[#E7893C]">{msg}</p> : null}

      <button type="button" onClick={() => { clearToken(); window.location.reload(); }}
        className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#383A3E] text-[12px] text-[#A1A3A7]">
        <LogOut size={13} /> Keluar dari sesi ini
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ sheets */

function TopUpSheet({ packages, token, onClose, onDone }: {
  packages: Pkg[]; token: string | null; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ order_id: string; price_idr: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (sku: string) => {
    if (!token) return;
    setBusy(sku); setErr(null);
    try {
      const o = await buy(token, sku);
      setInvoice({ order_id: o.order_id, price_idr: o.price_idr });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat order");
    } finally { setBusy(null); }
  };

  return (
    <Sheet onClose={onClose} title="Tambah saldo">
      {invoice ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#E7893C]/40 bg-[#E7893C]/10 p-3">
            <p className="text-[10.5px] uppercase tracking-[0.1em] text-[#E7C9A8]">Invoice dibuat</p>
            <p className="mt-1 font-mono text-[11px] text-[#FAF8F4]">{invoice.order_id}</p>
            <p className="mt-1 text-[15px] font-semibold">{idr(invoice.price_idr * 1_000_000)}</p>
          </div>
          <p className="text-[11.5px] leading-6 text-[#A1A3A7]">
            Pembayaran masih manual: transfer ke admin, lalu tekan “Saya sudah bayar” di bot.
            Saldo dan key masuk setelah admin konfirmasi — tidak ada kredit otomatis dari tombol.
          </p>
          <a href="https://t.me/AethinkBot" className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#E7893C] text-[12px] font-semibold text-[#18191B]">
            <Send size={13} /> Buka bot
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {packages.map((p) => (
            <button key={p.sku} type="button" disabled={busy !== null} onClick={() => void pick(p.sku)}
              className="flex w-full items-center justify-between rounded-xl border border-[#383A3E] bg-[#232426] px-3 py-3 text-left transition hover:bg-[#2B2D30] disabled:opacity-60">
              <div>
                <p className="text-[12.5px] font-semibold">{p.name}</p>
                <p className="text-[10.5px] text-[#85888B]">{p.rpm} req/menit · {p.blurb}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold tabular-nums">
                {busy === p.sku ? <Loader2 size={13} className="animate-spin" /> : null} {idr(p.credits_micro)}
              </span>
            </button>
          ))}
          {err ? <p className="text-[11.5px] text-[#E7893C]">{err}</p> : null}
        </div>
      )}
    </Sheet>
  );
}

function ModelSheet({ model, onClose }: { model: CatalogModel; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const caps = Object.entries(model.capabilities).filter(([, v]) => v).map(([k]) => CAP_LABEL[k] ?? k);
  return (
    <Sheet onClose={onClose} title={model.display_name}>
      <p className="text-[11.5px] text-[#85888B]">{model.provider} · <span className="font-mono">{model.id}</span></p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: "Input / 1M", value: price1m(model.pricing_idr_per_1m.input) },
          { label: "Output / 1M", value: price1m(model.pricing_idr_per_1m.output) },
          { label: "Cached / 1M", value: price1m(model.pricing_idr_per_1m.cached_input) },
        ].map((p) => (
          <div key={p.label} className="rounded-xl border border-[#383A3E] bg-[#0A0A0A] p-2.5">
            <p className="text-[9.5px] uppercase tracking-[0.08em] text-[#85888B]">{p.label}</p>
            <p className="mt-0.5 text-[12px] font-semibold tabular-nums">{p.value}</p>
          </div>
        ))}
      </div>
      <dl className="mt-3 space-y-1.5 text-[11.5px]">
        <div className="flex justify-between"><dt className="text-[#85888B]">Context</dt><dd className="tabular-nums">{model.context_length ? compact(model.context_length) + " token" : "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-[#85888B]">Max output</dt><dd className="tabular-nums">{model.max_completion_tokens ? compact(model.max_completion_tokens) + " token" : "—"}</dd></div>
      </dl>
      {caps.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {caps.map((c) => <span key={c} className="rounded-full border border-[#383A3E] px-2 py-0.5 text-[10px] text-[#A1A3A7]">{c}</span>)}
        </div>
      ) : null}
      <button type="button"
        onClick={() => { navigator.clipboard?.writeText(model.id).catch(() => undefined); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#383A3E] text-[12px] text-[#FAF8F4]">
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Model ID disalin" : "Salin model ID"}
      </button>
      <p className="mt-2 text-[10.5px] leading-5 text-[#85888B]">
        Base URL: <span className="font-mono">https://&lt;gateway&gt;/v1</span> · header <span className="font-mono">Authorization: Bearer sk-aeth_…</span>
      </p>
    </Sheet>
  );
}

function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-[440px] rounded-t-[22px] border border-[#383A3E] bg-[#1B1C1F] px-5 pb-[max(env(safe-area-inset-bottom),18px)] pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#383A3E]" />
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Tutup" className="grid size-7 place-items-center rounded-lg border border-[#383A3E] text-[#A1A3A7]">
            <X size={13} />
          </button>
        </div>
        <div className="mt-3 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
