import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
  padded?: boolean;
}

export function Card({ children, className, interactive, padded = true, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "surface surface-raised group relative overflow-hidden",
        padded && "p-5 sm:p-6",
        interactive && "lift cursor-pointer hover:border-ash/35 hover:bg-warm/[0.035]",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-warm/12 to-transparent"
      />
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-warm">{title}</h3>
        {description ? <p className="mt-1 text-[13px] leading-5 text-ash">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
