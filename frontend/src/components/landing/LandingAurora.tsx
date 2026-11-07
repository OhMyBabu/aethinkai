/**
 * Landing atmosphere — 9Remote's background palette, AethinkAI's identity.
 *
 * base #0A0A0A · 40px hairline grid at white 4% · neutral ambient light
 * drifting 22s / 26s. No warm wash behind the page: the accent belongs to the
 * CTA, the diagram and the type, not to the air around them.
 */
export function LandingAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0A0A0A]">
      {/* base wash — flat charcoal, no hue */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0C0C0D_0%,#0A0A0A_46%,#080808_100%)]" />

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

      {/* ambient light — neutral, slow, only enough for depth */}
      <div
        className="landing-ambient-a absolute left-[-16%] top-[-28%] h-[900px] w-[1100px] rounded-full blur-[130px]"
        style={{
          background: "radial-gradient(closest-side, rgba(255,255,255,0.055), transparent 72%)",
        }}
      />
      <div
        className="landing-ambient-b absolute right-[-18%] top-[24%] h-[760px] w-[880px] rounded-full blur-[150px]"
        style={{
          background: "radial-gradient(closest-side, rgba(255,255,255,0.035), transparent 74%)",
        }}
      />

      {/* a whisper of accent behind the routing diagram — 7%, not a wash */}
      <div
        className="absolute right-[4%] top-[6%] h-[520px] w-[560px] rounded-full opacity-70 blur-[150px]"
        style={{
          background: "radial-gradient(closest-side, rgba(231,137,60,0.07), transparent 76%)",
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
