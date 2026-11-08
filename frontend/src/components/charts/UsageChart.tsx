import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesPoint } from "@/types";
import { formatCompact, formatNumber } from "@/lib/format";
import { useMediaQuery } from "@/hooks/useMediaQuery";

interface UsageChartProps {
  data: SeriesPoint[];
  mode?: "requests" | "tokens" | "cost";
  height?: number;
  compact?: boolean;
}

const palette = {
  requests: { primary: "#E7893C", secondary: "#B4B6B9" },
  tokens: { primary: "#E7893C", secondary: "#FAF8F4" },
  cost: { primary: "#E7893C", secondary: "#85888B" },
} as const;

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ash/25 bg-[#111214]/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="mb-1 text-[11px] font-medium text-ash">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="flex items-center gap-2 text-[12px] text-warm">
          <span className="size-1.5 rounded-full" style={{ background: entry.stroke }} aria-hidden />
          <span className="capitalize text-ash">{entry.name}</span>
          <span className="ml-auto tabular-nums">{formatNumber(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function UsageChart({ data, mode = "requests", height = 260, compact }: UsageChartProps) {
  const isPhone = useMediaQuery("(max-width: 639px)");
  const chartHeight = isPhone ? Math.min(height, 200) : height;
  const colors = palette[mode];
  const primaryKey = mode === "cost" ? "cost" : "requests";
  const secondaryKey = mode === "tokens" ? "tokens" : mode === "cost" ? "tokens" : "tokens";

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        {mode} over the selected period. {data.length} data points, totals{" "}
        {formatNumber(data.reduce((sum, point) => sum + point.requests, 0))} requests.
      </figcaption>
      <div style={{ height: chartHeight }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: compact ? 0 : 8, bottom: 0, left: compact ? -22 : -10 }}>
            <defs>
              <linearGradient id={`grad-primary-${mode}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.primary} stopOpacity={0.34} />
                <stop offset="100%" stopColor={colors.primary} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id={`grad-secondary-${mode}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.secondary} stopOpacity={0.18} />
                <stop offset="100%" stopColor={colors.secondary} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#85888B" strokeOpacity={0.14} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#85888B", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "#85888B", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={compact ? 44 : 56}
              tickFormatter={(value: number) => formatCompact(value)}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#85888B", strokeOpacity: 0.25 }} />
            {!compact ? (
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="circle"
                iconSize={7}
                formatter={(value: string) => (
                  <span style={{ color: "#85888B", fontSize: 11.5, textTransform: "capitalize" }}>{value}</span>
                )}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey={primaryKey}
              name={mode}
              stroke={colors.primary}
              strokeWidth={1.9}
              fill={`url(#grad-primary-${mode})`}
              activeDot={{ r: 3.5, strokeWidth: 0, fill: colors.primary }}
              dot={false}
            />
            {!compact ? (
              <Area
                type="monotone"
                dataKey={secondaryKey}
                name={mode === "tokens" ? "requests" : "tokens"}
                stroke={colors.secondary}
                strokeOpacity={0.7}
                strokeWidth={1.3}
                fill={`url(#grad-secondary-${mode})`}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: colors.secondary }}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
