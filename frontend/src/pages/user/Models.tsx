import { useEffect, useMemo, useState } from "react";
import { Boxes, Play, Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { SearchInput } from "@/components/common/SearchInput";
import { FilterSelect } from "@/components/common/FilterSelect";
import { StatusPill } from "@/components/common/StatusPill";
import { Button } from "@/components/common/Button";
import { Drawer } from "@/components/common/Drawer";
import { Modal } from "@/components/common/Modal";
import { EmptyState } from "@/components/common/EmptyState";
import { publicModels } from "@/lib/gw";
import type { AIModel, ModelCategory } from "@/types";
import { formatCompact, formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ModelMark } from "@/components/brand/ModelMark";

const categories: Array<ModelCategory | "all"> = ["all", "Reasoning", "Coding", "Multimodal"];

const sampleAnswers: Record<string, string> = {
  Reasoning:
    "Reasoning trace: the request splits into three checks — schema validation, retrieval of the two candidate rows, then a reconciliation step. Result: 14 records match, 2 need manual review.",
  Coding:
    "Suggested patch: wrap the fetch in a retry helper with exponential backoff, cap at 3 attempts, and surface the final error through the existing toast channel.",
  Multimodal:
    "Image summary: the uploaded invoice shows 6 line items, a subtotal of Rp 1.284.000, tax of Rp 141.240 and a total of Rp 1.425.240. Extraction confidence 0.98.",
};

type LiveModel = {
  id: string;
  display_name: string;
  provider: string;
  context_length: number;
  capabilities: Record<string, boolean>;
  pricing_idr_per_1m: { input: number; output: number; cached_input: number };
};

const PROVIDER_MARKS: Array<[RegExp, "DeepSeek" | "Qwen" | "GLM" | "Kimi"]> = [
  [/deepseek/i, "DeepSeek"],
  [/qwen|minimax/i, "Qwen"],
  [/glm/i, "GLM"],
  [/kimi/i, "Kimi"],
];

const providerMark = (id: string) => PROVIDER_MARKS.find(([re]) => re.test(id))?.[1] ?? null;

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
    provider: providerMark(m.id) ?? "DeepSeek",
    category,
    description: `${m.display_name} — ${m.context_length ? `${formatCompact(m.context_length)} context` : "gateway model"}${caps.length ? ` · ${caps.slice(0, 3).join(", ")}` : ""}.`,
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
  const [tryModel, setTryModel] = useState<AIModel | null>(null);
  const [prompt, setPrompt] = useState("Summarise the attached invoice and list the totals.");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

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
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") pull(false);
    }, 20_000);
    const onFocus = () => pull(false);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
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

  const runSample = () => {
    if (!tryModel) return;
    setRunning(true);
    setOutput(null);
    window.setTimeout(() => {
      setOutput(sampleAnswers[tryModel.category]);
      setRunning(false);
    }, 900);
  };

  return (
    <div>
      <PageHeader
        title="AI Models"
        description="Katalog ini mengikuti model yang diaktifkan admin. Model tanpa harga tidak muncul dan ditolak gateway."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "Models" }]}
        actions={<StatusPill tone="active">{all.length} enabled</StatusPill>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search model name or ID…" className="w-full sm:w-72" />
        <FilterSelect
          label="Category"
          value={category}
          onChange={(value) => setCategory(value as ModelCategory | "all")}
          options={categories.map((value) => ({
            value,
            label: value === "all" ? "All categories" : value,
          }))}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "popularity", label: "Most popular" },
            { value: "name", label: "Name A–Z" },
            { value: "context", label: "Largest context" },
          ]}
        />
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ash">
          <SlidersHorizontal size={12} aria-hidden />
          {models.length} result{models.length === 1 ? "" : "s"}
        </span>
      </div>

      {loadError ? (
        <Card className="mb-4 border-[#c4633a]/40 bg-[#c4633a]/10 p-4 text-[13px] text-[#e79c78]">
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
            title="No models match those filters"
            description="Clear the search or switch category back to All."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                Reset filters
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
                  <p className="mt-0.5 truncate text-[10.5px] text-ash">
                    {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K context` : "Gateway model"}
                  </p>
                  </div>
                </div>
                <StatusPill tone={model.enabled ? "active" : "revoked"}>{model.enabled ? "available" : "unavailable"}</StatusPill>
              </div>

              <p className="mt-3 line-clamp-3 text-[12.5px] leading-6 text-ash">{model.description}</p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[10px] text-ash">{model.category}</span>
                <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[10px] text-ash">
                  {formatCompact(model.contextWindow)} context
                </span>
                <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[10px] text-ash">{model.provider}</span>
              </div>

              <div className="mt-4 flex items-end justify-between gap-2 border-t border-ash/12 pt-3">
                <div>
                  <p className="text-[9.5px] uppercase tracking-[0.12em] text-dim">Price / 1M</p>
                  <p className="mt-0.5 text-[12px] tabular-nums text-warm">
                    {formatIDR(model.inputRate)} <span className="text-ash">in</span> · {formatIDR(model.outputRate)}{" "}
                    <span className="text-ash">out</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!model.enabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDetail(null);
                    setTryModel(model);
                    setOutput(null);
                    setPrompt("Summarise the attached invoice and list the totals.");
                  }}
                >
                  Try model
                </Button>
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
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Play size={13} />}
                disabled={!detail.enabled}
                onClick={() => {
                  const model = detail;
                  setDetail(null);
                  setTryModel(model);
                  setOutput(null);
                }}
              >
                Playground
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-1.5">
              <StatusPill tone={detail.enabled ? "active" : "revoked"}>
                {detail.enabled ? "available" : "unavailable"}
              </StatusPill>
              <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[10.5px] text-ash">
                {formatCompact(detail.contextWindow)} context
              </span>
              <span className="rounded-md border border-ash/20 px-1.5 py-0.5 text-[10.5px] text-ash">
                popularity {detail.popularity}
              </span>
            </div>

            <p className="text-[13px] leading-6 text-ash">{detail.description}</p>

            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-ash">Capabilities</p>
              <ul className="flex flex-wrap gap-1.5">
                {detail.capabilities.map((capability) => (
                  <li key={capability} className="rounded-md border border-flame/25 bg-flame/[0.08] px-2 py-1 text-[11px] text-flame">
                    {capability}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-ash">Sample request</p>
              <pre className="overflow-x-auto rounded-xl border border-ash/15 bg-[#121316] p-3 font-mono text-[11px] leading-5 text-warm/85">
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
                <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Input / 1M tokens</p>
                <p className="mt-1 text-[13px] tabular-nums text-warm">{formatIDR(detail.inputRate)}</p>
              </div>
              <div className="rounded-xl border border-ash/15 bg-warm/[0.02] p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Output / 1M tokens</p>
                <p className="mt-1 text-[13px] tabular-nums text-warm">{formatIDR(detail.outputRate)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={Boolean(tryModel)}
        onClose={() => {
          setTryModel(null);
          setRunning(false);
        }}
        title={`Playground · ${tryModel?.displayName ?? "model"}`}
        description="Send a prompt to preview the response shape for this model."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTryModel(null);
                setOutput(null);
              }}
            >
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={runSample} disabled={running || prompt.trim().length < 3}>
              {running ? "Running…" : "Run sample"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-[12px] font-medium text-ash" htmlFor="sample-prompt">
            Prompt
          </label>
          <textarea
            id="sample-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-ash/22 bg-[#141518] px-3 py-2.5 text-[13px] text-warm focus:border-flame/55 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
          {prompt.trim().length < 3 ? (
            <p className="text-[11px] text-[#e08a5f]">Enter at least 3 characters to run the sample.</p>
          ) : null}

          <div className="min-h-[96px] rounded-xl border border-ash/18 bg-[#121316] p-3">
            {running ? (
              <div className="space-y-2" aria-live="polite">
                <div className="shimmer h-3 w-2/3 rounded" />
                <div className="shimmer h-3 w-full rounded" />
                <div className="shimmer h-3 w-4/5 rounded" />
              </div>
            ) : output ? (
              <p className="text-[12.5px] leading-6 text-warm/85">{output}</p>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-ash">
                <Boxes size={13} aria-hidden /> Output appears here.
              </p>
            )}
          </div>
          <p className="text-[10.5px] leading-4 text-dim">
            Live key · masked in this preview. Sample output is illustrative of the response shape.
          </p>
        </div>
      </Modal>
    </div>
  );
}