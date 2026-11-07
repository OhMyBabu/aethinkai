import { cn } from "@/lib/cn";

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} aria-hidden />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <LoadingSkeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="surface p-5">
          <LoadingSkeleton className="h-3 w-24" />
          <LoadingSkeleton className="mt-4 h-7 w-32" />
          <LoadingSkeleton className="mt-3 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
