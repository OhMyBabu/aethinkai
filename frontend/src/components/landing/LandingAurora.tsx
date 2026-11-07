/**
 * Landing atmosphere — 9Remote's restraint, AethinkAI's palette.
 *
 * base #0A0A0A · 40px hairline grid at white 4% · two very low neutral blooms
 * (5% / 3.5%) drifting 22s / 26s · one 6% accent whisper behind the diagram.
 * No cone, no spotlight: on 9Remote the page is black first and lit second, so
 * the light should be felt, not seen. Nothing here ever sits on the nav row.
 */
export function LandingAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0A0A0A]">
      {/* base wash — flat charcoal, no hue */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0B0B0C_0%,#0A0A0A_48%,#080808_100%)]" />

      {/* technical grid — 40px, white 4%, fades with the page */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), " +
            "linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.62) 42%, transparent 84%)",
          WebkitMaskImage:
            "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.62) 42%, transparent 84%)",
        }}
      />

      {/* ambient — barely there, the way 9Remote keeps it */}
      <div
        className="landing-ambient-a absolute left-[-18%] top-[-30%] h-[900px] w-[1080px] rounded-full blur-[150px]"
        style={{
          background: "radial-gradient(closest-side, rgba(255,255,255,0.05), transparent 76%)",
        }}
      />
      <div
        className="landing-ambient-b absolute right-[-20%] top-[18%] h-[760px] w-[880px] rounded-full blur-[160px]"
        style={{
          background: "radial-gradient(closest-side, rgba(255,255,255,0.035), transparent 78%)",
        }}
      />

      {/* a whisper of accent behind the routing diagram */}
      <div
        className="absolute right-[2%] top-[4%] h-[560px] w-[600px] rounded-full opacity-60 blur-[160px]"
        style={{
          background: "radial-gradient(closest-side, rgba(231,137,60,0.06), transparent 78%)",
        }}
      />

      {/* film grain, very quiet */}
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px",
        }}
      />

      {/* vignette — pure black edge, nothing more */}
      <div className="absolute inset-0 bg-[radial-gradient(125%_100%_at_50%_-6%,transparent_38%,rgba(0,0,0,0.4)_84%,rgba(0,0,0,0.62)_100%)]" />
    </div>
  );
}
