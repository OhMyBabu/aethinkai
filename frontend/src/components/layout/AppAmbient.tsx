/** Dashboard backdrop: flat charcoal with the static wire grid fading out from the top. */
export function AppAmbient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-charcoal">
      <div className="fabric-grid absolute inset-0 opacity-70" />
    </div>
  );
}
