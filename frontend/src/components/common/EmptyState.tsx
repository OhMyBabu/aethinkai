import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon ? (
        <span className="mb-4 grid size-11 place-items-center rounded-xl border border-ash/20 bg-warm/[0.03] text-ash">
          <Icon size={18} aria-hidden />
        </span>
      ) : null}
      <h3 className="text-sm font-semibold text-warm">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-ash">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
