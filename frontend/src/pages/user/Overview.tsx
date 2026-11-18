import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { Card, CardHeader } from "@/components/common/Card";
import { UsageChart } from "@/components/charts/UsageChart";
import { ModelBars } from "@/components/charts/ModelBars";
import { DataTable, type Column } from "@/components/common/DataTable";
import { SearchInput } from "@/components/common/SearchInput";
import { StatusPill } from "@/components/common/StatusPill";
import { Button } from "@/components/common/Button";
import { EmptyState } from "@/components/common/EmptyState";
import { listKeys, me, meRequests, meSummary, meUsage, type GwMeSummary, type GwUsage } from "@/lib/gw";
import { modelNames, toUsageEntry } from "@/lib/gateway-data";
import { useLive } from "@/lib/live";
import type { Range, UsageEntry } from "@/types";
import { delta, previousTotals, seriesFromUsage, seriesTotals } from "@/lib/series";
import { failedCount, settle } from "@/lib/async";
import { formatCompact, formatIDR, formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";

function Delta({ value, invert }: { value: number; invert?: boolean }) {
  if (!Number.isFinite(value)) return <span className="text-[12px] text-dim">belum ada pembanding</span>;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span className={cn("num text-[12px] font-medium", good ? "text-ok" : "text-bad")}>
      {value >= 0 ? "+" : "−"}
      {Math.abs(value).toFixed(1)}% <span className="font-normal text-ash">vs periode lalu</span>
    </span>
  );
}

