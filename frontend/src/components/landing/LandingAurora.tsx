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

      {/* key light — a wide cone from above the fold. screen blend is what makes
          it read as light instead of a lighter rectangle of paint. */}
      <div
        className="landing-keylight absolute inset-x-0 top-0 h-[76%]"
        style={{
          background:
            "radial-gradient(58% 48% at 34% 0%, rgba(255,255,255,0.30), rgba(255,255,255,0.10) 40%, transparent 72%)",
          mixBlendMode: "screen",
          // keep the nav row out of the cone: labels must stay above 4.5:1
          maskImage:
            "linear-gradient(180deg, transparent 0px, transparent 84px, #000 140px)",
          WebkitMaskImage:
            "linear-gradient(180deg, transparent 0px, transparent 84px, #000 140px)",
        }}
      />

      {/* ambient light — neutral, slow, and bright enough to actually read as
          light rather than a grey smudge */}
      <div
        className="landing-ambient-a absolute left-[-14%] top-[-26%] h-[980px] w-[1180px] rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,255,255,0.26), rgba(255,255,255,0.10) 46%, transparent 74%)",
        }}
      />
      <div
        className="landing-ambient-b absolute right-[-16%] top-[20%] h-[820px] w-[940px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,255,255,0.18), rgba(255,255,255,0.06) 48%, transparent 76%)",
        }}
      />
      {/* top centre — a wide, low cone so the fold has a light source */}
      <div
        className="absolute left-[26%] top-[-30%] h-[620px] w-[900px] rounded-full blur-[150px]"
        style={{
          background: "radial-gradient(closest-side, rgba(255,255,255,0.14), transparent 76%)",
        }}
      />
      {/* low centre glow — lifts the fold instead of letting it fall to black */}
      <div
        className="absolute bottom-[-24%] left-[24%] h-[620px] w-[1040px] rounded-full blur-[140px]"
        style={{
          background: "radial-gradient(closest-side, rgba(255,255,255,0.06), transparent 78%)",
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
