import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Boxes, Coins, KeyRound, Search, Timer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { Card, CardHeader } from "@/components/common/Card";
import { UsageChart } from "@/components/charts/UsageChart";
import { ModelBars } from "@/components/charts/ModelBars";
import { DataTable, type Column } from "@/components/common/DataTable";
import { SearchInput } from "@/components/common/SearchInput";
import { StatusPill } from "@/components/common/StatusPill";
import { Button } from "@/components/common/Button";
import { EmptyState } from "@/components/common/EmptyState";
import { listKeys, me, meRequests, meSummary, type GwMeSummary } from "@/lib/gw";
import { modelNames, toUsageEntry } from "@/lib/gateway-data";
import { useLive } from "@/lib/live";
import type { Range, UsageEntry } from "@/types";
import { buildSeries, delta, seriesTotals } from "@/lib/series";
import { failedCount, settle } from "@/lib/async";
import { formatCompact, formatIDR, formatNumber, formatTime } from "@/lib/format";

export default function UserOverviewPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(7);
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<GwMeSummary | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [activeKeys, setActiveKeys] = useState(0);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [partialFail, setPartialFail] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // settle() per call: a single failed endpoint must not zero the dashboard.
    Promise.all(
      [
        settle(me()),
        settle(meSummary()),
        settle(meRequests(range, 200)),
        settle(listKeys()),
        settle(modelNames()),
      ] as const,
    )
      .then(([profile, sum, reqs, keys, nameMap]) => {
        if (cancelled) return;
        setPartialFail(failedCount([profile, sum, reqs, keys, nameMap]));
        if (profile) setEmail(profile.user.email);
        if (sum) setSummary(sum);
        if (reqs) setUsage(reqs.requests.map(toUsageEntry));
        if (nameMap || reqs) {
          setNames({
            ...(nameMap ?? {}),
            ...Object.fromEntries(
              (reqs?.requests ?? []).map((r) => [r.model_id, r.display_name ?? r.model_id]),
            ),
          });
        }
        if (keys) setActiveKeys(keys.keys.filter((k) => !k.revoked_at).length);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useLive("me", {
    onRows: (incoming) => {
      const rows = incoming.map((row) =>
        toUsageEntry({
          id: String(row.id),
          model_id: String(row.model_id),
          display_name: String(row.display_name ?? row.model_id),
          tokens_in: Number(row.tokens_in ?? 0),
          tokens_out: Number(row.tokens_out ?? 0),
          cost_micro: Number(row.cost_micro ?? 0),
          latency_ms: Number(row.latency_ms ?? 0),
          status: String(row.status ?? "ok"),
          created_at: String(row.created_at),
          key_name: String(row.key_name ?? ""),
        } as never),
      );
      if (!rows.length) return;
      setUsage((prev) => {
        const seen = new Set(prev.map((entry) => entry.id));
        return [...rows.filter((entry) => !seen.has(entry.id)), ...prev].slice(0, 400);
      });
      setNames((prev) => ({
        ...prev,
        ...Object.fromEntries(incoming.map((row) => [String(row.model_id), String(row.display_name ?? row.model_id)])),
      }));
    },
    onSummary: (summary) =>
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              balance_micro: Number(summary.balance_micro ?? prev.balance_micro),
              spend_today: Number(summary.spend_today ?? prev.spend_today),
              spend_30d: Number(summary.spend_30d ?? prev.spend_30d),
              requests_30d: Number(summary.requests_30d ?? prev.requests_30d),
            }
          : prev,
      ),
  });

  const series = useMemo(() => buildSeries(usage, range, "all", "all"), [usage, range]);
  const totals = useMemo(() => seriesTotals(series), [series]);
  const previous = useMemo(() => {
    const doubled = buildSeries(usage, (range * 2) as Range, "all", "all");
    return seriesTotals(doubled.slice(0, range));
  }, [usage, range]);

  const topModels = useMemo(() => {
    const counts = new Map<string, number>();
    usage.forEach((entry) => counts.set(entry.modelId, (counts.get(entry.modelId) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([modelId, value]) => ({ label: names[modelId] ?? modelId, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
  }, [usage, names]);

  const recent = useMemo(
    () =>
      usage
        .filter((entry) => {
          if (!query) return true;
          const model = names[entry.modelId] ?? entry.modelId;
          return `${model} ${entry.keyId} ${entry.status}`.toLowerCase().includes(query.toLowerCase());
        })
        .slice(0, 40),
    [usage, query, names],
  );

  const columns: Array<Column<UsageEntry>> = [
    {
      key: "time",
      header: "Time",
      sortValue: (row) => row.at,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatTime(row.at)}</span>,
    },
    {
      key: "model",
      header: "Model",
      render: (row) => <span className="font-medium text-warm">{names[row.modelId] ?? row.modelId}</span>,
    },
    {
      key: "key",
      header: "Key",
      hideBelow: "md",
      render: (row) => <span className="text-ash">{row.keyId || "—"}</span>,
    },
    {
      key: "tokens",
      header: "Tokens in / out",
      align: "right",
      hideBelow: "sm",
      sortValue: (row) => row.inputTokens + row.outputTokens,
      render: (row) => (
        <span className="tabular-nums text-ash">
          {formatCompact(row.inputTokens)} / {formatCompact(row.outputTokens)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => <StatusPill tone={row.status === "success" ? "success" : "error"}>{row.status}</StatusPill>,
    },
    {
      key: "latency",
      header: "Latency",
      align: "right",
      sortValue: (row) => row.latencyMs,
      render: (row) => <span className="tabular-nums text-ash">{row.latencyMs} ms</span>,
    },
  ];

  const balanceIdr = (summary?.balance_micro ?? 0) / 1_000_000;
  const greeting = email ? email.split("@")[0] : "there";

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${greeting}`}
        description="How your gateway traffic is behaving this period."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "Overview" }]}
        actions={<DateRangeTabs value={range} onChange={setRange} />}
      />

      {partialFail > 0 ? (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[12px] text-warm/80">
          {partialFail} endpoint gagal dimuat — angka di bawah hanya dari data yang berhasil. Cek koneksi lalu muat ulang.
        </div>
      ) : null}

      <div className="relative mb-4 overflow-hidden rounded-[18px] border border-white/8 bg-[radial-gradient(120%_100%_at_16%_0%,rgba(255,255,255,0.055),transparent_62%)] p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-white/5 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ash">Saldo gateway</p>
            <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] text-warm tabular-nums sm:text-[36px]">
              {formatIDR(balanceIdr)}
            </p>
            <p className="mt-2 text-[12px] text-ash">
              {formatIDR((summary?.spend_today ?? 0) / 1_000_000)} terpakai hari ini ·{" "}
              {activeKeys} key aktif
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" leadingIcon={<KeyRound size={14} />} onClick={() => navigate("/app/api-keys")}>
              Create key
            </Button>
            <Button variant="secondary" leadingIcon={<ArrowRight size={14} />} onClick={() => navigate("/app/usage")}>
              Lihat usage
            </Button>
          </div>
        </div>
        <div className="relative mt-5 grid gap-3 border-t border-warm/10 pt-4 sm:grid-cols-3">
          {[
            { label: "Requests", value: formatNumber(totals.requests) },
            { label: "Tokens", value: formatCompact(totals.tokens) },
            { label: "Error rate", value: `${totals.requests ? ((totals.errors / totals.requests) * 100).toFixed(1) : "0.0"}%` },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-ash">{item.label}</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-warm">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Credits balance"
          value={balanceIdr}
          format={(value) => formatIDR(value)}
          deltaLabel={`${formatIDR((summary?.spend_today ?? 0) / 1_000_000)} today`}
          icon={Coins}
        />
        <StatCard
          label="Requests"
          value={totals.requests}
          format={(value) => formatNumber(value)}
          delta={delta(totals.requests, previous.requests)}
          icon={ArrowRight}
        />
        <StatCard
          label="Token usage"
          value={totals.tokens}
          format={(value) => formatCompact(value)}
          delta={delta(totals.tokens, previous.tokens)}
          icon={Boxes}
        />
        <StatCard
          label="Active API keys"
          value={activeKeys}
          deltaLabel={`${activeKeys} active`}
          icon={KeyRound}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Requests & tokens"
            description={`Last ${range} days of requests`}
            action={
              <StatusPill tone="active" dot={false}>
                {loading ? "Syncing" : "Live"}
              </StatusPill>
            }
          />
          <div className="mt-4">
            <UsageChart data={series} height={280} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Top models" description="By request count in range" />
            <ModelBars data={topModels} className="mt-3" />
          </Card>
          <Card>
            <CardHeader title="Quick actions" />
            <div className="mt-3 grid gap-2">
              <Button variant="primary" size="sm" full leadingIcon={<KeyRound size={14} />} onClick={() => navigate("/app/api-keys")}>
                Create API key
              </Button>
              <Button variant="secondary" size="sm" full leadingIcon={<Boxes size={14} />} onClick={() => navigate("/app/models")}>
                Browse models
              </Button>
              <Button variant="ghost" size="sm" full leadingIcon={<Timer size={14} />} onClick={() => navigate("/app/usage")}>
                View usage
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-4 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h3 className="text-[15px] font-semibold text-warm">Recent requests</h3>
            <p className="mt-1 text-[12.5px] text-ash">Most recent 40 responses from the gateway.</p>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Filter model or key…" className="w-full sm:w-64" />
            <Link to="/app/usage" className="hidden items-center gap-1 text-[12px] text-flame hover:underline sm:flex">
              Full log <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={recent}
          rowKey={(row) => row.id}
          pageSize={8}
          caption="Recent requests"
          empty={
            <EmptyState
              icon={Search}
              title={loading ? "Memuat dari gateway…" : "No requests match that filter"}
              description={loading ? "Sebentar." : "Your first request will show up here."}
            />
          }
        />
      </Card>

      <p className="mt-4 text-[11px] text-dim">
        {Object.keys(names).length} models enabled by the gateway · usage metered per request · saldo {formatIDR(balanceIdr)}
      </p>
    </div>
  );
}
