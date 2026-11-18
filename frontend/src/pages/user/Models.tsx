import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { SearchInput } from "@/components/common/SearchInput";
import { FilterSelect } from "@/components/common/FilterSelect";
import { StatusPill } from "@/components/common/StatusPill";
import { Button } from "@/components/common/Button";
import { Drawer } from "@/components/common/Drawer";
import { EmptyState } from "@/components/common/EmptyState";
import { catalogStream, publicModels } from "@/lib/gw";
import type { Provider } from "@/types";
import type { AIModel, ModelCategory } from "@/types";
import { formatCompact, formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ModelMark } from "@/components/brand/ModelMark";

const categories: Array<ModelCategory | "all"> = ["all", "Reasoning", "Coding", "Multimodal"];

type LiveModel = {
  id: string;
  display_name: string;
  provider: string;
  context_length: number;
  capabilities: Record<string, boolean>;
  pricing_idr_per_1m: { input: number; output: number; cached_input: number };
};

const PROVIDER_MARKS: Array<[RegExp, string]> = [
  [/deepseek/i, "DeepSeek"],
  [/glm/i, "GLM"],
  [/kimi/i, "Kimi"],
  [/claude|fable|sonnet|opus/i, "Anthropic"],
  [/qwen|minimax/i, "Qwen"],
];

const providerMark = (id: string): Provider | null =>
  (PROVIDER_MARKS.find(([re]) => re.test(id))?.[1] as Provider | undefined) ?? null;

/** The gateway exposes a transport name ("openai-compatible"), not a brand. */
const PROVIDER_NAMES: Provider[] = ["DeepSeek", "Qwen", "GLM", "Kimi", "Anthropic"];
const providerName = (raw?: string): Provider => {
  if (!raw) return "Gateway";
  if (/openai-compatible|gateway|openrouter/i.test(raw)) return "Gateway";
  return PROVIDER_NAMES.includes(raw as Provider) ? (raw as Provider) : "Gateway";
};

const CAPABILITY_LABELS: Record<string, string> = {
  tools: "pemanggilan fungsi",
  reasoning: "penalaran",
  vision: "input gambar",
  json: "output JSON",
  streaming: "streaming",
};

function toAIModel(m: LiveModel, index: number): AIModel {
  const caps = Object.keys(m.capabilities || {});
  const category: ModelCategory = m.capabilities?.reasoning
    ? "Reasoning"
    : m.capabilities?.vision
      ? "Multimodal"
      : "Coding";
  return {
    id: m.id,
    displayName: m.display_name,
    modelId: m.id,
    provider: providerMark(m.id) ?? providerName(m.provider),
    category,
    description: caps.length
      ? `Mendukung ${caps.slice(0, 4).map((c) => CAPABILITY_LABELS[c] ?? c).join(", ")}.`
      : "Model teks standar gateway.",
    contextWindow: m.context_length || 0,
    inputRate: m.pricing_idr_per_1m.input,
    outputRate: m.pricing_idr_per_1m.output,
    enabled: true,
    popularity: 100 - index,
    capabilities: caps,
  };
}

