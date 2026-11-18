import { useEffect, useMemo, useState } from "react";
import { Download, Filter, RotateCcw, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { FilterSelect } from "@/components/common/FilterSelect";
import { Button } from "@/components/common/Button";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { SearchInput } from "@/components/common/SearchInput";
import { StatusPill } from "@/components/common/StatusPill";
import { UsageChart } from "@/components/charts/UsageChart";
import { useToast } from "@/components/common/Toast";
import { useLive } from "@/lib/live";
import { adminRequests, adminUsers, type GwRequestRow } from "@/lib/gw";
import { modelNames } from "@/lib/gateway-data";
import type { Range, UsageEntry } from "@/types";
import { buildSeries, seriesTotals } from "@/lib/series";
import { settle } from "@/lib/async";
import { formatCompact, formatDateTime, formatIDR, formatNumber } from "@/lib/format";
import { downloadCSV, toCSV } from "@/lib/csv";

type Row = {
  id: string;
  at: string;
  email: string;
  modelId: string;
  modelName: string;
  inTokens: number;
  outTokens: number;
  cost: number;
  status: string;
  latency: number;
};

export default function AdminUsagePage() {
  const { toast } = useToast();
  const [range, setRange] = useState<Range>(30);
  const [userFilter, setUserFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [chartMode, setChartMode] = useState<"requests" | "cost">("requests");

  const [rowsRaw, setRowsRaw] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      [settle(adminRequests(range, 500)), settle(adminUsers()), settle(modelNames())] as const,
    )
      .then(([reqs, users, nameMap]) => {
        if (cancelled) return;
        if (nameMap) setNames(nameMap);
        if (users) setEmails(users.users.map((u) => u.email));
        if (reqs)
          setRowsRaw(
          reqs.requests.map((row: GwRequestRow) => ({
            id: row.id,
            at: row.created_at,
            email: row.email ?? "n/a",
            modelId: row.model_id,
            modelName: row.display_name ?? row.model_id,
            inTokens: Number(row.tokens_in ?? 0),
            outTokens: Number(row.tokens_out ?? 0),
            cost: Number(row.cost_micro ?? 0) / 1_000_000,
            status: row.status === "ok" ? "success" : "error",
            latency: Number(row.latency_ms ?? 0),
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useLive("admin", {
    onStatus: setLive,
    onRows: (incoming) => {
      const mapped: Row[] = incoming
        .filter((row) => row.email)
        .map((row) => ({
          id: String(row.id),
          at: String(row.created_at),
          email: String(row.email ?? "n/a"),
          modelId: String(row.model_id),
          modelName: String(row.display_name ?? row.model_id),
          inTokens: Number(row.tokens_in ?? 0),
          outTokens: Number(row.tokens_out ?? 0),
          cost: Number(row.cost_micro ?? 0) / 1_000_000,
          status: row.status === "ok" ? "success" : "error",
          latency: Number(row.latency_ms ?? 0),
        }));
      if (!mapped.length) return;
      setRowsRaw((prev) => [...mapped, ...prev].slice(0, 800));
      setEmails((prev) => Array.from(new Set([...prev, ...mapped.map((row) => row.email)])));
    },
  });

  const scoped = useMemo(
    () =>
      rowsRaw
        .filter((row) => userFilter === "all" || row.email === userFilter)
        .filter((row) => modelFilter === "all" || row.modelId === modelFilter),
    [rowsRaw, userFilter, modelFilter],
  );

  const chartEntries = useMemo<UsageEntry[]>(
    () =>
      scoped.map((row) => ({
        id: row.id,
        userId: row.email,
        keyId: "",
        modelId: row.modelId,
        at: row.at,
        inputTokens: row.inTokens,
        outputTokens: row.outTokens,
        status: row.status === "success" ? "success" : "error",
        latencyMs: row.latency,
        cost: row.cost,
      })) as UsageEntry[],
    [scoped],
  );

  const series = useMemo(() => buildSeries(chartEntries, range, "all", "all"), [chartEntries, range]);
  const totals = useMemo(() => seriesTotals(series), [series]);

  const rows = useMemo(
    () =>
      scoped
        .filter((row) => statusFilter === "all" || row.status === statusFilter)
        .filter((row) => {
          if (!query) return true;
          return `${row.modelName} ${row.email} ${row.status}`
            .toLowerCase()
            .includes(query.toLowerCase());
        }),
    [scoped, statusFilter, query, names],
  );

  const exportCSV = () => {
    const csv = toCSV(
      rows.map((row) => ({
        time: formatDateTime(row.at),
        user: row.email,
        model: row.modelName,
        input_tokens: row.inTokens,
        output_tokens: row.outTokens,
        status: row.status,
        latency_ms: row.latency,
        cost_idr: row.cost,
      })),
    );
    downloadCSV(`aethinkai-admin-usage-${range}d.csv`, csv);
    toast("CSV diekspor", { description: `${rows.length} rows exported.` });
  };

  const reset = () => {
    setRange(30);
    setUserFilter("all");
    setModelFilter("all");
    setStatusFilter("all");
    setQuery("");
    toast("Filter dikosongkan", { variant: "info" });
  };

  const columns: Array<Column<Row>> = [
    {
      key: "at",
      header: "Waktu",
      sortValue: (row) => row.at,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatDateTime(row.at)}</span>,
    },
    {
      key: "user",
      header: "User",
      sortValue: (row) => row.email,
      render: (row) => <span className="text-warm/90">{row.email}</span>,
    },
    {
      key: "model",
      header: "Model",
      hideBelow: "sm",
      render: (row) => <span className="text-ash">{row.modelName}</span>,
    },
    {
      key: "tokens",
      header: "Token",
      align: "right",
      hideBelow: "md",
      sortValue: (row) => row.inTokens + row.outTokens,
      render: (row) => <span className="tabular-nums text-ash">{formatCompact(row.inTokens + row.outTokens)}</span>,
    },
    {
      key: "cost",
      header: "Biaya",
      align: "right",
      sortValue: (row) => row.cost,
      render: (row) => <span className="tabular-nums text-warm/80">{formatIDR(row.cost)}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => <StatusPill tone={row.status === "success" ? "success" : "error"}>{row.status}</StatusPill>,
    },
  ];

  const mix = useMemo(() => {
    const counts = new Map<string, number>();
    scoped.forEach((row) => counts.set(row.modelId, (counts.get(row.modelId) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [scoped]);

  return (
    <div>
      <PageHeader
        title="Analitik pemakaian"
        description="Telemetri request teragregasi, lengkap dengan filter dan ekspor CSV."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Pemakaian" }]}
        actions={
          <>
            <StatusPill tone={live === "live" ? "active" : live === "offline" ? "warning" : "neutral"} dot={live !== "offline"}>
              {live === "live" ? "Live" : live === "offline" ? "Reconnecting" : "Connecting"}
            </StatusPill>
            <DateRangeTabs value={range} onChange={setRange} />
            <Button variant="secondary" size="sm" leadingIcon={<Download size={13} />} onClick={exportCSV}>Ekspor CSV</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Request", value: formatNumber(totals.requests) },
          { label: "Token", value: formatCompact(totals.tokens) },
          { label: "Gagal", value: formatNumber(totals.errors) },
          { label: "Biaya terukur", value: formatIDR(totals.cost) },
        ].map((item) => (
          <div key={item.label} className="surface p-4">
            <p className="text-[12px] text-ash">{item.label}</p>
            <p className="mt-2 text-[20px] font-semibold tabular-nums text-warm">{item.value}</p>
          </div>
        ))}
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12px] text-ash">
            <Filter size={12} aria-hidden />Filter</span>
          <FilterSelect
            label="User"
            value={userFilter}
            onChange={setUserFilter}
            options={[{ value: "all", label: "Semua pengguna" }, ...emails.map((email) => ({ value: email, label: email }))]}
          />
          <FilterSelect
            label="Model"
            value={modelFilter}
            onChange={setModelFilter}
            options={[{ value: "all", label: "Semua model" }, ...Object.entries(names).map(([id, label]) => ({ value: id, label }))]}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "Semua status" },
              { value: "success", label: "Success" },
              { value: "error", label: "Error" },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Cari pengguna, model, atau status…" className="w-full sm:w-56" />
          <Button variant="ghost" size="sm" leadingIcon={<RotateCcw size={12} />} onClick={reset} className="ml-auto">Atur ulang</Button>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title={chartMode === "requests" ? "Request volume" : "Metered spend"}
            description={`${range} hari · ${rows.length} entri cocok`}
            action={
              <div className="inline-flex rounded-lg border border-ash/20 p-1">
                {(["requests", "cost"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setChartMode(mode)}
                    aria-pressed={chartMode === mode}
                    className={`h-11 rounded-lg px-3.5 text-[12px] capitalize transition active:scale-[0.98] sm:h-8 sm:rounded-md sm:px-3 sm:text-[12px] ${
                      chartMode === mode ? "bg-flame text-[#1a1305]" : "text-ash hover:text-warm"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            }
          />
          <div className="mt-4">
            <UsageChart data={series} mode={chartMode === "cost" ? "cost" : "requests"} height={260} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Komposisi traffic" description="Request per model pada rentang ini" />
          <ul className="mt-3 space-y-2">
            {mix.map(({ id, count }) => {
              const max = Math.max(1, scoped.length);
              return (
                <li key={id}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="truncate text-warm/85">
                      {rowsRaw.find((r) => r.modelId === id)?.modelName ?? names[id] ?? id}
                    </span>
                    <span className="tabular-nums text-ash">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ash/12">
                    <div
                      className="h-full rounded-full bg-flame/80"
                      style={{ width: `${Math.max(count ? 4 : 0, (count / max) * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
            {mix.length === 0 ? <li className="text-[12px] text-ash">Belum ada request.</li> : null}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 p-0">
        <div className="border-b border-ash/12 px-5 py-4">
          <h3 className="text-[15px] font-semibold text-warm">Tabel aktivitas</h3>
          <p className="mt-0.5 text-[12px] text-ash">{rows.length} requests after filters.</p>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          pageSize={10}
          caption="Admin usage table"
          empty={
            <EmptyState
              icon={Search}
              title={loading ? "Memuat dari gateway…" : "Tidak ada baris yang cocok"}
              description={loading ? "Sebentar." : "Reset filters to see the full dataset."}
              action={
                <Button size="sm" variant="secondary" onClick={reset}>
                  Reset filters
                </Button>
              }
            />
          }
        />
      </Card>
    </div>
  );
}
