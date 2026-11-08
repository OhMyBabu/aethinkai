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
      aria-label="Date range"
      className={cn("inline-flex items-center gap-1 rounded-xl border border-ash/20 bg-[#141518] p-1", className)}
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
              "h-11 rounded-lg px-3.5 text-[13px] font-medium transition active:scale-[0.98] sm:h-9 sm:px-3 sm:text-[12px]",
              active
                ? "bg-flame/14 text-flame shadow-[inset_0_0_0_1px_rgba(231,137,60,0.28)]"
                : "text-ash hover:bg-warm/[0.06] hover:text-warm",
            )}
          >
            {range} days
          </button>
        );
      })}
    </div>
  );
}
