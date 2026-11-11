import { useEffect, useRef, useState } from "react";

function prefersReduced(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.dataset.motion === "reduced") return true;
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Tween a number for KPI cards.
 *
 * Two guarantees matter more than the animation itself:
 *   1. the final value is ALWAYS rendered, a backgrounded tab, a headless run or
 *      a cancelled frame must never leave the card frozen on its first frame
 *      (the "KPI stuck at 0 while its hint already shows the real number" bug);
 *   2. a value that arrives after mount (async fetch) animates from the previous
 *      value instead of restarting at 0.
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target);
  const started = useRef(false);
  const previous = useRef(target);

  useEffect(() => {
    const first = !started.current;
    started.current = true;

    const from = first ? 0 : previous.current;
    previous.current = target;

    // Hidden tab / reduced motion / no rAF: snap, never animate.
    if (
      prefersReduced() ||
      (typeof document !== "undefined" && document.hidden) ||
      typeof requestAnimationFrame !== "function"
    ) {
      setValue(target);
      return;
    }

    if (from === target) {
      setValue(target);
      return;
    }

    const span = first ? duration : 420;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / span);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Safety net: if frames stop (tab backgrounded mid-tween) the number still
    // lands on the truth instead of freezing halfway.
    const settle = window.setTimeout(() => setValue(target), span + 150);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [target, duration]);

  return value;
}
