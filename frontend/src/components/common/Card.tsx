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
        "surface relative",
        padded && "p-4 sm:p-5",
        interactive && "lift cursor-pointer hover:border-white/20 hover:bg-panel-2",
        className,
      )}
      {...props}
    >
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
        <h3 className="text-[14px] font-semibold tracking-[-0.005em] text-warm">{title}</h3>
        {description ? <p className="mt-0.5 text-[12.5px] leading-5 text-ash">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
