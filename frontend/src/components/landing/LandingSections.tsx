import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Copy } from "lucide-react";
import { ModelMark } from "@/components/brand/ModelMark";
import { Wordmark } from "@/components/layout/BrandLogo";
import { fetchShop, type Pkg, type TopupPolicy } from "@/lib/portal";
import { formatCompact, formatIDR, formatNumber } from "@/lib/format";
import type { LandingStatus } from "@/lib/landing-data";
import type { AIModel } from "@/types";
import { cn } from "@/lib/cn";

function ctxLabel(tokens: number): string {
  if (!tokens) return "n/a";
  if (tokens >= 999_500) {
    const m = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${m % 1 === 0 ? m.toFixed(0) : m}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

/* ------------------------------------------------------------------ quickstart */

type Lang = "curl" | "python" | "node";

const LANGS: Array<{ id: Lang; label: string }> = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node.js" },
];

function snippet(lang: Lang, base: string, model: string): string {
  if (lang === "python") {
    return `import os
from openai import OpenAI

client = OpenAI(base_url="${base}", api_key=os.environ["AETHINK_API_KEY"])

reply = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Halo"}],
)
print(reply.choices[0].message.content)`;
  }
  if (lang === "node") {
    return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: process.env.AETHINK_API_KEY,
});

const reply = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Halo" }],
});
console.log(reply.choices[0].message.content);`;
  }
  return `curl ${base}/chat/completions \\
  -H "Authorization: Bearer $AETHINK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Halo"}]
  }'`;
}

