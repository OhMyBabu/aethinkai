import { cn } from "@/lib/cn";

/** 44px hit area on phones (40px from sm up) wrapping a 44×24 track. */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("-m-2 grid size-11 shrink-0 place-items-center rounded-xl transition active:scale-95 hover:bg-warm/[0.05] sm:size-10 sm:rounded-lg", className)}
    >
      <span
        className={cn(
          "relative flex h-6 w-11 items-center rounded-full border transition-colors",
          checked ? "border-flame/60 bg-flame/80" : "border-ash/30 bg-ash/20",
        )}
      >
        <span
          className={cn(
            "absolute size-[18px] rounded-full bg-warm transition-all duration-200",
            checked ? "left-[24px]" : "left-[3px]",
          )}
          aria-hidden
        />
      </span>
    </button>
  );
}
