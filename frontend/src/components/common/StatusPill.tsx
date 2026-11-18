import { cn } from "@/lib/cn";

type Tone = "active" | "revoked" | "suspended" | "success" | "error" | "neutral" | "warning";

const tones: Record<Tone, string> = {
  active: "border-ok/25 bg-ok/10 text-ok",
  success: "border-ok/25 bg-ok/10 text-ok",
  revoked: "border-white/12 bg-white/[0.04] text-ash",
  neutral: "border-white/12 bg-white/[0.04] text-ash",
  suspended: "border-bad/25 bg-bad/10 text-bad",
  warning: "border-flame/30 bg-flame/10 text-flame",
  error: "border-bad/25 bg-bad/10 text-bad",
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
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[12px] font-medium",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden /> : null}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </span>
  );
}