export default function UserModelsPage() {
  const [live, setLive] = useState<LiveModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ModelCategory | "all">("all");
  const [sort, setSort] = useState("popularity");
  const [detail, setDetail] = useState<AIModel | null>(null);

  // The catalogue is admin-controlled: a price change must reach an open tab,
  // not only a fresh page load. Poll while visible, refresh on focus.
  useEffect(() => {
    let cancelled = false;
    const pull = (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      publicModels()
        .then((data) => {
          if (!cancelled) {
            setLive(data.data as LiveModel[]);
            setLoadError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setLoadError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    pull(true);
    const offStream = catalogStream(() => pull(false));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") pull(false);
    }, 20_000);
    const onFocus = () => pull(false);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      offStream();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const all = useMemo(() => live.map(toAIModel), [live]);

  const models = useMemo(() => {
    const list = all.filter((model) => {
      const matchesQuery = `${model.displayName} ${model.modelId} ${model.provider}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesCategory = category === "all" || model.category === category;
      return matchesQuery && matchesCategory;
    });
    return [...list].sort((a, b) => {
      if (sort === "name") return a.displayName.localeCompare(b.displayName);
      if (sort === "context") return b.contextWindow - a.contextWindow;
      return b.popularity - a.popularity;
    });
  }, [all, query, category, sort]);

  return (
    <div>
      <PageHeader
        title="Model & harga"
        description="Katalog ini mengikuti model yang diaktifkan admin. Model tanpa harga tidak muncul dan ditolak gateway."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "Model" }]}
        actions={<StatusPill tone="active">{all.length} aktif</StatusPill>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari nama atau ID model…" className="w-full sm:w-72" />
        <FilterSelect
          label="Kategori"
          value={category}
          onChange={(value) => setCategory(value as ModelCategory | "all")}
          options={categories.map((value) => ({
            value,
            label: value === "all" ? "Semua kategori" : value,
          }))}
        />
        <FilterSelect
          label="Urutkan"
          value={sort}
          onChange={setSort}
          options={[
            { value: "popularity", label: "Paling banyak dipakai" },
            { value: "name", label: "Nama A–Z" },
            { value: "context", label: "Konteks terbesar" },
          ]}
        />
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ash">
          <SlidersHorizontal size={12} aria-hidden />
          {models.length} model
        </span>
      </div>

      {loadError ? (
        <Card className="mb-4 border-bad/40 bg-bad/10 p-4 text-[13px] text-bad">
          Gagal memuat katalog: {loadError}
        </Card>
      ) : null}

      {loading ? (
        <Card className="mb-4 p-4 text-[12.5px] text-ash">Memuat katalog dari gateway…</Card>
      ) : null}

      {!loading && models.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Search}
            title="Tidak ada model yang cocok"
            description="Kosongkan pencarian atau kembalikan kategori ke Semua."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                Atur ulang filter
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {models.map((model) => (
            <Card
              key={model.id}
              interactive
              className={cn("flex h-full flex-col", !model.enabled && "opacity-60")}
              onClick={() => setDetail(model)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-ash/20 bg-warm/[0.04] text-warm/85">
                    <ModelMark modelId={model.modelId} size={18} variant="brand" />
                  </span>
                  <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-warm">{model.displayName}</p>
                  <p className="mt-0.5 truncate text-[12px] text-ash">
                    {model.contextWindow ? `${formatCompact(model.contextWindow)} context` : "Gateway model"}
                  </p>
                  </div>
                </div>
                <StatusPill tone={model.enabled ? "active" : "revoked"}>{model.enabled ? "tersedia" : "nonaktif"}</StatusPill>
              </div>

              <p className="mt-3 line-clamp-3 text-[12.5px] leading-6 text-ash">{model.description}</p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[12px] text-ash">{model.category}</span>
                <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[12px] text-ash">
                  {formatCompact(model.contextWindow)} context
                </span>
                <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[12px] text-ash">{model.provider}</span>
              </div>

              <div className="mt-4 flex items-end justify-between gap-2 border-t border-ash/12 pt-3">
                <div>
                  <p className="text-[12px] text-dim">Harga / 1M</p>
                  <p className="mt-0.5 text-[12px] tabular-nums text-warm">
                    {formatIDR(model.inputRate)} <span className="text-ash">in</span> · {formatIDR(model.outputRate)}{" "}
                    <span className="text-ash">out</span>
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.displayName ?? "Model"}
        description={detail ? `${detail.provider} · ${detail.category}` : undefined}
        footer={
          detail ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Tutup</Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-1.5">
              <StatusPill tone={detail.enabled ? "active" : "revoked"}>
                {detail.enabled ? "tersedia" : "nonaktif"}
              </StatusPill>
              <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[12px] text-ash">
                {formatCompact(detail.contextWindow)} context
              </span>
              <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[12px] text-ash">
                popularity {detail.popularity}
              </span>
            </div>

            <p className="text-[13px] leading-6 text-ash">{detail.description}</p>

            <div>
              <p className="mb-1.5 text-[12px] text-ash">Capabilities</p>
              <ul className="flex flex-wrap gap-1.5">
                {detail.capabilities.map((capability) => (
                  <li key={capability} className="rounded-md border border-flame/25 bg-flame/[0.08] px-2 py-1 text-[12px] text-flame">
                    {capability}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-1.5 text-[12px] text-ash">Sample request</p>
              <pre className="overflow-x-auto rounded-xl border border-ash/15 bg-panel p-3 font-mono text-[12px] leading-5 text-warm/85">
{`POST /v1/chat/completions
{
  "model": "${detail.modelId}",
  "messages": [
    { "role": "user", "content": "Summarise this invoice" }
  ],
  "stream": false
}

# Send the same payload with your key to run it live.`}
              </pre>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-ash/15 bg-warm/[0.02] p-3">
                <p className="text-[12px] text-dim">Input / 1M token</p>
                <p className="mt-1 text-[13px] tabular-nums text-warm">{formatIDR(detail.inputRate)}</p>
              </div>
              <div className="rounded-xl border border-ash/15 bg-warm/[0.02] p-3">
                <p className="text-[12px] text-dim">Output / 1M token</p>
                <p className="mt-1 text-[13px] tabular-nums text-warm">{formatIDR(detail.outputRate)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}