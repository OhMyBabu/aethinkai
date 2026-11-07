import { useEffect, useMemo, useState } from "react";
import { Download, Filter, RotateCcw, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { FilterSelect } from "@/components/common/FilterSelect";
import { Button } from "@/components/common/Button";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { SearchInput } from "@/components/common/SearchInput";
import { StatusPill } from "@/components/common/StatusPill";
import { UsageChart } from "@/components/charts/UsageChart";
import { useToast } from "@/components/common/Toast";
import { listKeys, meRequests, type GwKey } from "@/lib/gw";
import { modelNames, toUsageEntry } from "@/lib/gateway-data";
import { useLive } from "@/lib/live";
import type { Range, UsageEntry } from "@/types";
import { buildSeries, seriesTotals } from "@/lib/series";
import { settle } from "@/lib/async";
import { formatCompact, formatDateTime, formatIDR, formatNumber } from "@/lib/format";
import { downloadCSV, toCSV } from "@/lib/csv";

export default function UserUsagePage() {
  const { toast } = useToast();

  const [range, setRange] = useState<Range>(30);
  const [model, setModel] = useState("all");
  const [keyName, setKeyName] = useState("all");
  const [query, setQuery] = useState("");

  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<GwKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      [settle(meRequests(range, 300)), settle(listKeys()), settle(modelNames())] as const,
    )
      .then(([reqs, keyList, nameMap]) => {
        if (cancelled) return;
        if (reqs) setUsage(reqs.requests.map(toUsageEntry));
        if (keyList) setKeys(keyList.keys);
        if (nameMap || reqs) {
          setNames({
            ...(nameMap ?? {}),
            ...Object.fromEntries(
              (reqs?.requests ?? []).map((r) => [r.model_id, r.display_name ?? r.model_id]),
            ),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useLive("me", {
    onStatus: setLive,
    onRows: (incoming) => {
      const mapped = incoming
        .map((row) => toUsageEntry({
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
        } as never))
        .filter(Boolean);
      if (!mapped.length) return;
      setUsage((prev) => {
        const seen = new Set(prev.map((entry) => entry.id));
        return [...mapped.filter((entry) => !seen.has(entry.id)), ...prev].slice(0, 600);
      });
      setNames((prev) => ({
        ...prev,
        ...Object.fromEntries(incoming.map((row) => [String(row.model_id), String(row.display_name ?? row.model_id)])),
      }));
    },
  });

  const series = useMemo(
    () => buildSeries(usage, range, model, keyName === "all" ? "all" : keyName),
    [usage, range, model, keyName],
  );
  const totals = useMemo(() => seriesTotals(series), [series]);

  const rows = useMemo(
    () =>
      usage
        .filter((entry) => model === "all" || entry.modelId === model)
        .filter((entry) => keyName === "all" || entry.keyId === keyName)
        .filter((entry) => {
          if (!query) return true;
          return `${names[entry.modelId] ?? entry.modelId} ${entry.keyId} ${entry.status}`
            .toLowerCase()
            .includes(query.toLowerCase());
        }),
    [usage, model, keyName, query, names],
  );

  const resetFilters = () => {
    setRange(30);
    setModel("all");
    setKeyName("all");
    setQuery("");
    toast("Filters reset", { description: "Showing the last 30 days across all models and keys.", variant: "info" });
  };

  const exportCSV = () => {
    const csv = toCSV(
      rows.map((entry) => ({
        time: formatDateTime(entry.at),
        model: names[entry.modelId] ?? entry.modelId,
        key: entry.keyId || "—",
        input_tokens: entry.inputTokens,
        output_tokens: entry.outputTokens,
        status: entry.status,
        latency_ms: entry.latencyMs,
        cost_idr: entry.cost ?? 0,
      })),
    );
    downloadCSV(`aethinkai-usage-${range}d.csv`, csv);
    toast("CSV exported", { description: `${rows.length} rows exported.` });
  };

  const columns: Array<Column<UsageEntry>> = [
    {
      key: "at",
      header: "Timestamp",
      sortValue: (row) => row.at,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatDateTime(row.at)}</span>,
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
      header: "In / out",
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
      key: "cost",
      header: "Cost",
      align: "right",
      sortValue: (row) => row.cost ?? 0,
      render: (row) => <span className="tabular-nums text-warm/80">{formatIDR(row.cost ?? 0)}</span>,
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
      hideBelow: "lg",
      sortValue: (row) => row.latencyMs,
      render: (row) => <span className="tabular-nums text-ash">{row.latencyMs} ms</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Usage & Logs"
        description="Every filter recomputes the chart and table from your recorded requests."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "Usage" }]}
        actions={
          <>
            <StatusPill tone={live === "live" ? "active" : live === "offline" ? "warning" : "neutral"} dot={live !== "offline"}>
              {live === "live" ? "Live" : live === "offline" ? "Reconnecting" : "Connecting"}
            </StatusPill>
            <DateRangeTabs value={range} onChange={setRange} />
            <Button variant="secondary" size="sm" leadingIcon={<Download size={13} />} onClick={exportCSV}>
              Export CSV
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-ash">
            <Filter size={12} aria-hidden /> Filters
          </span>
          <FilterSelect
            label="Model"
            value={model}
            onChange={setModel}
            options={[
              { value: "all", label: "All models" },
              ...Object.entries(names).map(([id, label]) => ({ value: id, label })),
            ]}
          />
          <FilterSelect
            label="API key"
            value={keyName}
            onChange={setKeyName}
            options={[
              { value: "all", label: "All keys" },
              ...keys.map((key) => ({ value: key.name, label: key.name })),
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Search model, key, status…" className="w-full sm:w-64" />
          <Button variant="ghost" size="sm" leadingIcon={<RotateCcw size={12} />} onClick={resetFilters} className="ml-auto">
            Reset filters
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Requests", value: formatNumber(totals.requests) },
          { label: "Successful", value: formatNumber(totals.requests - totals.errors) },
          { label: "Failed", value: formatNumber(totals.errors) },
          { label: "Metered cost", value: formatIDR(totals.cost) },
        ].map((item) => (
          <div key={item.label} className="surface p-4">
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-ash">{item.label}</p>
            <p className="mt-2 text-[20px] font-semibold tabular-nums text-warm">{item.value}</p>
          </div>
        ))}
      </div>

      <Card className="mt-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-warm">Traffic over time</h3>
            <p className="mt-0.5 text-[12px] text-ash">
              {range} days · {model === "all" ? "all models" : names[model] ?? model} ·{" "}
              {keyName === "all" ? "all keys" : keyName}
            </p>
          </div>
          <StatusPill tone="active" dot={false}>
            {loading ? "Syncing" : "Metered"}
          </StatusPill>
        </div>
        <UsageChart data={series} height={280} />
      </Card>

      <Card className="mt-4 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ash/12 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-warm">Request log</h3>
            <p className="mt-0.5 text-[12px] text-ash">{rows.length} requests match the filters.</p>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          pageSize={10}
          caption="Filtered request log"
          empty={
            <EmptyState
              icon={Search}
              title={loading ? "Memuat dari gateway…" : "Nothing matches those filters"}
              description={loading ? "Sebentar." : "Widen the date range or clear the model and key filters."}
              action={
                <Button size="sm" variant="secondary" onClick={resetFilters}>
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
