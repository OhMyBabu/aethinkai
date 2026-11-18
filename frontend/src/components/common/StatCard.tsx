import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface StatCardProps {
  label: string;
  value: number;
  /** Percent change against the previous period. Omit when there is no honest baseline. */
  delta?: number;
  deltaLabel?: string;
  format?: (value: number) => string;
  hint?: string;
  /** Kept for call-site compatibility; the card is number-first and draws no icon. */
  icon?: LucideIcon;
  /** true when a rising value is bad news (errors, liabilities). */
  invertDelta?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  deltaLabel = "vs periode sebelumnya",
  format,
  hint,
  invertDelta,
  className,
}: StatCardProps) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = (delta ?? 0) >= 0;
  const good = invertDelta ? !up : up;

  return (
    <div className={cn("surface p-4 sm:p-5", className)}>
      <p className="text-[12.5px] text-ash">{label}</p>
      <p className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.025em] text-warm sm:text-[26px]">
        {format ? format(value) : value.toLocaleString("id-ID")}
      </p>
      {hasDelta || hint ? (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-5 text-ash">
          {hasDelta ? (
            <span className={cn("num font-medium", good ? "text-ok" : "text-bad")}>
              {up ? "+" : "−"}
              {Math.abs(delta as number).toFixed(1)}%
            </span>
          ) : null}
          {hasDelta ? <span>{deltaLabel}</span> : null}
          {!hasDelta && hint ? <span>{hint}</span> : null}
        </p>
      ) : null}
      {hasDelta && hint ? <p className="mt-1 text-[12px] leading-4 text-dim">{hint}</p> : null}
    </div>
  );
}
