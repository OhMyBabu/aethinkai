import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/hooks/useCountUp";

interface StatCardProps {
  label: string;
  value: number;
  delta?: number;
  deltaLabel?: string;
  format?: (value: number) => string;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  deltaLabel = "vs previous period",
  format,
  hint,
  icon: Icon,
  className,
}: StatCardProps) {
  const animated = useCountUp(value);
  const positive = (delta ?? 0) >= 0;
  const Arrow = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={cn("surface lift group relative overflow-hidden p-4 sm:p-5", className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-warm/14 to-transparent"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ash">{label}</p>
        {Icon ? (
          <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-warm/70 transition-transform duration-300 group-hover:-translate-y-0.5">
            <Icon size={15} aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-3 font-sans text-[24px] font-semibold leading-none tracking-[-0.03em] text-warm tabular-nums sm:text-[28px]">
        {format ? format(animated) : animated.toLocaleString("en-US")}
      </p>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        {typeof delta === "number" ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium",
              positive ? "bg-flame/12 text-flame" : "bg-burnt/20 text-[#d9a184]",
            )}
          >
            <Arrow size={12} aria-hidden />
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
        {typeof delta === "number" || hint ? <span className="text-ash">{deltaLabel}</span> : null}
      </div>
      {hint ? <p className="mt-2 text-[11px] leading-4 text-dim">{hint}</p> : null}
    </div>
  );
}
