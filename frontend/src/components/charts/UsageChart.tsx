import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SeriesPoint } from "@/types";
import { cn } from "@/lib/cn";
import { formatCompact, formatIDR, formatIDRCompact, formatNumber } from "@/lib/format";
import { useMediaQuery } from "@/hooks/useMediaQuery";

type Mode = "requests" | "tokens" | "cost";

interface UsageChartProps {
  data: SeriesPoint[];
  /** Controlled metric. Leave undefined to show the built-in switch. */
  mode?: Mode;
  height?: number;
  compact?: boolean;
}

const METRICS: Array<{ key: Mode; label: string; unit: string }> = [
  { key: "requests", label: "Request", unit: "request" },
  { key: "tokens", label: "Token", unit: "token" },
  { key: "cost", label: "Biaya", unit: "biaya" },
];

const fmtTick = (mode: Mode) => (value: number) => (mode === "cost" ? formatIDRCompact(value) : formatCompact(value));
const fmtValue = (mode: Mode) => (value: number) => (mode === "cost" ? formatIDR(value) : formatNumber(value));

function ChartTooltip({ active, payload, label, mode }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; mode: Mode }) {
  if (!active || !payload?.length) return null;
  const metric = METRICS.find((m) => m.key === mode)!;
  return (
    <div className="rounded-lg border border-white/12 bg-[#0d0d0f] px-3 py-2">
      <p className="text-[12px] text-ash">{label}</p>
      <p className="num mt-0.5 text-[13px] font-medium text-warm">
        {fmtValue(mode)(payload[0].value)} <span className="font-normal text-ash">{metric.unit}</span>
      </p>
    </div>
  );
}

export function UsageChart({ data, mode, height = 260, compact }: UsageChartProps) {
  const isPhone = useMediaQuery("(max-width: 639px)");
  const [picked, setPicked] = useState<Mode>("requests");
  const active: Mode = mode ?? picked;
  const chartHeight = isPhone ? Math.min(height, 200) : height;
  const total = data.reduce((sum, point) => sum + (point[active] ?? 0), 0);
  const empty = total === 0;

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        {METRICS.find((m) => m.key === active)!.label} per hari, {data.length} titik data.
      </figcaption>

      {mode === undefined && !compact ? (
        <div role="tablist" aria-label="Metrik grafik" className="mb-3 inline-flex rounded-lg border border-white/10 p-0.5">
          {METRICS.map((metric) => (
            <button
              key={metric.key}
              role="tab"
              type="button"
              aria-selected={active === metric.key}
              onClick={() => setPicked(metric.key)}
              className={cn(
                "h-9 rounded-md px-3 text-[12.5px] font-medium transition-colors sm:h-8",
                active === metric.key ? "bg-white/10 text-warm" : "text-ash hover:text-warm",
              )}
            >
              {metric.label}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ height: chartHeight }} className="relative w-full">
        {empty ? (
          <p className="absolute inset-0 z-10 grid place-items-center text-[13px] text-ash">
            Belum ada {METRICS.find((m) => m.key === active)!.unit} di periode ini.
          </p>
        ) : null}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: compact ? 0 : 6, bottom: 0, left: compact ? -22 : -6 }}>
            <defs>
              <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E7893C" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#E7893C" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#ffffff" strokeOpacity={0.06} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#9A9DA1", fontSize: 11.5 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "#9A9DA1", fontSize: 11.5 }}
              tickLine={false}
              axisLine={false}
              width={compact ? 44 : active === "cost" ? 64 : 48}
              tickFormatter={fmtTick(active)}
            />
            <Tooltip content={<ChartTooltip mode={active} />} cursor={{ stroke: "#ffffff", strokeOpacity: 0.18 }} />
            <Area
              type="monotone"
              dataKey={active}
              stroke="#E7893C"
              strokeWidth={1.75}
              fill="url(#usage-fill)"
              activeDot={{ r: 3.5, strokeWidth: 0, fill: "#E7893C" }}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
