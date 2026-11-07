import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[200px] -translate-x-1/2 rounded-lg border border-ash/25 bg-[#111214] px-2.5 py-1.5 text-[11px] leading-4 text-warm/90 shadow-lg",
          )}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
