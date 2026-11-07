import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Reveal-on-scroll for landing sections using IntersectionObserver + GSAP.
 * Deliberately not ScrollTrigger: a plain observer cannot leave content stuck
 * at opacity 0 if the trigger maths misfires, and it stays cheap on a VM.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.reducedMotion === "true";
    if (reduce) return;

    const marked = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
    const targets = marked.length > 0 ? marked : [el];

    const ctx = gsap.context(() => {
      gsap.set(targets, { opacity: 0, y: 16 });

      const play = () => {
        gsap.to(targets, {
          opacity: 1,
          y: 0,
          duration: 0.55,
          ease: "power2.out",
          stagger: 0.07,
          overwrite: true,
        });
      };

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            play();
          }
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
      );
      observer.observe(el);

      // safety net: never leave the page blank if the observer never fires
      const fallback = window.setTimeout(play, 2600);
      return () => {
        observer.disconnect();
        window.clearTimeout(fallback);
      };
    }, el);

    return () => ctx.revert();
  }, []);

  return ref;
}
