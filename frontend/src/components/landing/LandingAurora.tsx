/**
 * Landing aurora — atmospheric light behind the marketing page.
 *
 * No grids, no boxes: two warm blooms, one cool lift, a diagonal light sweep,
 * film grain and a vignette. The blooms drift on a 34s / 46s loop with
 * transform-only keyframes (compositor work, no layout, no repaint). The
 * prefers-reduced-motion media query in globals.css freezes them.
 */
export function LandingAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#15161A]">
      {/* base wash */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#1C1D22_0%,#18191D_44%,#15161A_100%)]" />

      {/* warm bloom — left of the headline */}
      <div
        className="aurora-a absolute left-[-14%] top-[-24%] h-[880px] w-[1080px] rounded-full opacity-90 blur-[120px]"
        style={{
          background:
            "radial-gradient(closest-side, rgba(231,137,60,0.17), rgba(156,84,47,0.075) 55%, transparent 78%)",
        }}
      />

      {/* burnt bloom — behind the nexus */}
      <div
        className="aurora-b absolute right-[-16%] top-[22%] h-[720px] w-[820px] rounded-full opacity-80 blur-[130px]"
        style={{
          background: "radial-gradient(closest-side, rgba(156,84,47,0.15), transparent 74%)",
        }}
      />

      {/* cool lift — bottom, keeps the page from ending in a black hole */}
      <div
        className="absolute bottom-[-32%] left-[18%] h-[560px] w-[980px] rounded-full opacity-70 blur-[140px]"
        style={{
          background: "radial-gradient(closest-side, rgba(133,136,139,0.09), transparent 76%)",
        }}
      />

      {/* diagonal light sweep */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(112deg, transparent 26%, rgba(231,137,60,0.055) 46%, rgba(250,248,244,0.02) 52%, transparent 68%)",
        }}
      />

      {/* film grain */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px",
        }}
      />

      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(125%_100%_at_50%_-6%,transparent_36%,rgba(9,10,12,0.36)_82%,rgba(8,9,11,0.5)_100%)]" />
    </div>
  );
}
