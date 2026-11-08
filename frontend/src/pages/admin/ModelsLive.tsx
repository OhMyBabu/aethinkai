import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, Cpu, Globe, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { DateRangeTabs } from "@/components/common/DateRangeTabs";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { SearchInput } from "@/components/common/SearchInput";
import { StatCard } from "@/components/common/StatCard";
import { ModelMark } from "@/components/brand/ModelMark";
import { adminModelUsage, type GwModelUsage } from "@/lib/gw";
import { useLive } from "@/lib/live";
import { formatCompact, formatIDR, formatNumber, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Range } from "@/types";

const idr = (micro: number) => formatIDR(Number(micro ?? 0) / 1_000_000);

export default function AdminModelLivePage() {
  const [range, setRange] = useState<Range>(7);
  const [models, setModels] = useState<GwModelUsage[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const lastRefresh = useRef(0);

  useLive("admin", {
    onStatus: setLive,
    onRows: () => {
      if (Date.now() - lastRefresh.current < 5000) return;
      lastRefresh.current = Date.now();
      setTick((v) => v + 1);
    },
    onSummary: () => {
      if (Date.now() - lastRefresh.current < 5000) return;
      lastRefresh.current = Date.now();
      setTick((v) => v + 1);
    },
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminModelUsage(range)
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setOpen((prev) => {
          if (Object.keys(prev).length) return prev;
          const first = data.models.find((m) => m.requests > 0) ?? data.models[0];
          return first ? { [first.model_id]: true } : prev;
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, tick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) =>
      `${model.public_id} ${model.display_name} ${model.provider} ${model.users.map((u) => u.email).join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [models, query]);

  const totals = useMemo(
    () =>
      models.reduce(
        (acc, model) => ({
          requests: acc.requests + model.requests,
          tokens: acc.tokens + model.tokens_in + model.tokens_out,
          users: acc.users + model.user_count,
          ips: acc.ips + model.ip_count,
          cost: acc.cost + model.cost_micro,
        }),
        { requests: 0, tokens: 0, users: 0, ips: 0, cost: 0 },
      ),
    [models],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Model monitor"
        description="Model apa yang sedang dipakai, siapa yang pakai, dari IP mana, dan berapa token per request."
        actions={
          <>
            <StatusPill tone={live === "live" ? "active" : live === "offline" ? "warning" : "neutral"} dot={live !== "offline"}>
              {live === "live" ? "Live" : live === "offline" ? "Reconnecting" : "Connecting"}
            </StatusPill>
            <DateRangeTabs value={range} onChange={setRange} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard key={`ml-${models.length}`} label="Model live" value={models.filter((m) => m.requests > 0).length} icon={Cpu} hint={`${models.length} model tersentuh`} />
        <StatCard key={`mr-${totals.requests}`} label="Requests" value={totals.requests} icon={Activity} hint="semua model" />
        <StatCard key={`mt-${totals.tokens}`} label="Token" value={totals.tokens} format={formatCompact} icon={Activity} hint="in + out" />
        <StatCard key={`mu-${totals.users}`} label="User / IP" value={totals.users} icon={Users} hint={`${totals.ips} IP unik · ${idr(totals.cost)}`} />
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="Cari model, user, atau email…" />

      {loading && !models.length ? (
        <Card>
          <div className="h-40 animate-pulse rounded-xl bg-warm/[0.04]" />
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState title="Belum ada trafik" description="Begitu ada request masuk, model dan IP-nya muncul di sini otomatis." />
      ) : (
        <div className="space-y-3">
          {filtered.map((model) => {
            const expanded = !!open[model.model_id];
            return (
              <Card key={model.model_id} padded={false} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen((prev) => ({ ...prev, [model.model_id]: !prev[model.model_id] }))}
                  className="flex w-full cursor-pointer flex-col gap-3 p-4 text-left transition hover:bg-warm/[0.03] sm:flex-row sm:items-center sm:gap-4 sm:p-5"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ash/20 bg-[#141518]">
                      <ModelMark modelId={model.public_id} size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-semibold text-warm">{model.display_name}</span>
                        <StatusPill tone={model.requests > 0 ? "active" : "neutral"} dot={false}>
                          {model.provider}
                        </StatusPill>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-ash/70">{model.public_id}</span>
                    </span>
                  </span>

                  <span className="grid grid-cols-2 gap-x-5 gap-y-1 text-[12px] sm:flex sm:items-center sm:gap-6">
                    <span className="text-ash">
                      <span className="block text-[10px] uppercase tracking-wide text-ash/60">Req</span>
                      <span className="text-warm">{formatNumber(model.requests)}</span>
                    </span>
                    <span className="text-ash">
                      <span className="block text-[10px] uppercase tracking-wide text-ash/60">Token</span>
                      <span className="text-warm">{formatCompact(model.tokens_in + model.tokens_out)}</span>
                    </span>
                    <span className="text-ash">
                      <span className="block text-[10px] uppercase tracking-wide text-ash/60">User</span>
                      <span className="text-warm">{model.user_count}</span>
                    </span>
                    <span className="text-ash">
                      <span className="block text-[10px] uppercase tracking-wide text-ash/60">IP</span>
                      <span className="text-warm">{model.ip_count}</span>
                    </span>
                    <span className="hidden text-ash sm:block">
                      <span className="block text-[10px] uppercase tracking-wide text-ash/60">Biaya</span>
                      <span className="text-warm">{idr(model.cost_micro)}</span>
                    </span>
                  </span>

                  <ChevronDown
                    size={16}
                    className={cn("shrink-0 text-ash transition-transform", expanded && "rotate-180")}
                    aria-hidden
                  />
                </button>

                {expanded ? (
                  <div className="border-t border-ash/12 bg-[#141518]/40 px-4 pb-4 pt-3 sm:px-5">
                    <div className="space-y-3">
                      {model.users.map((user) => (
                        <div key={user.user_id} className="rounded-xl border border-ash/15 bg-[#16171a] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-warm">{user.email}</span>
                            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ash">
                              <span>{formatNumber(user.requests)} req</span>
                              <span>in {formatCompact(user.tokens_in)}</span>
                              <span>out {formatCompact(user.tokens_out)}</span>
                              <span>{idr(user.cost_micro)}</span>
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {user.ips.map((ip) => (
                              <span
                                key={`${ip.ip}-${ip.user_agent}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-ash/20 bg-warm/[0.03] px-2 py-1 text-[11px] text-ash"
                                title={`${ip.user_agent} · terakhir ${relativeTime(ip.last_seen)}`}
                              >
                                <Globe size={11} className="text-flame/70" aria-hidden />
                                <span className="font-mono text-warm/90">{ip.ip === "unknown" ? "IP belum tercatat" : ip.ip}</span>
                                <span className="text-ash/60">· {formatNumber(ip.requests)} req</span>
                                <span className="text-ash/45">· {formatCompact(ip.tokens_in + ip.tokens_out)} tok</span>
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-[11px] text-ash/60">
                            Terakhir: {relativeTime(user.ips[0]?.last_seen ?? model.last_seen)} ·{" "}
                            {user.ips[0]?.user_agent ?? "unknown"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
