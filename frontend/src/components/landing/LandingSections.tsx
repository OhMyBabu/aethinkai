import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Blocks,
  GitBranch,
  Gauge,
  ShieldCheck,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/common/Card";
import { fetchShop, type Pkg, type TopupPolicy } from "@/lib/portal";
import { Button } from "@/components/common/Button";
import { StatusPill } from "@/components/common/StatusPill";
import type { AIModel } from "@/types";
import { cn } from "@/lib/cn";
import { ModelMark } from "@/components/brand/ModelMark";
import { formatCompact, formatIDR } from "@/lib/format";
import type { LandingStatus } from "@/lib/landing-data";

export function FeatureStrip() {
  const features = [
    { icon: Blocks, title: "Multi-Model Access", text: "One credential across DeepSeek, GLM, Kimi and Claude." },
    { icon: GitBranch, title: "Intelligent Routing", text: "Per-request route selection with automatic fallbacks." },
    { icon: ShieldCheck, title: "Enterprise Ready", text: "Key scoping, audit trails and predictable spend limits." },
  ];
  return (
    <ul className="grid min-w-0 gap-3 sm:grid-cols-3">
      {features.map((feature) => (
        <li key={feature.title} data-reveal className="surface p-4">
          <feature.icon size={16} className="text-flame" aria-hidden />
          <p className="mt-2.5 text-[13px] font-semibold text-warm max-[899px]:text-[15px]">{feature.title}</p>
          <p className="mt-1 text-[11.5px] leading-5 text-ash max-[899px]:text-[13px] max-[899px]:leading-6">{feature.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function KpiStrip({ models, status }: { models: AIModel[]; status: LandingStatus | null }) {
  const p95 = status?.p95_latency_ms ?? 0;
  const items = [
    { label: "Models live", value: String(models.length || status?.models_active || "—"), icon: Layers },
    { label: "Success 24h", value: status ? `${status.success_rate}%` : "—", icon: Gauge },
    { label: "p95 latency", value: p95 ? `${p95} ms` : "—", icon: TrendingUp },
  ];
  return (
    <div className="grid min-w-0 grid-cols-3 gap-2.5 sm:gap-3">
      {items.map((item) => (
        <div key={item.label} data-reveal className="min-w-0 rounded-xl border border-ash/18 bg-warm/[0.025] px-3 py-3 max-[899px]:px-2.5">
          <item.icon size={13} className="text-ash" aria-hidden />
          <p className="mt-2 text-[17px] font-semibold leading-none tabular-nums text-warm max-[899px]:text-[18px] sm:text-[19px]">
            {item.value}
          </p>
          <p className="mt-1 text-[10.5px] uppercase leading-4 tracking-[0.08em] text-ash sm:text-[10px] sm:tracking-[0.1em]">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

export function PopularModels({ models }: { models: AIModel[] }) {
  // Ranked by real traffic, not by marketing: the gateway counts requests per public
  // model id and this endpoint returns the top four of the last 3 days.
  const [rank, setRank] = useState<{ id: string; requests: number }[]>([]);
  const [windowDays, setWindowDays] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/popular-models?limit=4", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setRank(data.models ?? []);
        setWindowDays(data.window_days ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const ordered = rank.length
    ? rank
        .map((entry) => models.find((model) => model.id === entry.id))
        .filter((model): model is AIModel => Boolean(model))
    : models.slice(0, 4);
  const counts = new Map(rank.map((entry) => [entry.id, entry.requests]));

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.16em] text-ash">Popular models</h3>
        <a href="#catalog" className="flex items-center gap-1 text-[11.5px] text-flame active:opacity-70">
          Top 4{windowDays ? ` · last ${windowDays}d` : ""} <ArrowRight size={11} aria-hidden />
        </a>
      </div>
      <ul className="grid min-w-0 gap-2.5 sm:grid-cols-2">
        {ordered.map((model) => (
          <li
            key={model.id}
            data-reveal
            className="group flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl border border-ash/18 bg-[#1a1b1e]/70 px-3 py-2.5 transition hover:border-flame/30"
          >
            <div className="flex min-w-0 items-center gap-2">
              <ModelMark modelId={model.modelId} provider={model.provider} size={14} className="text-warm/70" />
              <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-warm max-[899px]:text-[15px] sm:text-[12.5px]">{model.displayName}</p>
              <p className="mt-0.5 truncate font-mono text-[11.5px] text-ash max-[899px]:text-[12.5px] sm:text-[9.5px]">{model.modelId}</p>
              <p className="truncate text-[11.5px] text-dim sm:text-[9.5px]">
                {model.category} · {ctxLabel(model.contextWindow)} ctx · {formatIDR(model.inputRate)} / {formatIDR(model.outputRate)} per 1M
                {counts.get(model.id) ? ` · ${counts.get(model.id)} req` : ""}
              </p>
              </div>
            </div>
            <span className="shrink-0 rounded-md border border-ash/20 px-1.5 py-0.5 text-[11px] uppercase tracking-[0.08em] text-ash group-hover:border-flame/30 sm:text-[9.5px] group-hover:text-flame">
              {model.provider}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ctxLabel(tokens: number): string {
  if (!tokens) return "";
  if (tokens >= 999_500) {
    const m = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${m % 1 === 0 ? m.toFixed(0) : m}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

export function FullModelCatalog({ models }: { models: AIModel[] }) {
  const grouped = Array.from(new Set(models.map((model) => model.provider)));
  // the headline quotes the largest window the catalogue really reports today —
  // it drops automatically when a route with a smaller window replaces it
  const maxContextLabel = ctxLabel(Math.max(0, ...models.map((m) => Number(m.contextWindow) || 0)));
  return (
    <section id="catalog" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em] text-flame sm:text-[11px]">Full catalogue</p>
          <h2 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
            {models.length} model{maxContextLabel ? `, up to ${maxContextLabel} token` : ""}
          </h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-ash max-[899px]:text-[14px] max-[899px]:leading-6">
            Every model the gateway exposes, with context windows and per-million pricing.
          </p>
        </div>
        <Link
          to="/login"
          className="cta-landing-soft inline-flex h-11 items-center gap-1.5 rounded-xl border border-ash/25 px-4 text-[13px] font-medium text-warm transition active:scale-[0.985] active:bg-warm/8 hover:border-flame/40 hover:text-flame"
        >
          Explore the dashboard <ArrowRight size={13} aria-hidden />
        </Link>
      </div>

      <div className="surface overflow-hidden p-0 max-[899px]:hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">Complete model catalogue with context window and pricing</caption>
            <thead>
              <tr className="border-b border-ash/15 bg-warm/[0.02]">
                {["Model", "Model ID", "Category", "Context", "In / 1M", "Out / 1M", "Status"].map((head, i) => (
                  <th
                    key={head}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-ash",
                      i >= 4 && "text-right",
                    )}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((provider) => {
                const rows = models.filter((model) => model.provider === provider);
                if (rows.length === 0) return null;
                return rows.map((model, index) => (
                  <tr key={model.id} className="border-b border-ash/10 last:border-0 transition-colors hover:bg-warm/[0.03]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-ash/20 bg-warm/[0.04] text-warm/85">
                          <ModelMark modelId={model.modelId} provider={model.provider} size={14} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-warm">{model.displayName}</p>
                          {index === 0 ? (
                            <p className="text-[11.5px] uppercase tracking-[0.1em] text-ash sm:text-[10px]">{provider}</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="whitespace-nowrap font-mono text-[12.5px] text-ash sm:text-[11px]">{model.modelId}</code>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[10.5px] text-ash">
                        {model.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] tabular-nums text-warm/85">
                      {ctxLabel(model.contextWindow)}
                    </td>
                    <td className="px-4 py-3 text-right text-[12px] tabular-nums text-warm/85">
                      {formatIDR(model.inputRate)}
                    </td>
                    <td className="px-4 py-3 text-right text-[12px] tabular-nums text-warm/85">
                      {formatIDR(model.outputRate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-flame sm:text-[11px]">
                        <span className="size-1.5 rounded-full bg-flame" aria-hidden />
                        {(model.availability ?? "on") === "maintenance"
                          ? "gangguan"
                          : model.enabled
                            ? "online"
                            : "off"}
                      </span>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phones get cards — a 680px table that needs sideways scrolling is not a
          mobile pattern. Hidden from 900px up so desktop keeps the table. */}
      <ul className="space-y-2.5 min-[900px]:hidden">
        {models.map((model) => (
          <li key={model.id} className="rounded-xl border border-ash/18 bg-[#1a1b1e]/70 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-ash/20 bg-warm/[0.04] text-warm/85">
                  <ModelMark modelId={model.modelId} provider={model.provider} size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-warm">{model.displayName}</p>
                  <p className="mt-0.5 truncate font-mono text-[12px] text-ash">{model.modelId}</p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-[12px] text-flame">
                <span className="size-1.5 rounded-full bg-flame" aria-hidden />
                {(model.availability ?? "on") === "maintenance"
                  ? "gangguan"
                  : model.enabled
                    ? "online"
                    : "off"}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-ash/10 pt-2.5">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-dim">Context</dt>
                <dd className="mt-1 text-[13px] tabular-nums text-warm/85">{ctxLabel(model.contextWindow)}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[11px] uppercase tracking-[0.1em] text-dim">Category</dt>
                <dd className="mt-1 truncate text-[13px] text-warm/85">{model.category}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-dim">In / 1M</dt>
                <dd className="mt-1 text-[13px] tabular-nums text-warm/85">{formatIDR(model.inputRate)}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[11px] uppercase tracking-[0.1em] text-dim">Out / 1M</dt>
                <dd className="mt-1 text-[13px] tabular-nums text-warm/85">{formatIDR(model.outputRate)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 text-[12px] text-dim sm:text-[11px]">
        Pricing · per 1M tokens, input and output.
      </p>
    </section>
  );
}

export function PricingPreview() {
  // The shop is the package table the admin owns — no derived model "plans" and no
  // second price strip. Per-model rates live in the catalogue below.
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [topup, setTopup] = useState<TopupPolicy | null>(null);
  useEffect(() => {
    let alive = true;
    fetchShop()
      .then((shop) => {
        if (!alive) return;
        setPackages(shop.packages);
        setTopup(shop.topup);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section id="pricing" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em] text-flame sm:text-[11px]">Pricing</p>
          <h2 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
            Pay as you go
          </h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-ash">
            Buy credit once, spend it across every model. Rates per model are in the catalogue below.
          </p>
        </div>
        <Button variant="ghost" size="md" className="cta-landing-soft" trailingIcon={<ArrowRight size={14} />} onClick={() => window.location.assign("/login")}>
          Get started
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {packages.map((pkg, index) => {
          const highlighted = packages.length > 2 ? index === 1 : index === 0;
          return (
            <Card
              key={pkg.sku}
              data-reveal
              className={highlighted ? "border-flame/35 bg-flame/[0.05]" : undefined}
            >
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-warm max-[899px]:text-[15px]">{pkg.name}</p>
                {highlighted ? <StatusPill tone="active">Popular</StatusPill> : null}
              </div>
              <p className="mt-3 text-[22px] font-semibold tabular-nums text-warm max-[899px]:text-[24px]">
                {formatIDR(pkg.price_idr)}
              </p>
              <p className="mt-1 text-[12px] text-ash max-[899px]:text-[13px]">
                {formatIDR(pkg.credits_micro / 1_000_000)} credit · {pkg.rpm_limit} req/min
              </p>
              {pkg.blurb ? <p className="mt-1.5 text-[11.5px] leading-5 text-dim">{pkg.blurb}</p> : null}
              <Button
                variant={highlighted ? "primary" : "secondary"}
                size="md"
                full
                className={highlighted ? "cta-landing mt-4" : "cta-landing-soft mt-4"}
                onClick={() => window.location.assign("/login")}
              >
                Buy {pkg.name}
              </Button>
            </Card>
          );
        })}
      </div>
      {packages.length ? (
        <p className="mt-3 text-[11.5px] text-dim">
          Credit never expires; requests are billed per token at the model rate.
          {topup?.enabled ? ` Custom top-up from ${formatIDR(topup.min_idr)}.` : ""}
        </p>
      ) : null}
    </section>
  );
}
