import { cn } from "@/lib/cn";

type Tone = "active" | "revoked" | "suspended" | "success" | "error" | "neutral" | "warning";

const tones: Record<Tone, string> = {
  active: "border-flame/30 bg-flame/10 text-flame",
  success: "border-flame/30 bg-flame/10 text-flame",
  revoked: "border-ash/25 bg-ash/10 text-ash",
  neutral: "border-ash/25 bg-ash/10 text-ash",
  suspended: "border-burnt/40 bg-burnt/15 text-[#dfa183]",
  warning: "border-burnt/40 bg-burnt/15 text-[#dfa183]",
  error: "border-burnt/40 bg-burnt/15 text-[#dfa183]",
};

export function StatusPill({
  tone = "neutral",
  children,
  className,
  dot = true,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[11px] font-medium capitalize",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden /> : null}
      {children}
    </span>
  );
}
