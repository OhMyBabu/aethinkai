/**
 * Dashboard atmosphere — same air as the landing page.
 *
 * base #0A0A0A · 40px hairline grid at white 4% · white radial ambient drifting
 * 18s · vignette. The amber belongs to actions and data, not the background.
 */
export function AppAmbient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0A0A0A]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0B0B0C_0%,#0A0A0A_46%,#080808_100%)]" />

      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), " +
            "linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 38%, transparent 78%)",
          WebkitMaskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 38%, transparent 78%)",
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(125%_100%_at_50%_-6%,transparent_38%,rgba(0,0,0,0.4)_84%,rgba(0,0,0,0.62)_100%)]" />

      <div className="aethink-landing-ambient absolute inset-0 opacity-70" />
    </div>
  );
}
