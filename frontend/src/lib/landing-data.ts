import { useEffect, useMemo, useState } from "react";
import { catalogStream } from "@/lib/gw";
import type { AIModel, ModelCategory, Provider } from "@/types";

/**
 * Landing data — everything the public page claims must come from the gateway,
 * not from fixtures. `/api/models` is public (no auth) and `/api/status` returns
 * aggregate-only numbers.
 */

export interface ApiModel {
  id: string;
  status?: "on" | "maintenance" | "off";
  display_name: string;
  provider: string;
  context_length: number;
  max_completion_tokens?: number;
  capabilities?: Record<string, boolean>;
  pricing_idr_per_1m: { input: number; output: number; cached_input?: number };
}

export interface LandingStatus {
  status: "operational" | "degraded";
  window_minutes?: number;
  window_requests?: number;
  window_error_pct?: number;
  models?: Array<{
    model_id: string;
    requests: number;
    tokens: number;
    errors: number;
    p95_latency_ms: number | null;
  }>;
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
    enabled: model.status !== "off",
    availability: model.status ?? "on",
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
    // realtime: the gateway pushes on every admin change; polling stays as a net
    const offStream = catalogStream(() => void pull());
    // admin edits must show up without a reload: poll + refresh on focus
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void pull();
    }, 15_000);
    const onFocus = () => void pull();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      offStream();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Never fall back to fixtures: a buyer must not see an invented price when the
  // gateway is unreachable. Empty catalogue renders as "sinkron…", not as fake data.
  const models = useMemo(() => apiModels.map(toAIModel), [apiModels]);

  return { models, status, live: apiModels.length > 0 };
}
