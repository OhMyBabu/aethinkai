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

export function delta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}
