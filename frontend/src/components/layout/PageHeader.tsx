import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function Breadcrumb({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="-mb-2 flex items-center gap-1.5 text-[12px] text-ash sm:mb-0 sm:text-[11.5px]">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? <ChevronRight size={11} className="text-ash/60" aria-hidden /> : null}
          {item.to ? (
            <Link to={item.to} className="-my-2 inline-flex h-11 items-center transition active:opacity-70 hover:text-warm sm:h-auto">
              {item.label}
            </Link>
          ) : (
            <span className="text-warm/80">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: Array<{ label: string; to?: string }>;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 space-y-3", className)}>
      {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="h-[3px] w-7 rounded-full bg-gradient-to-r from-burnt to-flame" />
            <span className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ash">
              {breadcrumb?.length ? breadcrumb[0].label : "Workspace"}
            </span>
          </div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.025em] text-warm sm:text-[27px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-6 text-ash sm:text-[13px]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
