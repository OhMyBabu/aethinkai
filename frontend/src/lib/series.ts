import type { GwUsage } from "@/lib/gw";
import type { Range, SeriesPoint, UsageEntry } from "@/types";

export function buildSeries(
  usage: UsageEntry[],
  range: Range,
  modelId: string,
  keyId: string,
  now = new Date(),
): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const filtered = usage.filter(
    (entry) =>
      (modelId === "all" || entry.modelId === modelId) &&
      (keyId === "all" || entry.keyId === keyId),
  );

  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86400000);
    const key = day.toISOString().slice(0, 10);
    const dayEntries = filtered.filter((entry) => entry.at.slice(0, 10) === key);
    const requests = dayEntries.length;
    const tokens = dayEntries.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0);
    const errors = dayEntries.filter((entry) => entry.status === "error").length;
    const cost = dayEntries.reduce((sum, entry) => sum + entry.cost, 0);
    points.push({
      date: key,
      label: new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", timeZone: "Asia/Jakarta" }).format(day),
      requests,
      tokens,
      errors,
      cost,
    });
  }
  return points;
}

export function seriesTotals(points: SeriesPoint[]) {
  return points.reduce(
    (acc, point) => ({
      requests: acc.requests + point.requests,
      tokens: acc.tokens + point.tokens,
      errors: acc.errors + point.errors,
      cost: acc.cost + point.cost,
    }),
    { requests: 0, tokens: 0, errors: 0, cost: 0 },
  );
}

/**
 * Percent change, or NaN when there is no honest baseline (previous period empty).
 * StatCard hides a non-finite delta, so a new account never shows an invented "+100%".
 */
export function delta(current: number, previous: number): number {
  if (previous === 0) return Number.NaN;
  return ((current - previous) / previous) * 100;
}

const dayLabel = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", timeZone: "UTC" });

/**
 * Daily series from the gateway's aggregate endpoint (`/api/me/usage`, `/api/admin/usage`).
 * Unlike buildSeries it is not limited to the last N request rows, so 30 and 90 day ranges are exact.
 * Pass `usage` fetched for `range * 2` days to also get the previous period via `previousTotals`.
 */
export function seriesFromUsage(usage: GwUsage | null, range: Range, now = new Date()): SeriesPoint[] {
  const byDay = new Map<string, SeriesPoint>();
  for (const row of usage?.by_day_model ?? []) {
    const key = row.day.slice(0, 10);
    const point = byDay.get(key) ?? { date: key, label: "", requests: 0, tokens: 0, errors: 0, cost: 0 };
    point.requests += row.requests;
    point.tokens += row.tokens_in + row.tokens_out;
    point.cost += row.cost_micro / 1_000_000;
    byDay.set(key, point);
  }
  const points: SeriesPoint[] = [];
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86400000);
    const key = day.toISOString().slice(0, 10);
    const point = byDay.get(key) ?? { date: key, label: "", requests: 0, tokens: 0, errors: 0, cost: 0 };
    points.push({ ...point, label: dayLabel.format(day) });
  }
  return points;
}

/** Totals for the `range` days that came before the current `range` days. */
export function previousTotals(usage: GwUsage | null, range: Range, now = new Date()) {
  const cutoff = new Date(now.getTime() - range * 86400000).toISOString().slice(0, 10);
  const older = (usage?.by_day_model ?? []).filter((row) => row.day.slice(0, 10) <= cutoff);
  return older.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      tokens: acc.tokens + row.tokens_in + row.tokens_out,
      cost: acc.cost + row.cost_micro / 1_000_000,
    }),
    { requests: 0, tokens: 0, cost: 0 },
  );
}
