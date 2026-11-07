import { publicModels, type GwRequestRow } from "@/lib/gw";
import type { UsageEntry } from "@/types";

let nameCache: Record<string, string> | null = null;

/** model slug → display name, from the live catalogue (admin-controlled). */
export async function modelNames(): Promise<Record<string, string>> {
  if (nameCache) return nameCache;
  try {
    const data = await publicModels();
    nameCache = Object.fromEntries(data.data.map((m) => [m.id, m.display_name]));
  } catch {
    nameCache = {};
  }
  return nameCache;
}

export function clearModelNames() {
  nameCache = null;
}

/** Gateway usage row → the shape the dashboard components already render. */
export function toUsageEntry(row: GwRequestRow): UsageEntry {
  return {
    id: row.id,
    userId: "",
    keyId: row.key_name ?? "",
    modelId: row.model_id,
    at: row.created_at,
    inputTokens: Number(row.tokens_in ?? 0),
    outputTokens: Number(row.tokens_out ?? 0),
    status: row.status === "ok" ? "success" : "error",
    latencyMs: Number(row.latency_ms ?? 0),
    cost: Number(row.cost_micro ?? 0) / 1_000_000,
  } as UsageEntry;
}
