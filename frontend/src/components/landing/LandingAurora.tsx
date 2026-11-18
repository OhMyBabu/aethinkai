/** Public-page backdrop: flat charcoal, the static wire grid, one soft top light. No motion. */
export function LandingAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-charcoal">
      <div className="fabric-grid absolute inset-0" />
      <div className="absolute inset-x-0 top-0 h-[420px]" />
    </div>
  );
}
