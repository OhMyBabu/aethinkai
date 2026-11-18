import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Globe, KeyRound, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { SearchInput } from "@/components/common/SearchInput";
import { adminMonitor, type GwMonitorKey, type GwMonitorUser } from "@/lib/gw";
import { useLive } from "@/lib/live";
import { formatCompact, formatDateTime, formatIDR, formatNumber, relativeTime } from "@/lib/format";
import type { Range } from "@/types";

const idr = (micro: number) => formatIDR(Number(micro ?? 0) / 1_000_000);

export default function AdminMonitorPage() {
  const [range, setRange] = useState<Range>(7);
  const [users, setUsers] = useState<GwMonitorUser[]>([]);
  const [keys, setKeys] = useState<GwMonitorKey[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const lastRefresh = useRef(0);

  useLive("admin", {
    onStatus: setLive,
    onRows: () => {
      if (Date.now() - lastRefresh.current < 4000) return;
      lastRefresh.current = Date.now();
      setTick((value) => value + 1);
    },
    onSummary: () => {
      if (Date.now() - lastRefresh.current < 4000) return;
      lastRefresh.current = Date.now();
      setTick((value) => value + 1);
    },
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminMonitor(range)
      .then((data) => {
        if (cancelled) return;
        setUsers(data.users);
        setKeys(data.keys);
        setSelected((prev) => prev ?? data.keys.find((k) => k.requests > 0)?.id ?? data.keys[0]?.id ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, tick]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = keys.filter((key) =>
      q ? `${key.email} ${key.name} ${key.prefix}`.toLowerCase().includes(q) : true,
    );
    const map = new Map<string, { user: GwMonitorUser | null; keys: GwMonitorKey[] }>();
    filtered.forEach((key) => {
      const entry = map.get(key.user_id) ?? {
        user: users.find((u) => u.user_id === key.user_id) ?? null,
        keys: [],
      };
      entry.keys.push(key);
      map.set(key.user_id, entry);
    });
    return Array.from(map.entries()).sort(
      (a, b) => (b[1].user?.requests ?? 0) - (a[1].user?.requests ?? 0),
    );
  }, [keys, users, query]);

  const active = keys.find((key) => key.id === selected) ?? null;

  const totals = useMemo(
    () => ({
      keys: keys.length,
      activeKeys: keys.filter((key) => key.status === "active").length,
      ips: new Set(keys.flatMap((key) => key.ips.map((ip) => ip.ip))).size,
      requests: keys.reduce((sum, key) => sum + Number(key.requests), 0),
      tin: keys.reduce((sum, key) => sum + Number(key.tokens_in), 0),
      tout: keys.reduce((sum, key) => sum + Number(key.tokens_out), 0),
      cost: keys.reduce((sum, key) => sum + Number(key.cost_micro), 0),
    }),
    [keys],
  );

  const maxDay = Math.max(1, ...(active?.daily ?? []).map((d) => Math.max(d.tokens_in, d.tokens_out)));

  return (
    <div>
      <PageHeader
        title="Key monitor"
        description="Satu tempat: user → API key → provider/model → IP pemakai → request in/out."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Key monitor" }]}
        actions={
          <>
            <StatusPill tone={live === "live" ? "active" : live === "offline" ? "warning" : "neutral"} dot={live !== "offline"}>
              {live === "live" ? "Live" : live === "offline" ? "Reconnecting" : "Connecting"}
            </StatusPill>
            <DateRangeTabs value={range} onChange={setRange} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Key", value: `${totals.activeKeys}/${totals.keys}`, hint: "aktif / total", icon: KeyRound },
          { label: "IP unik", value: formatNumber(totals.ips), hint: "pemakai key", icon: Globe },
          { label: "Request", value: formatNumber(totals.requests), hint: `${range} hari`, icon: Activity },
          {
            label: "In / out token",
            value: `${formatCompact(totals.tin)} / ${formatCompact(totals.tout)}`,
            hint: idr(totals.cost),
            icon: ArrowUpRight,
          },
        ].map((item) => (
          <div key={item.label} className="surface p-4">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-ash">{item.label}</p>
              <item.icon size={13} className="text-ash" aria-hidden />
            </div>
            <p className="mt-2 truncate text-[19px] font-semibold tabular-nums text-warm">{item.value}</p>
            <p className="mt-0.5 text-[12px] text-ash">{item.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="p-0">
          <div className="border-b border-ash/12 px-4 py-3">
            <div className="flex items-center gap-2">
              <Users size={13} className="text-ash" aria-hidden />
              <p className="text-[12.5px] font-medium text-warm">User & key</p>
              <span className="ml-auto text-[12px] text-ash">{grouped.length} user</span>
            </div>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Cari email / nama key…"
              className="mt-2 w-full"
            />
          </div>

          <div className="max-h-[620px] overflow-y-auto">
            {grouped.map(([userId, entry]) => (
              <div key={userId} className="border-b border-ash/10 last:border-0">
                <div className="flex items-start justify-between gap-2 px-4 pt-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-warm">{entry.user?.email ?? userId}</p>
                    <p className="mt-0.5 text-[12px] text-ash">
                      {entry.user?.keys_active ?? 0}/{entry.user?.keys_total ?? entry.keys.length} key aktif ·{" "}
                      {entry.user?.ip_count ?? 0} IP · {formatNumber(entry.user?.requests ?? 0)} req
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-ash">{idr(entry.user?.cost_micro ?? 0)}</span>
                </div>

                <ul className="px-2 pb-2">
                  {entry.keys.map((key) => {
                    const isActive = key.id === selected;
                    return (
                      <li key={key.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(key.id)}
                          aria-pressed={isActive}
                          className={`mt-1 w-full rounded-lg px-2.5 py-2 text-left transition ${
                            isActive ? "bg-flame/[0.10] ring-1 ring-flame/35" : "hover:bg-warm/[0.03]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-medium text-warm">{key.name}</span>
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${
                                key.status === "active" ? "bg-flame" : "bg-ash/50"
                              }`}
                              aria-hidden
                            />
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[12px] text-ash">
                            {key.prefix}… · {key.ip_count} IP · {formatNumber(Number(key.requests))} req
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-ash">
                            {key.models.length
                              ? key.models.map((model) => `${model.display_name} ×${model.requests}`).join(" · ")
                              : "belum ada traffic"}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {grouped.length === 0 ? (
              <div className="px-4 py-8">
                <EmptyState
                  icon={loading ? Search : KeyRound}
                  title={loading ? "Memuat dari gateway…" : "Belum ada key"}
                  description={loading ? "Sebentar." : "Belum ada API key dibuat."}
                />
              </div>
            ) : null}
          </div>
        </Card>

        {active ? (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-warm">{active.name}</h3>
                    <StatusPill tone={active.status === "active" ? "active" : "suspended"}>{active.status}</StatusPill>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-ash">
                    {active.email} · <span className="font-mono">{active.prefix}…</span>
                  </p>
                  <p className="mt-1 text-[12px] text-ash">
                    dibuat {formatDateTime(active.created_at)} · terakhir dipakai{" "}
                    {active.last_request ? relativeTime(active.last_request) : "belum pernah"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-right sm:grid-cols-4">
                  {[
                    ["Requests", formatNumber(Number(active.requests))],
                    ["In", formatCompact(Number(active.tokens_in))],
                    ["Out", formatCompact(Number(active.tokens_out))],
                    ["Biaya", idr(active.cost_micro)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[12px] text-ash">{label}</p>
                      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-warm">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-0">
                <div className="border-b border-ash/12 px-4 py-3">
                  <p className="text-[12.5px] font-medium text-warm">Provider & model</p>
                  <p className="mt-0.5 text-[12px] text-ash">Dipakai lewat key ini</p>
                </div>
                <ul className="divide-y divide-ash/10">
                  {active.models.map((model) => (
                    <li key={model.model_id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] text-warm">{model.display_name}</p>
                          <p className="mt-0.5 truncate text-[12px] text-ash">
                            {model.provider} · <span className="font-mono">{model.public_id}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[12px] tabular-nums text-warm">{formatNumber(Number(model.requests))} req</p>
                          <p className="text-[12px] text-ash">
                            {formatCompact(Number(model.tokens_in))} in / {formatCompact(Number(model.tokens_out))} out
                          </p>
                        </div>
                      </div>
                      <p className="mt-1 text-[12px] tabular-nums text-ash">{idr(model.cost_micro)}</p>
                    </li>
                  ))}
                  {active.models.length === 0 ? (
                    <li className="px-4 py-4 text-[12px] text-ash">Belum ada pemakaian model.</li>
                  ) : null}
                </ul>
              </Card>

              <Card className="p-0">
                <div className="border-b border-ash/12 px-4 py-3">
                  <p className="text-[12.5px] font-medium text-warm">IP pemakai</p>
                  <p className="mt-0.5 text-[12px] text-ash">{active.ip_count} IP unik</p>
                </div>
                <ul className="divide-y divide-ash/10">
                  {active.ips.map((ip) => (
                    <li key={`${ip.ip}-${ip.user_agent}`} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-mono text-[12px] text-warm">
                          {ip.ip === "unknown" ? "IP belum tercatat" : ip.ip}
                        </p>
                        <p className="shrink-0 text-[12px] tabular-nums text-warm">
                          {formatNumber(Number(ip.requests))} req
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-ash">{ip.user_agent}</p>
                      <p className="mt-0.5 text-[12px] text-ash">
                        {relativeTime(ip.last_seen)} · {idr(ip.cost_micro)}
                      </p>
                    </li>
                  ))}
                  {active.ips.length === 0 ? (
                    <li className="px-4 py-4 text-[12px] text-ash">Belum ada IP tercatat.</li>
                  ) : null}
                </ul>
              </Card>
            </div>

            <Card>
              <CardHeader title="Request in / out" description={`Harian · ${range} hari terakhir`} />
              <ul className="mt-3 space-y-2.5">
                {active.daily.map((day) => (
                  <li key={day.day}>
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="text-ash">{day.day}</span>
                      <span className="tabular-nums text-ash">
                        {formatNumber(Number(day.requests))} req ·{" "}
                        <span className="text-warm">{formatCompact(Number(day.tokens_in))}</span> in ·{" "}
                        <span className="text-flame">{formatCompact(Number(day.tokens_out))}</span> out
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-ash/10">
                        <div
                          className="h-full rounded-full bg-warm/55"
                          style={{ width: `${Math.max(2, (Number(day.tokens_in) / maxDay) * 100)}%` }}
                        />
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-ash/10">
                        <div
                          className="h-full rounded-full bg-flame/80"
                          style={{ width: `${Math.max(2, (Number(day.tokens_out) / maxDay) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
                {active.daily.length === 0 ? (
                  <li className="text-[12px] text-ash">Belum ada traffic pada rentang ini.</li>
                ) : null}
              </ul>
              <div className="mt-3 flex items-center gap-4 border-t border-ash/12 pt-3 text-[12px] text-ash">
                <span className="flex items-center gap-1.5">
                  <ArrowDownLeft size={11} aria-hidden /> token in
                </span>
                <span className="flex items-center gap-1.5">
                  <ArrowUpRight size={11} className="text-flame" aria-hidden /> token out
                </span>
              </div>
            </Card>
          </div>
        ) : (
          <Card className="flex items-center justify-center p-10">
            <EmptyState
              icon={KeyRound}
              title={loading ? "Memuat…" : "Pilih satu key"}
              description={
                loading ? "Menarik data dari gateway." : "Klik key di kiri untuk lihat provider, model, dan IP pemakainya."
              }
            />
          </Card>
        )}
      </div>
    </div>
  );
}