export function Quickstart({ models }: { models: AIModel[] }) {
  const [lang, setLang] = useState<Lang>("curl");
  const [copied, setCopied] = useState(false);
  const base = `${typeof window === "undefined" ? "" : window.location.origin}/v1`;
  const model = models[0]?.id ?? "MODEL_ID";
  const code = snippet(lang, base, model);

  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-2 sm:px-3">
        <div role="tablist" aria-label="Bahasa contoh kode" className="flex">
          {LANGS.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={lang === item.id}
              onClick={() => setLang(item.id)}
              className={cn(
                "relative h-11 px-3 text-[13px] transition-colors",
                lang === item.id ? "text-warm" : "text-ash hover:text-warm",
              )}
            >
              {item.label}
              {lang === item.id ? <span className="absolute inset-x-3 bottom-0 h-px bg-flame" aria-hidden /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ash transition-colors hover:bg-white/[0.06] hover:text-warm"
        >
          {copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={13} aria-hidden />}
          <span aria-live="polite">{copied ? "Tersalin" : "Salin"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-warm/90 sm:p-5 sm:text-[13px]">
        <code>{code}</code>
      </pre>
      <p className="border-t border-white/8 px-4 py-2.5 text-[12px] text-ash sm:px-5">
        Kompatibel dengan SDK OpenAI. Cukup ganti <span className="font-mono text-warm/85">base_url</span> dan API key.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ live status */

export function StatusStrip({ models, status }: { models: AIModel[]; status: LandingStatus | null }) {
  const items = [
    { label: "Model aktif", value: models.length ? String(models.length) : status?.models_active ? String(status.models_active) : "n/a" },
    { label: "Berhasil, 24 jam", value: status ? `${status.success_rate.toLocaleString("id-ID")}%` : "n/a" },
    { label: "Latensi p95", value: status?.p95_latency_ms ? `${formatNumber(status.p95_latency_ms)} ms` : "n/a" },
    { label: "Request, 24 jam", value: status ? formatCompact(status.requests_24h) : "n/a" },
  ];
  return (
    <section aria-label="Status gateway" className="border-y border-white/8">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <dl className="grid grid-cols-2 divide-white/8 sm:grid-cols-4 sm:divide-x">
          {items.map((item, index) => (
            <div
              key={item.label}
              className={cn("py-5 sm:px-6 sm:first:pl-0", index % 2 === 1 && "pl-4 sm:pl-6", index >= 2 && "border-t border-white/8 sm:border-t-0")}
            >
              <dt className="text-[13px] text-ash">{item.label}</dt>
              <dd className="num mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.02em] text-warm">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ how it works */

export function HowItWorks() {
  const steps = [
    { title: "Beli saldo", text: "Pilih paket di bot Telegram, lalu bayar lewat QRIS dari e-wallet atau m-banking apa pun." },
    { title: "Terima API key", text: "Begitu pembayaran terverifikasi, key dikirim ke chat Telegram yang sama." },
    { title: "Ganti base URL", text: "Arahkan SDK OpenAI kamu ke gateway ini. Kode lain tidak perlu diubah." },
  ];
  return (
    <section aria-labelledby="how-title" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-20">
      <h2 id="how-title" className="text-[26px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
        Dari bayar sampai request pertama
      </h2>
      <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
        {steps.map((step, index) => (
          <li key={step.title} className="border-t border-white/12 pt-4">
            <span className="font-mono text-[13px] text-flame">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="mt-3 text-[17px] font-semibold text-warm">{step.title}</h3>
            <p className="mt-2 max-w-[38ch] text-[14px] leading-6 text-ash">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ pricing */

export type Shop = { packages: Pkg[]; topup: TopupPolicy | null; loaded: boolean; failed: boolean };

export function useShop(): Shop {
  const [shop, setShop] = useState<Shop>({ packages: [], topup: null, loaded: false, failed: false });
  useEffect(() => {
    let alive = true;
    fetchShop()
      .then((data) => alive && setShop({ packages: data.packages, topup: data.topup, loaded: true, failed: false }))
      .catch(() => alive && setShop((prev) => ({ ...prev, loaded: true, failed: true })));
    return () => {
      alive = false;
    };
  }, []);
  return shop;
}

export function Pricing({ shop }: { shop: Shop }) {
  const { packages, topup, loaded, failed } = shop;

  const featured = packages.length > 2 ? 1 : 0;

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-white/8">
      <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="pricing-title" className="text-[26px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
              Harga paket
            </h2>
            <p className="mt-2 max-w-[56ch] text-[14px] leading-6 text-ash">
              Saldo tidak kedaluwarsa dan dipotong per token sesuai harga tiap model.
              {topup?.enabled ? ` Top-up bebas mulai ${formatIDR(topup.min_idr)}.` : ""}
            </p>
          </div>
        </div>

        {packages.length === 0 ? (
          <p className="mt-8 text-[14px] text-ash">
            {!loaded ? "Memuat paket…" : failed ? "Daftar paket belum bisa dimuat. Coba muat ulang halaman." : "Belum ada paket yang dibuka."}
          </p>
        ) : (
          <div className="surface mt-8 overflow-hidden">
            <div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr_auto] gap-4 border-b border-white/8 px-6 py-3 text-[13px] text-ash md:grid">
              <span>Paket</span>
              <span>Harga</span>
              <span>Saldo kredit</span>
              <span>Batas</span>
              <span className="w-28" />
            </div>
            <ul>
              {packages.map((pkg, index) => (
                <li
                  key={pkg.sku}
                  className={cn(
                    "grid gap-x-4 gap-y-3 border-b border-white/[0.06] px-4 py-5 last:border-0 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] md:items-center",
                    index === featured && "bg-white/[0.025]",
                  )}
                >
                  <div>
                    <p className="flex items-center gap-2 text-[16px] font-semibold text-warm">
                      {pkg.name}
                      {index === featured ? (
                        <span className="rounded-md border border-flame/30 px-1.5 py-0.5 text-[12px] font-medium text-flame">
                          Direkomendasikan
                        </span>
                      ) : null}
                    </p>
                    {pkg.blurb ? <p className="mt-1 text-[13px] leading-5 text-ash">{pkg.blurb}</p> : null}
                  </div>
                  <p className="num text-[20px] font-semibold tracking-[-0.01em] text-warm">{formatIDR(pkg.price_idr)}</p>
                  <p className="num text-[14px] text-warm/90">
                    <span className="text-ash md:hidden">Saldo </span>
                    {formatIDR(pkg.credits_micro / 1_000_000)}
                  </p>
                  <p className="num text-[14px] text-warm/90">
                    <span className="text-ash md:hidden">Batas </span>
                    {pkg.rpm_limit} req/menit
                  </p>
                  <Link
                    to="/login"
                    className={cn(
                      "inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-[13.5px] font-medium transition-colors md:h-10 md:w-28",
                      index === featured
                        ? "bg-flame text-[#1a1305] hover:bg-[#f09a52]"
                        : "border border-white/14 text-warm hover:bg-white/[0.06]",
                    )}
                  >
                    Beli {pkg.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ catalogue */

function availabilityLabel(model: AIModel): { text: string; dot: string } {
  if ((model.availability ?? "on") === "maintenance") return { text: "Maintenance", dot: "bg-flame" };
  if (!model.enabled || model.availability === "off") return { text: "Nonaktif", dot: "bg-white/30" };
  return { text: "Online", dot: "bg-ok" };
}

export function ModelCatalog({ models }: { models: AIModel[] }) {
  const maxContext = useMemo(() => Math.max(0, ...models.map((m) => Number(m.contextWindow) || 0)), [models]);

  return (
    <section id="catalog" aria-labelledby="catalog-title" className="scroll-mt-20 border-t border-white/8">
      <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-20">
        <h2 id="catalog-title" className="text-[26px] font-semibold tracking-[-0.02em] text-warm sm:text-[30px]">
          {models.length ? `${models.length} model, konteks sampai ${ctxLabel(maxContext)} token` : "Katalog model"}
        </h2>
        <p className="mt-2 max-w-[56ch] text-[14px] leading-6 text-ash">
          Harga dalam Rupiah per 1 juta token. Daftar ini diambil langsung dari gateway.
        </p>

        {models.length === 0 ? (
          <p className="mt-8 text-[14px] text-ash">Katalog sedang disinkronkan dari gateway…</p>
        ) : (
          <>
            <div className="surface mt-8 hidden overflow-hidden md:block">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Katalog model dengan konteks dan harga per juta token</caption>
                <thead>
                  <tr className="border-b border-white/8 text-[13px] text-ash">
                    <th scope="col" className="px-6 py-3 font-medium">Model</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Konteks</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Input / 1M</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Output / 1M</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const state = availabilityLabel(model);
                    return (
                      <tr key={model.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02]">
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <ModelMark modelId={model.modelId} provider={model.provider} size={18} className="shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[14px] font-medium text-warm">{model.displayName}</p>
                              <p className="font-mono text-[12px] text-ash">{model.modelId}</p>
                            </div>
                          </div>
                        </td>
                        <td className="num px-4 py-3.5 text-right text-[14px] text-warm/90">{ctxLabel(model.contextWindow)}</td>
                        <td className="num px-4 py-3.5 text-right text-[14px] text-warm/90">{formatIDR(model.inputRate)}</td>
                        <td className="num px-4 py-3.5 text-right text-[14px] text-warm/90">{formatIDR(model.outputRate)}</td>
                        <td className="px-6 py-3.5 text-right">
                          <span className="inline-flex items-center gap-2 text-[13px] text-ash">
                            <span className={cn("size-1.5 rounded-full", state.dot)} aria-hidden />
                            {state.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="mt-8 divide-y divide-white/[0.08] border-y border-white/8 md:hidden">
              {models.map((model) => {
                const state = availabilityLabel(model);
                return (
                  <li key={model.id} className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <ModelMark modelId={model.modelId} provider={model.provider} size={18} className="shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium text-warm">{model.displayName}</p>
                          <p className="truncate font-mono text-[12px] text-ash">{model.modelId}</p>
                        </div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-[12.5px] text-ash">
                        <span className={cn("size-1.5 rounded-full", state.dot)} aria-hidden />
                        {state.text}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
                      <div>
                        <dt className="text-ash">Konteks</dt>
                        <dd className="num mt-0.5 text-warm">{ctxLabel(model.contextWindow)}</dd>
                      </div>
                      <div>
                        <dt className="text-ash">Input / 1M</dt>
                        <dd className="num mt-0.5 text-warm">{formatIDR(model.inputRate)}</dd>
                      </div>
                      <div>
                        <dt className="text-ash">Output / 1M</dt>
                        <dd className="num mt-0.5 text-warm">{formatIDR(model.outputRate)}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */

export function SiteFooter() {
  return (
    <footer className="border-t border-white/8">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <Wordmark compact />
          <p className="mt-3 text-[13px] text-ash">Gateway API model AI, dibayar dalam Rupiah.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-1 text-[13.5px] text-ash">
          <Link to="/panduan" className="inline-flex h-9 items-center hover:text-warm">Panduan</Link>
          <Link to="/status" className="inline-flex h-9 items-center hover:text-warm">Status</Link>
          <Link to="/login" className="inline-flex h-9 items-center hover:text-warm">Masuk</Link>
        </nav>
      </div>
      <p className="mx-auto max-w-[1200px] px-4 pb-8 text-[12.5px] text-dim sm:px-6">
        © {new Date().getFullYear()} AethinkAI
      </p>
    </footer>
  );
}

export function ClosingCta({ cheapest }: { cheapest: number | null }) {
  return (
    <section className="border-t border-white/8">
      <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-5 px-4 py-14 sm:px-6 md:flex-row md:items-center">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-warm sm:text-[26px]">Siap kirim request pertama?</h2>
          <p className="mt-2 text-[14px] text-ash">
            {cheapest ? `Paket termurah mulai ${formatIDR(cheapest)}, key langsung dikirim ke Telegram.` : "Key langsung dikirim ke Telegram setelah pembayaran."}
          </p>
        </div>
        <Link
          to="/login"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-flame px-6 text-[15px] font-medium text-[#1a1305] transition-colors hover:bg-[#f09a52] md:w-auto"
        >
          Ambil API key <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
