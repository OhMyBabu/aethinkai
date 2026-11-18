import { formatCompact } from "@/lib/format";

export function ModelBars({
  data,
  className,
}: {
  data: Array<{ label: string; value: number }>;
  className?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...data.map((item) => item.value));
  if (total === 0) return <p className="mt-3 text-[13px] text-ash">Belum ada request di periode ini.</p>;
  return (
    <ul className={className}>
      {data.map((item) => (
        <li key={item.label} className="py-2">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 text-warm/90">{item.label}</span>
            <span className="num shrink-0 text-ash">
              {formatCompact(item.value)} <span className="text-dim">· {Math.round((item.value / total) * 100)}%</span>
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-flame/80" style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
