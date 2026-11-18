import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { UsageChart } from "@/components/charts/UsageChart";
import { ModelBars } from "@/components/charts/ModelBars";
import { Button } from "@/components/common/Button";
import { StatusPill } from "@/components/common/StatusPill";
import { cn } from "@/lib/cn";
import {
  adminAudit,
  adminModels,
  adminSummary,
  adminTraffic,
  adminUsage,
  adminUsers,
  type GwAdminUser as GwUser,
  type GwAudit,
  type GwModel,
  type GwTrafficIp,
  type GwUsage,
} from "@/lib/gw";
import { modelNames } from "@/lib/gateway-data";
import { useLive } from "@/lib/live";
import type { Range } from "@/types";
import { delta, previousTotals, seriesFromUsage, seriesTotals } from "@/lib/series";
import { failedCount, settle } from "@/lib/async";
import { formatCompact, formatIDR, formatNumber, relativeTime } from "@/lib/format";

type Summary = Awaited<ReturnType<typeof adminSummary>>;

function Change({ value, invert }: { value: number; invert?: boolean }) {
  if (!Number.isFinite(value)) return <span className="text-[12px] text-dim">belum ada pembanding</span>;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span className={cn("num text-[12px] font-medium", good ? "text-ok" : "text-bad")}>
      {value >= 0 ? "+" : "−"}
      {Math.abs(value).toFixed(1)}% <span className="font-normal text-ash">vs periode lalu</span>
    </span>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
      <dt className="text-ash">{label}</dt>
      <dd className={cn("num text-warm", tone === "bad" && "text-bad")}>{value}</dd>
    </div>
  );
}

