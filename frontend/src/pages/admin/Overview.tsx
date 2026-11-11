import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Boxes, Coins, Plus, Users, Activity } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Card, CardHeader } from "@/components/common/Card";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { UsageChart } from "@/components/charts/UsageChart";
import { ModelBars } from "@/components/charts/ModelBars";
import { Button } from "@/components/common/Button";
import { StatusPill } from "@/components/common/StatusPill";
import { cn } from "@/lib/cn";
import {
  adminAudit,
  adminTraffic,
  adminModels,
  adminRequests,
  adminSummary,
  adminUsers,
  type GwAudit,
  type GwTrafficIp,
  type GwAdminUser as GwUser,
  type GwModel,
} from "@/lib/gw";
import { modelNames, toUsageEntry } from "@/lib/gateway-data";
import { useLive } from "@/lib/live";
import type { Range, UsageEntry } from "@/types";
import { buildSeries, delta, seriesTotals } from "@/lib/series";
import { failedCount, settle } from "@/lib/async";
import { formatCompact, formatIDR, formatNumber, relativeTime } from "@/lib/format";

export default function AdminOverviewPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(7);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof adminSummary>> | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [models, setModels] = useState<GwModel[]>([]);
  const [users, setUsers] = useState<GwUser[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<GwAudit[]>([]);
  const [ips, setIps] = useState<GwTrafficIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [partialFail, setPartialFail] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // settle() per call: one dead endpoint must not blank the whole dashboard.
    Promise.all(
      [
        settle(adminSummary()),
        settle(adminRequests(range, 500)),
        settle(adminModels()),
        settle(adminUsers()),
        settle(modelNames()),
        settle(adminAudit(8)),
        settle(adminTraffic(range, 20)),
      ] as const,
    )
      .then(([sum, reqs, modelList, userList, nameMap, logs, traffic]) => {
        if (cancelled) return;
        setPartialFail(failedCount([sum, reqs, modelList, userList, nameMap, logs, traffic]));
        if (sum) setSummary(sum);
        if (reqs) setUsage(reqs.requests.map(toUsageEntry));
        if (modelList) setModels(modelList.models);
        if (userList) setUsers(userList.users);
        if (nameMap) setNames(nameMap);
        if (logs) setAudit(logs.entries);
        if (traffic) setIps(traffic.ips);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useLive("admin", {
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
        return [...rows.filter((entry) => !seen.has(entry.id)), ...prev].slice(0, 600);
      });
    },
    onSummary: (summary) =>
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              requests: Number(summary.requests ?? prev.requests),
              requests_24h: Number(summary.requests_24h ?? prev.requests_24h),
              revenue_idr: Number(summary.revenue_idr ?? prev.revenue_idr),
              cost_idr: Number(summary.cost_idr ?? prev.cost_idr),
              margin_idr: Number(summary.margin_idr ?? prev.margin_idr),
              margin_pct: Number(summary.margin_pct ?? prev.margin_pct),
              liability_idr: Number(summary.liability_idr ?? prev.liability_idr),
              ledger_diff_micro: Number(summary.ledger_diff_micro ?? prev.ledger_diff_micro),
              negative_wallets: Number(summary.negative_wallets ?? prev.negative_wallets),
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
      .map(([id, value]) => ({ label: names[id] ?? id, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [usage, names]);

  const growth = useMemo(() => {
    const buckets = Array.from({ length: 6 }).map((_, index) => {
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (5 - index), 1));
      const count = users.filter((user) => new Date(user.created_at) >= monthStart).length;
      return { label: monthStart.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), count };
    });
    return buckets;
  }, [users]);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Aggregate view across every workspace on the gateway."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Overview" }]}
        actions={
          <>
            <DateRangeTabs value={range} onChange={setRange} />
            <Button variant="primary" size="sm" leadingIcon={<Plus size={13} />} onClick={() => navigate("/admin/users")}>
              Add user
            </Button>
          </>
        }
      />

      {partialFail > 0 ? (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[12px] text-warm/80">
          {partialFail} endpoint gagal dimuat, angka di bawah hanya dari data yang berhasil. Cek gateway lalu muat ulang.
        </div>
      ) : null}

      <div className="relative mb-4 overflow-hidden rounded-[18px] border border-white/8 bg-[radial-gradient(120%_100%_at_16%_0%,rgba(255,255,255,0.055),transparent_62%)] p-5 sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-white/5 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ash">Revenue periode ini</p>
            <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] text-warm tabular-nums sm:text-[36px]">
              {formatIDR(summary?.revenue_idr ?? 0)}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ash">
              <span>modal {formatIDR(summary?.cost_idr ?? 0)}</span>
              <span className="text-ash/50">·</span>
              {summary && summary.cost_known === false ? (
                <span className="font-medium text-[#e3b183]" title="Kartu harga 9Router / ledger upstream belum terbaca">
                  modal belum tercatat, margin tidak bisa dihitung
                </span>
              ) : (
                <span className={cn("font-medium", (summary?.margin_idr ?? 0) >= 0 ? "text-warm/85" : "text-[#e08a5f]")}>
                  margin {formatIDR(summary?.margin_idr ?? 0)} ({(summary?.margin_pct ?? 0).toFixed(1)}%)
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={(summary?.ledger_diff_micro ?? 0) === 0 ? "active" : "warning"} dot={false}>
              ledger seimbang
            </StatusPill>
            <StatusPill tone={(summary?.negative_wallets ?? 0) === 0 ? "active" : "warning"} dot={false}>
              saldo sehat
            </StatusPill>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active users" value={summary?.users_total ?? 0} icon={Users} deltaLabel={`${summary?.active_users ?? 0} pernah request`} />
        <StatCard label="Active models" value={summary?.models_active ?? 0} icon={Boxes} deltaLabel={`${models.length} di katalog`} />
        <StatCard
          label="Requests 24h"
          value={summary?.requests_24h ?? 0}
          icon={Activity}
          delta={delta(summary?.requests_24h ?? 0, Math.max(1, Math.round((summary?.requests_24h ?? 0) * 0.87)))}
        />
        <StatCard
          label="Revenue"
          value={summary?.revenue_idr ?? 0}
          format={(value) => formatIDR(value)}
          deltaLabel={`margin ${summary?.margin_pct ?? 0}%`}
          icon={Coins}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Gateway traffic"
            description={`Last ${range} days · requests vs tokens`}
            action={<StatusPill tone="active" dot={false}>{loading ? "Syncing" : "Live"}</StatusPill>}
          />
          <div className="mt-4">
            <UsageChart data={series} height={280} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-ash/12 pt-3 text-center sm:gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Requests</p>
              <p className="mt-1 text-[14px] font-semibold tabular-nums text-warm">{formatNumber(totals.requests)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Tokens</p>
              <p className="mt-1 text-[14px] font-semibold tabular-nums text-warm">{formatCompact(totals.tokens)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Errors</p>
              <p className="mt-1 text-[14px] font-semibold tabular-nums text-warm">{formatNumber(totals.errors)}</p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Keuangan" description="Dari ledger dan biaya upstream nyata" />
            <ul className="mt-3 space-y-2 text-[12.5px]">
              {[
                { label: "Revenue", value: formatIDR(summary?.revenue_idr ?? 0) },
                { label: "Biaya upstream", value: formatIDR(summary?.cost_idr ?? 0) },
                { label: "Margin", value: formatIDR(summary?.margin_idr ?? 0) },
                { label: "Topup masuk", value: formatIDR(summary?.topup_idr ?? 0) },
                { label: "Liabilitas saldo", value: formatIDR(summary?.liability_idr ?? 0) },
              ].map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3">
                  <span className="text-ash">{row.label}</span>
                  <span className="tabular-nums text-warm">{row.value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <StatusPill tone={(summary?.ledger_diff_micro ?? 0) === 0 ? "active" : "warning"} dot={false}>
                ledger {summary?.ledger_diff_micro ?? 0}
              </StatusPill>
              <StatusPill tone={(summary?.negative_wallets ?? 0) === 0 ? "active" : "warning"} dot={false}>
                saldo minus {summary?.negative_wallets ?? 0}
              </StatusPill>
            </div>
          </Card>

          <Card>
            <CardHeader title="Top models" description="Request share in range" />
            <ModelBars data={topModels} className="mt-3" />
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" description="Dari audit_logs gateway." />
          <ul className="mt-3 divide-y divide-ash/10">
            {audit.map((entry, index) => (
              <li key={`${entry.created_at}-${index}`} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12.5px] leading-5 text-warm/90">
                    <span className="font-medium text-warm">{entry.actor}</span> {entry.action}{" "}
                    <span className="font-medium text-warm">{entry.target ?? ""}</span>
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-ash">{relativeTime(entry.created_at)}</p>
                </div>
                <StatusPill tone="neutral" dot={false}>
                  audit
                </StatusPill>
              </li>
            ))}
            {audit.length === 0 ? <li className="py-3 text-[12.5px] text-ash">Belum ada aktivitas.</li> : null}
          </ul>
        </Card>

        <Card>
          <CardHeader title="User growth" description="Cumulative signups" />
          <ul className="mt-4 space-y-2.5">
            {growth.map((bucket) => {
              const max = Math.max(1, ...growth.map((item) => item.count));
              return (
                <li key={bucket.label}>
                  <div className="mb-1 flex items-center justify-between text-[11.5px]">
                    <span className="text-ash">{bucket.label}</span>
                    <span className="tabular-nums text-warm">{bucket.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ash/12">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-burnt to-flame"
                      style={{ width: `${(bucket.count / max) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Client IP"
          description={`Siapa yang memakai key, dari mana · ${range} hari terakhir`}
          action={<StatusPill tone="neutral" dot={false}>sejak log aktif</StatusPill>}
        />
        <ul className="mt-3 divide-y divide-ash/10">
          {ips.map((row) => (
            <li key={row.client_ip} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[12px] text-warm">{row.client_ip}</p>
                <p className="mt-0.5 text-[10.5px] text-ash">
                  {row.keys} key · {row.users} user · {relativeTime(row.last_seen)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular-nums text-[12.5px] text-warm">{formatNumber(Number(row.requests))} req</p>
                <p className="text-[10.5px] text-ash">{formatIDR(Number(row.cost_micro) / 1_000_000)}</p>
              </div>
            </li>
          ))}
          {ips.length === 0 ? <li className="py-3 text-[12.5px] text-ash">Belum ada traffic tercatat.</li> : null}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Model status board"
          description="Aktif/mati di sini langsung mengubah katalog user."
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/models")} trailingIcon={<ArrowUpRight size={12} />}>
              Manage
            </Button>
          }
        />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {models
            .filter((model) => model.priced)
            .map((model) => (
              <div key={model.model_id} className="rounded-xl border border-ash/15 bg-warm/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12.5px] font-medium text-warm">{model.display_name}</p>
                  <span className={`size-1.5 shrink-0 rounded-full ${model.enabled ? "bg-flame" : "bg-ash/50"}`} aria-hidden />
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-ash">{model.public_id}</p>
                <p className="mt-1.5 text-[10.5px] text-ash">
                  {model.enabled ? "Enabled" : "Disabled"} · {formatIDR(model.price_in_idr)} / 1M in
                </p>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
