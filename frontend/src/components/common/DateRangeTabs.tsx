import { cn } from "@/lib/cn";
import type { Range } from "@/types";

export function DateRangeTabs({
  value,
  onChange,
  className,
}: {
  value: Range;
  onChange: (range: Range) => void;
  className?: string;
}) {
  const ranges: Range[] = [7, 30, 90];
  return (
    <div
      role="tablist"
      aria-label="Rentang waktu"
      className={cn("inline-flex items-center gap-1 rounded-lg border border-white/10 bg-panel p-0.5", className)}
    >
      {ranges.map((range) => {
        const active = value === range;
        return (
          <button
            key={range}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(range)}
            className={cn(
              "h-11 rounded-md px-3.5 text-[13px] font-medium transition sm:h-9 sm:px-3 sm:text-[12px]",
              active
                ? "bg-white/10 text-warm"
                : "text-ash hover:text-warm",
            )}
          >
            {range} hari
          </button>
        );
      })}
    </div>
  );
}