export default function AdminOverviewPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(7);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [aggregate, setAggregate] = useState<GwUsage | null>(null);
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
    Promise.all(
      [
        settle(adminSummary()),
        settle(adminUsage(range * 2)),
        settle(adminModels()),
        settle(adminUsers()),
        settle(modelNames()),
        settle(adminAudit(8)),
        settle(adminTraffic(range, 8)),
      ] as const,
    )
      .then(([sum, agg, modelList, userList, nameMap, logs, traffic]) => {
        if (cancelled) return;
        setPartialFail(failedCount([sum, agg, modelList, userList, nameMap, logs, traffic]));
        if (sum) setSummary(sum);
        if (agg) setAggregate(agg);
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
    onSummary: (live) =>
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              requests: Number(live.requests ?? prev.requests),
              requests_24h: Number(live.requests_24h ?? prev.requests_24h),
              revenue_idr: Number(live.revenue_idr ?? prev.revenue_idr),
              cost_idr: Number(live.cost_idr ?? prev.cost_idr),
              margin_idr: Number(live.margin_idr ?? prev.margin_idr),
              margin_pct: Number(live.margin_pct ?? prev.margin_pct),
              liability_idr: Number(live.liability_idr ?? prev.liability_idr),
              ledger_diff_micro: Number(live.ledger_diff_micro ?? prev.ledger_diff_micro),
              negative_wallets: Number(live.negative_wallets ?? prev.negative_wallets),
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
      .map(([id, value]) => ({ label: names[id] ?? id, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [aggregate, series, names]);

  const signups = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }).map((_, index) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (4 - index), 1));
      const count = users.filter((user) => {
        const created = new Date(user.created_at);
        return created >= start && created < end;
      }).length;
      return { label: start.toLocaleDateString("id-ID", { month: "short", timeZone: "UTC" }), count };
    });
  }, [users]);

  const ledgerOk = (summary?.ledger_diff_micro ?? 0) === 0;
  const walletsOk = (summary?.negative_wallets ?? 0) === 0;
  const costKnown = summary?.cost_known !== false;
  const pricedModels = models.filter((model) => model.priced);

  return (
    <div>
      <PageHeader
        title="Ringkasan"
        description="Seluruh gateway: keuangan, traffic, dan kesehatan katalog."
        actions={
          <>
            <DateRangeTabs value={range} onChange={setRange} />
            <Button variant="primary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => navigate("/admin/users")}>
              Tambah pengguna
            </Button>
          </>
        }
      />

      {partialFail > 0 ? (
        <div role="status" className="mb-4 rounded-lg border border-flame/25 bg-flame/[0.07] px-4 py-2.5 text-[13px] text-warm/90">
          {partialFail} data gagal dimuat, jadi angka di bawah belum lengkap. Cek gateway lalu muat ulang.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <p className="text-[13px] text-ash">Revenue sejak awal</p>
          <p className="num mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-warm sm:text-[38px]">
            {summary ? formatIDR(summary.revenue_idr) : loading ? "…" : "n/a"}
          </p>
          <p className="mt-3 text-[13px] leading-5 text-ash">
            {summary ? `${formatIDR(summary.revenue_today_idr)} hari ini` : "Memuat revenue hari ini"}
            {" · "}
            {!summary ? "n/a" : costKnown ? (
              <span className={cn(summary.margin_idr >= 0 ? "text-warm/85" : "text-bad")}>
                margin {formatIDR(summary.margin_idr)}
                {summary.margin_pct !== null ? ` (${summary.margin_pct.toFixed(1)}%)` : ""}
              </span>
            ) : (
              <span className="text-flame" title="Harga upstream belum tercatat untuk request ini">
                modal belum tercatat, margin belum bisa dihitung
              </span>
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill tone={ledgerOk ? "success" : "warning"}>{ledgerOk ? "Ledger seimbang" : "Ledger selisih"}</StatusPill>
            <StatusPill tone={walletsOk ? "success" : "warning"}>
              {walletsOk ? "Tidak ada saldo minus" : `${summary?.negative_wallets} saldo minus`}
            </StatusPill>
          </div>
        </Card>

        <Card padded={false}>
          <dl className="grid grid-cols-1 divide-y divide-white/8 sm:h-full sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="flex flex-col justify-center p-4 sm:p-5">
              <dt className="text-[13px] text-ash">Request 24 jam</dt>
              <dd className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm">
                {summary ? formatNumber(summary.requests_24h) : "n/a"}
              </dd>
              <p className="mt-2.5 text-[12px] text-ash">{summary ? `${formatNumber(summary.failed_requests)} gagal sejak awal` : ""}</p>
            </div>
            <div className="flex flex-col justify-center p-4 sm:p-5">
              <dt className="text-[13px] text-ash">Pengguna</dt>
              <dd className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm">
                {summary ? formatNumber(summary.users_total) : "n/a"}
              </dd>
              <p className="mt-2.5 text-[12px] text-ash">{summary ? `${formatNumber(summary.active_users)} pernah request` : ""}</p>
            </div>
            <div className="flex flex-col justify-center p-4 sm:p-5">
              <dt className="text-[13px] text-ash">Model aktif</dt>
              <dd className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm">
                {summary ? formatNumber(summary.models_active) : "n/a"}
              </dd>
              <p className="mt-2.5 text-[12px] text-ash">{models.length ? `${models.length} di katalog` : ""}</p>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Traffic gateway"
            description={
              <span className="flex flex-wrap items-center gap-x-2">
                <span>{range} hari terakhir:</span>
                <span className="num text-warm/90">{formatNumber(totals.requests)} request</span>
                <Change value={delta(totals.requests, previous.requests)} />
              </span>
            }
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader title="Keuangan" description="Dari ledger dan biaya upstream" />
          <dl className="mt-2 divide-y divide-white/[0.06]">
            <Row label="Biaya upstream" value={summary ? formatIDR(summary.cost_idr) : "n/a"} />
            <Row label="Margin" value={summary && costKnown ? formatIDR(summary.margin_idr) : "n/a"} />
            <Row label={`Top-up masuk (${summary ? formatNumber(summary.topup_count) : "n/a"}x)`} value={summary ? formatIDR(summary.topup_idr) : "n/a"} />
            <Row label="Kewajiban saldo pelanggan" value={summary ? formatIDR(summary.liability_idr) : "n/a"} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Aktivitas terbaru" description="Dari audit log gateway" />
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {audit.map((entry, index) => (
              <li key={`${entry.created_at}-${index}`} className="flex items-baseline justify-between gap-3 py-2.5">
                <p className="min-w-0 text-[13px] leading-5 text-warm/90">
                  <span className="font-medium text-warm">{entry.actor}</span> {entry.action}
                  {entry.target ? <span className="font-medium text-warm"> {entry.target}</span> : null}
                </p>
                <span className="shrink-0 text-[12px] text-ash">{relativeTime(entry.created_at)}</span>
              </li>
            ))}
            {audit.length === 0 ? <li className="py-3 text-[13px] text-ash">Belum ada aktivitas.</li> : null}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Asal traffic" description={`Client IP teratas, ${range} hari terakhir`} />
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {ips.map((row) => (
              <li key={row.client_ip} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px] text-warm">{row.client_ip}</p>
                  <p className="mt-0.5 text-[12px] text-ash">
                    {row.keys} key · {row.users} pengguna · {relativeTime(row.last_seen)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-[13px] text-warm">{formatCompact(Number(row.requests))} request</p>
                  <p className="num text-[12px] text-ash">{formatIDR(Number(row.cost_micro) / 1_000_000)}</p>
                </div>
              </li>
            ))}
            {ips.length === 0 ? <li className="py-3 text-[13px] text-ash">Belum ada traffic tercatat.</li> : null}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Pendaftar baru" description="Per bulan, 6 bulan terakhir" />
          {signups.every((bucket) => bucket.count === 0) ? (
            <p className="mt-3 text-[13px] text-ash">Belum ada pendaftar di periode ini.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {signups.map((bucket) => {
                const max = Math.max(1, ...signups.map((item) => item.count));
                return (
                  <li key={bucket.label}>
                    <div className="mb-1 flex items-center justify-between text-[13px]">
                      <span className="text-ash">{bucket.label}</span>
                      <span className="num text-warm">{bucket.count}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-flame/80" style={{ width: `${(bucket.count / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Status model"
          description="Mengaktifkan atau mematikan model langsung mengubah katalog pelanggan."
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/models")} trailingIcon={<ArrowUpRight size={13} />}>
              Kelola
            </Button>
          }
        />
        {pricedModels.length === 0 ? (
          <p className="mt-3 text-[13px] text-ash">{loading ? "Memuat katalog…" : "Belum ada model yang sudah diberi harga."}</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {pricedModels.map((model) => (
              <li key={model.model_id} className="rounded-lg border border-white/8 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-medium text-warm">{model.display_name}</p>
                  <span
                    className={cn("size-2 shrink-0 rounded-full", model.enabled ? "bg-ok" : "bg-white/25")}
                    role="img"
                    aria-label={model.enabled ? "Aktif" : "Nonaktif"}
                  />
                </div>
                <p className="mt-0.5 truncate font-mono text-[12px] text-ash">{model.public_id}</p>
                <p className="num mt-1.5 text-[12px] text-ash">
                  {model.enabled ? "Aktif" : "Nonaktif"} · {formatIDR(model.price_in_idr)} / 1M input
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
