/**
 * Landing atmosphere, layered white ambient light, 9Remote technique.
 *
 * base #0A0A0A · 40px hairline grid at white 4% · three white radial gradients
 * (11% / 8% / 4%) drifting 18s · no hue of its own. The amber in this product
 * belongs to the CTA and the routing diagram; the air stays neutral.
 */
export function LandingAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0A0A0A]">
      {/* base wash, flat charcoal, no hue */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0B0B0C_0%,#0A0A0A_48%,#080808_100%)]" />

      {/* technical grid, 40px, white 4%, fades with the page */}
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

      {/* vignette, pure black edge, nothing more */}
      <div className="absolute inset-0 bg-[radial-gradient(125%_100%_at_50%_-6%,transparent_38%,rgba(0,0,0,0.4)_84%,rgba(0,0,0,0.62)_100%)]" />

      {/*
        Ambient light, painted after the grid and the vignette so neither eats it.
        Three gradients, transform/opacity only, 18s, frozen by reduced-motion.
      */}
      <div className="aethink-landing-ambient absolute inset-0" />
    </div>
  );
}
