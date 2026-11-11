import { useEffect, useState, type MouseEvent } from "react";
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
import type { AIModel } from "@/types";
import { cn } from "@/lib/cn";
import { ModelMark } from "@/components/brand/ModelMark";
import { formatCompact, formatIDR } from "@/lib/format";
import type { LandingStatus } from "@/lib/landing-data";

export function FeatureStrip() {
  const features = [
    { icon: Blocks, title: "One key, four providers", text: "DeepSeek, GLM, Kimi and Claude behind a single credential." },
    { icon: GitBranch, title: "Health-aware routing", text: "Each request goes to a route that is up, with automatic fallback." },
    { icon: ShieldCheck, title: "Per-key limits", text: "RPM caps, spend ledger and audit trail per key." },
  ];
  return (
    <ul className="grid min-w-0 gap-3 sm:grid-cols-3">
      {features.map((feature) => (
        <li
          key={feature.title}
          data-reveal
          className="feature-card surface flex h-full min-w-0 flex-col p-4 transition duration-200 hover:-translate-y-0.5 hover:border-ash/28 hover:bg-warm/[0.035] motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-5"
        >
          <feature.icon size={16} className="text-flame" aria-hidden />
          <p className="mt-3 text-[13px] font-semibold text-warm max-[899px]:text-[15px]">{feature.title}</p>
          <p className="mt-1.5 text-[11.5px] leading-5 text-ash max-[899px]:text-[13px] max-[899px]:leading-6">{feature.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function KpiStrip({ models, status }: { models: AIModel[]; status: LandingStatus | null }) {
  const p95 = status?.p95_latency_ms ?? 0;
  const items = [
    { label: "Models live", value: String(models.length || status?.models_active || "n/a"), icon: Layers },
    { label: "Success 24h", value: status ? `${status.success_rate}%` : "n/a", icon: Gauge },
    { label: "p95 latency", value: p95 ? `${p95} ms` : "n/a", icon: TrendingUp },
  ];
  return (
    <div className="grid min-w-0 grid-cols-3 gap-2.5 sm:gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          data-reveal
          className="flex min-w-0 flex-col justify-between rounded-xl border border-ash/16 bg-warm/[0.025] px-3 py-3 max-[899px]:px-2.5"
        >
          <item.icon size={13} className="text-ash/85" aria-hidden />
          <p className="mt-2 whitespace-nowrap text-[17px] font-semibold leading-none tabular-nums text-warm max-[899px]:text-[18px] sm:text-[19px]">
            {item.value}
          </p>
          <p className="mt-1.5 text-[10.5px] uppercase leading-4 tracking-[0.09em] text-ash/90 sm:text-[10px]">{item.label}</p>
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
        <a href="#catalog" className="inline-flex h-11 items-center gap-1 text-[12px] text-flame active:opacity-70 sm:h-auto sm:text-[11.5px]">
          Top 4{windowDays ? ` · last ${windowDays}d` : ""} <ArrowRight size={11} aria-hidden />
        </a>
      </div>
      <ul className="grid min-w-0 gap-2.5 sm:grid-cols-2">
        {ordered.map((model) => (
          <li
            key={model.id}
            data-reveal
            className="group min-w-0 rounded-xl border border-ash/18 bg-[#1a1b1e]/70 p-3 transition duration-200 hover:-translate-y-0.5 hover:border-flame/30 hover:bg-[#1d1e22] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <ModelMark modelId={model.modelId} provider={model.provider} size={14} className="shrink-0 text-warm/75" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium leading-5 text-warm max-[899px]:text-[15px]">{model.displayName}</p>
                  <p className="truncate font-mono text-[10.5px] leading-4 text-ash" title={model.modelId}>
                    {model.modelId}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-md border border-ash/20 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-ash transition group-hover:border-flame/30 group-hover:text-flame sm:text-[9.5px]">
                {model.provider}
              </span>
            </div>

            <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-ash/12 pt-2">
              <div className="min-w-0">
                <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ash/85 sm:text-[9.5px]">Input / 1M</dt>
                <dd className="mt-0.5 whitespace-nowrap text-[13px] font-medium leading-5 tabular-nums text-warm sm:text-[12.5px]">
                  {formatIDR(model.inputRate)}
                </dd>
              </div>
              <div className="min-w-0 text-right">
                <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ash/85 sm:text-[9.5px]">Output / 1M</dt>
                <dd className="mt-0.5 whitespace-nowrap text-[13px] font-medium leading-5 tabular-nums text-warm sm:text-[12.5px]">
                  {formatIDR(model.outputRate)}
                </dd>
              </div>
            </dl>

            <p className="mt-2 truncate text-[11.5px] text-dim sm:text-[10.5px]">
              {model.category} · {ctxLabel(model.contextWindow)} ctx
              {counts.get(model.id) ? ` · ${counts.get(model.id)} req` : ""}
            </p>
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
  // the headline quotes the largest window the catalogue really reports today -
  // it drops automatically when a route with a smaller window replaces it
  const maxContextLabel = ctxLabel(Math.max(0, ...models.map((m) => Number(m.contextWindow) || 0)));
  return (
    <section id="catalog" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
            {models.length} model{models.length === 1 ? "" : "s"}
            {maxContextLabel ? `, up to ${maxContextLabel} token${maxContextLabel === "1" ? "" : "s"}` : ""}
          </h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-ash max-[899px]:text-[14px] max-[899px]:leading-6">
            Every model the gateway exposes, with context windows and per-million pricing.
          </p>
        </div>
        <Link
          to="/login"
          className="cta-landing-soft inline-flex h-11 items-center gap-1.5 rounded-xl border border-ash/25 px-4 text-[13px] font-medium text-warm transition active:scale-[0.985] active:bg-warm/8 hover:border-flame/40 hover:text-flame"
        >
          Open the dashboard <ArrowRight size={13} aria-hidden />
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
                      "whitespace-nowrap px-4 py-3 text-[10.5px] font-medium uppercase tracking-[0.12em] text-ash/95",
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
                  <tr key={model.id} className="border-b border-ash/15 last:border-0 transition-colors hover:bg-warm/[0.04]">
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
                          ? "maintenance"
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

      {/* Phones get cards, a 680px table that needs sideways scrolling is not a
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
                  ? "maintenance"
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
  // The shop is the package table the admin owns, no derived model "plans" and no
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
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
            Pay as you go
          </h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-ash">
            Pick a credit amount, then spend it across every model. Rates per model are in the catalogue below.
          </p>
        </div>
        <Button variant="ghost" size="md" className="cta-landing-soft" trailingIcon={<ArrowRight size={14} />} onClick={() => window.location.assign("/login")}>
          Add credit
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 sm:gap-5 lg:gap-6">
        {packages.map((pkg, index) => {
          const highlighted = packages.length > 2 ? index === 1 : index === 0;
          const trackPointer = (event: MouseEvent<HTMLDivElement>) => {
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
            event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
          };
          return (
            <Card
              key={pkg.sku}
              data-reveal
              onMouseMove={trackPointer}
              className={cn(
                "aethink-pricing-card",
                highlighted && "aethink-pricing-card--featured",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-warm max-[899px]:text-[15px]">{pkg.name}</p>
                {highlighted ? <span className="aethink-pricing-badge">Popular</span> : null}
              </div>
              <p className="mt-3 text-[22px] font-semibold leading-none tabular-nums text-warm max-[899px]:text-[24px]">
                {formatIDR(pkg.price_idr)}
              </p>
              <p className="mt-1 text-[11.5px] text-ash max-[899px]:text-[12.5px]">one-time credit purchase</p>

              <dl className="mt-3.5 space-y-1.5 border-t border-ash/12 pt-3 text-[12px]">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ash">Saldo kredit</dt>
                  <dd className="whitespace-nowrap tabular-nums text-warm/90">
                    {formatIDR(pkg.credits_micro / 1_000_000)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ash">Batas akun</dt>
                  <dd className="whitespace-nowrap tabular-nums text-warm/90">{pkg.rpm_limit} req/min</dd>
                </div>
              </dl>

              {pkg.blurb ? <p className="mt-2.5 text-[11.5px] leading-5 text-dim">{pkg.blurb}</p> : null}

              <div className="mt-auto pt-5">
                <Button
                  variant={highlighted ? "primary" : "secondary"}
                  size="md"
                  full
                  className={
                    highlighted
                      ? "aethink-pricing-btn aethink-pricing-btn--featured"
                      : "aethink-pricing-btn aethink-pricing-btn--default"
                  }
                  onClick={() => window.location.assign("/login")}
                >
                  Buy {pkg.name}
                </Button>
              </div>
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
