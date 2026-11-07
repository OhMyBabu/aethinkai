import { cn } from "@/lib/cn";

/**
 * AethinkAI brand mark — the supplied app icon (rounded black tile, white A,
 * orange orbit, sparkle), used exactly as delivered so no detail is lost in a
 * redraw. Same file backs the favicon/manifest icons.
 */
export function BrandLogo({
  size = 32,
  className,
  tile = true,
}: {
  size?: number;
  className?: string;
  /** false → smaller corner radius, for tight spots like the nexus hub */
  tile?: boolean;
}) {
  return (
    <img
      src="/brand/aethink-icon-256.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 select-none object-contain", !tile && "rounded-[22%]", className)}
      style={{ width: size, height: size, borderRadius: tile ? Math.round(size * 0.24) : undefined }}
    />
  );
}

export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandLogo size={compact ? 30 : 36} />
      <span className="leading-none">
        <span className="block text-[18px] font-semibold tracking-[-0.02em] text-warm">
          Aethink<span className="text-flame">AI</span>
        </span>
        {!compact ? (
          <span className="mt-1 block text-[10.5px] font-medium uppercase tracking-[0.26em] text-ash">
            Gateway
          </span>
        ) : null}
      </span>
    </span>
  );
}
