import { formatCompact } from "@/lib/format";

export function ModelBars({
  data,
  className,
}: {
  data: Array<{ label: string; value: number }>;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <ul className={className}>
      {data.map((item) => (
        <li key={item.label} className="group py-2">
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="text-warm/85">{item.label}</span>
            <span className="tabular-nums text-ash">{formatCompact(item.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ash/12">
            <div
              className="h-full rounded-full bg-gradient-to-r from-burnt to-flame transition-[width] duration-500"
              style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
