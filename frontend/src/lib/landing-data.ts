import { useEffect, useMemo, useState } from "react";
import type { AIModel, ModelCategory, Provider } from "@/types";
import { SEED_MODELS } from "@/data/fixtures";

/**
 * Landing data — everything the public page claims must come from the gateway,
 * not from fixtures. `/api/models` is public (no auth) and `/api/status` returns
 * aggregate-only numbers.
 */

export interface ApiModel {
  id: string;
  display_name: string;
  provider: string;
  context_length: number;
  max_completion_tokens?: number;
  capabilities?: Record<string, boolean>;
  pricing_idr_per_1m: { input: number; output: number; cached_input?: number };
}

export interface LandingStatus {
  status: "operational" | "degraded";
  db: boolean;
  uptime_seconds: number;
  models_active: number;
  requests_24h: number;
  requests_7d: number;
  last_request_at: string | null;
  tokens_24h: number;
  errors_24h: number;
  p95_latency_ms: number;
  success_rate: number;
}

const PROVIDER_MAP: Record<string, Provider> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  zhipu: "GLM",
  glm: "GLM",
  moonshot: "Kimi",
  kimi: "Kimi",
  alibaba: "Qwen",
  qwen: "Qwen",
};

const providerOf = (raw: string): Provider => PROVIDER_MAP[raw.toLowerCase()] ?? "DeepSeek";

const categoryOf = (model: ApiModel): ModelCategory => {
  const caps = model.capabilities ?? {};
  if (caps.vision || caps.pdf) return "Multimodal";
  if (caps.reasoning) return "Reasoning";
  return "Coding";
};

const capabilityLabels = (model: ApiModel): string[] =>
  Object.entries(model.capabilities ?? {})
    .filter(([, on]) => on)
    .map(([key]) => key[0].toUpperCase() + key.slice(1));

/** Public model → the AIModel shape the landing components already render. */
export function toAIModel(model: ApiModel, index: number): AIModel {
  const { input, output, cached_input } = model.pricing_idr_per_1m;
  const cached = typeof cached_input === "number" ? ` · cache Rp ${cached_input.toLocaleString("id-ID")}` : "";
  return {
    id: model.id,
    displayName: model.display_name,
    modelId: model.id,
    provider: providerOf(model.provider),
    category: categoryOf(model),
    description: `Rp ${input.toLocaleString("id-ID")} in · Rp ${output.toLocaleString("id-ID")} out per 1M token${cached}`,
    contextWindow: model.context_length,
    inputRate: input,
    outputRate: output,
    enabled: true,
    popularity: Math.max(1, 100 - index * 7),
    capabilities: capabilityLabels(model),
  };
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export interface LandingData {
  models: AIModel[];
  status: LandingStatus | null;
  live: boolean;
}

export function useLandingData(): LandingData {
  const [apiModels, setApiModels] = useState<ApiModel[]>([]);
  const [status, setStatus] = useState<LandingStatus | null>(null);

  useEffect(() => {
    let alive = true;

    const pull = async () => {
      try {
        const body = await getJSON<{ data: ApiModel[] }>("/api/models");
        if (alive) setApiModels(body.data ?? []);
      } catch {
        /* keep previous snapshot; landing never blanks out */
      }
      try {
        const snapshot = await getJSON<LandingStatus>("/api/status");
        if (alive) setStatus(snapshot);
      } catch {
        /* status panel simply shows "unknown" */
      }
    };

    void pull();
    const timer = window.setInterval(() => void pull(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const models = useMemo(
    () => (apiModels.length ? apiModels.map(toAIModel) : SEED_MODELS.filter((model) => model.enabled)),
    [apiModels],
  );

  return { models, status, live: apiModels.length > 0 };
}