export default function UserOverviewPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(7);
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<GwMeSummary | null>(null);
  const [aggregate, setAggregate] = useState<GwUsage | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [activeKeys, setActiveKeys] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [partialFail, setPartialFail] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      [
        settle(me()),
        settle(meSummary()),
        settle(meUsage(range * 2)),
        settle(meRequests(range, 40)),
        settle(listKeys()),
        settle(modelNames()),
      ] as const,
    )
      .then(([profile, sum, agg, reqs, keys, nameMap]) => {
        if (cancelled) return;
        setPartialFail(failedCount([profile, sum, agg, reqs, keys, nameMap]));
        if (profile) setEmail(profile.user.email);
        if (sum) setSummary(sum);
        if (agg) setAggregate(agg);
        if (reqs) setUsage(reqs.requests.map(toUsageEntry));
        setNames({
          ...(nameMap ?? {}),
          ...Object.fromEntries((reqs?.requests ?? []).map((r) => [r.model_id, r.display_name ?? r.model_id])),
        });
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
        return [...rows.filter((entry) => !seen.has(entry.id)), ...prev].slice(0, 40);
      });
      setNames((prev) => ({
        ...prev,
        ...Object.fromEntries(incoming.map((row) => [String(row.model_id), String(row.display_name ?? row.model_id)])),
      }));
    },
    onSummary: (live) =>
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              balance_micro: Number(live.balance_micro ?? prev.balance_micro),
              spend_today: Number(live.spend_today ?? prev.spend_today),
              spend_30d: Number(live.spend_30d ?? prev.spend_30d),
              requests_30d: Number(live.requests_30d ?? prev.requests_30d),
            }
          : prev,
      ),
  });

  const series = useMemo(() => seriesFromUsage(aggregate, range), [aggregate, range]);
  const totals = useMemo(() => seriesTotals(series), [series]);
  const previous = useMemo(() => previousTotals(aggregate, range), [aggregate, range]);

  const topModels = useMemo(() => {
    const cutoff = series[0]?.date ?? "";
    const counts = new Map<string, number>();
    (aggregate?.by_day_model ?? [])
      .filter((row) => row.day.slice(0, 10) >= cutoff)
      .forEach((row) => counts.set(row.model_id, (counts.get(row.model_id) ?? 0) + row.requests));
    return Array.from(counts.entries())
      .map(([modelId, value]) => ({ label: names[modelId] ?? modelId, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [aggregate, series, names]);

  const recent = useMemo(
    () =>
      usage.filter((entry) => {
        if (!query) return true;
        const model = names[entry.modelId] ?? entry.modelId;
        return `${model} ${entry.keyId} ${entry.status}`.toLowerCase().includes(query.toLowerCase());
      }),
    [usage, query, names],
  );

  const columns: Array<Column<UsageEntry>> = [
    {
      key: "time",
      header: "Waktu",
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
      render: (row) => <span className="text-ash">{row.keyId || "n/a"}</span>,
    },
    {
      key: "tokens",
      header: "Token masuk / keluar",
      align: "right",
      hideBelow: "sm",
      sortValue: (row) => row.inputTokens + row.outputTokens,
      render: (row) => (
        <span className="num text-ash">
          {formatCompact(row.inputTokens)} / {formatCompact(row.outputTokens)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <StatusPill tone={row.status === "success" ? "success" : "error"}>
          {row.status === "success" ? "berhasil" : "gagal"}
        </StatusPill>
      ),
    },
    {
      key: "latency",
      header: "Latensi",
      align: "right",
      sortValue: (row) => row.latencyMs,
      render: (row) => <span className="num text-ash">{row.latencyMs} ms</span>,
    },
  ];

  const balanceIdr = summary ? summary.balance_micro / 1_000_000 : null;
  const sample = usage.length;
  const sampleErrors = usage.filter((entry) => entry.status === "error").length;
  const greeting = email ? email.split("@")[0] : null;

  return (
    <div>
      <PageHeader
        title={greeting ? `Halo, ${greeting}` : "Ringkasan"}
        description="Saldo dan pemakaian gateway kamu."
        actions={<DateRangeTabs value={range} onChange={setRange} />}
      />

      {partialFail > 0 ? (
        <div role="status" className="mb-4 rounded-lg border border-flame/25 bg-flame/[0.07] px-4 py-2.5 text-[13px] text-warm/90">
          {partialFail} data gagal dimuat, jadi angka di bawah belum lengkap. Muat ulang halaman untuk mencoba lagi.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="flex flex-col justify-between">
          <div>
            <p className="text-[13px] text-ash">Saldo</p>
            <p className="num mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] text-warm sm:text-[40px]">
              {balanceIdr === null ? (loading ? "…" : "n/a") : formatIDR(balanceIdr)}
            </p>
            <p className="mt-3 text-[13px] leading-5 text-ash">
              {summary ? `${formatIDR(summary.spend_today / 1_000_000)} terpakai hari ini` : "Memuat pemakaian hari ini"}
              {activeKeys !== null ? ` · ${activeKeys} key aktif` : ""}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" leadingIcon={<Plus size={15} />} onClick={() => navigate("/app/billing")}>
              Tambah saldo
            </Button>
            <Button variant="secondary" leadingIcon={<KeyRound size={15} />} onClick={() => navigate("/app/api-keys")}>
              Kelola key
            </Button>
          </div>
        </Card>

        <Card padded={false}>
          <dl className="grid grid-cols-1 divide-y divide-white/8 sm:h-full sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { label: "Request", value: formatNumber(totals.requests), change: delta(totals.requests, previous.requests) },
              { label: "Token", value: formatCompact(totals.tokens), change: delta(totals.tokens, previous.tokens) },
              { label: "Biaya", value: formatIDR(totals.cost), change: delta(totals.cost, previous.cost), invert: true },
            ].map((item) => (
              <div key={item.label} className="flex flex-col justify-center p-4 sm:p-5">
                <dt className="text-[13px] text-ash">{item.label} · {range} hari</dt>
                <dd className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm">{item.value}</dd>
                <div className="mt-2.5">
                  <Delta value={item.change} invert={item.invert} />
                </div>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Pemakaian harian"
            description={`${range} hari terakhir`}
            action={loading ? <span className="text-[12px] text-ash">Memuat…</span> : null}
          />
          <div className="mt-4">
            <UsageChart data={series} height={260} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Model terpakai" description={`Berdasarkan jumlah request, ${range} hari`} />
          <ModelBars data={topModels} className="mt-3" />
        </Card>
      </div>

      <Card className="mt-4" padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div>
            <h3 className="text-[14px] font-semibold text-warm">Request terbaru</h3>
            <p className="mt-0.5 text-[12.5px] text-ash">
              {sample > 0 && sampleErrors > 0
                ? `${sampleErrors} dari ${sample} request terakhir gagal.`
                : "Respons terbaru dari gateway."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Cari model atau key…" className="w-full sm:w-60" />
            <Link to="/app/usage" className="hidden items-center gap-1 whitespace-nowrap text-[13px] text-flame hover:underline sm:flex">
              Semua log <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={recent}
          rowKey={(row) => row.id}
          pageSize={8}
          caption="Request terbaru"
          empty={
            <EmptyState
              icon={Search}
              title={loading ? "Memuat dari gateway…" : query ? "Tidak ada request yang cocok" : "Belum ada request"}
              description={loading ? "Sebentar." : query ? "Coba kata kunci lain." : "Request pertama kamu akan muncul di sini."}
            />
          }
        />
      </Card>
    </div>
  );
}
