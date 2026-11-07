import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex items-center", className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-xl border border-ash/22 bg-[#141518] pl-3 pr-9 text-[13.5px] text-warm sm:h-10 sm:text-[13px] focus:border-flame/55 focus:outline-none focus:ring-2 focus:ring-flame/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 text-ash" aria-hidden />
    </label>
  );
}
