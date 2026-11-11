import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ModelMark } from "@/components/brand/ModelMark";
import type { Provider } from "@/types";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { useStore } from "@/data/store";
import { cn } from "@/lib/cn";

/**
 * Signal Nexus, routing diagram for the hero.
 *
 * Composition: app plate (left) → core module (centre) → four provider cards
 * (right), joined by a fan of hairline curves. The whole scene sits on a
 * perspective plane and tilts toward the pointer (spring-damped), which is what
 * gives it depth without turning the hub into a gimmick.
 *
 * Animation: GSAP DrawSVG for the lane draw-in, MotionPath for the packets,
 * CSS dash-flow for ambient motion, Motion springs for the tilt.
 */

gsap.registerPlugin(MotionPathPlugin, DrawSVGPlugin);

const VB = { w: 600, h: 430 };
const CORE = { x: 244, y: 209, w: 152, h: 106 };
const CARD_X = 392;
const LANE_START_X = CORE.x + CORE.w / 2 - 6;

const nodes = [
  { id: "deepseek", provider: "DeepSeek" as Provider, name: "DeepSeek", note: "High-performance reasoning", model: "V4.1 Flash", y: 92, angle: -34 },
  { id: "glm", provider: "GLM" as Provider, name: "GLM", note: "Strong general capability", model: "GLM-5.3", y: 170, angle: -12 },
  { id: "kimi", provider: "Kimi" as Provider, name: "Kimi", note: "Long-context, tool use", model: "Kimi K3", y: 248, angle: 12 },
  { id: "claude", provider: "Anthropic" as Provider, name: "Claude", note: "Frontier reasoning", model: "Fable 5", y: 326, angle: 34 },
];

function lanePath(angleDeg: number, endY: number, offset = 0) {
  const rad = (angleDeg * Math.PI) / 180;
  const sx = LANE_START_X;
  const sy = CORE.y + Math.sin(rad) * (CORE.h / 2 - 4) + offset;
  return `M${sx} ${sy.toFixed(1)} C${(sx + 40).toFixed(1)} ${sy.toFixed(1)}, ${(CARD_X - 62).toFixed(1)} ${(endY + offset).toFixed(1)}, ${CARD_X} ${(endY + offset).toFixed(1)}`;
}

export function SignalNexus({ className, routes }: { className?: string; routes?: number }) {
  const { state } = useStore();
  const reducePref = state.prefs.reducedMotion;
  const systemReduce = useReducedMotion();
  const reduce = reducePref || Boolean(systemReduce);

  const scope = useRef<HTMLDivElement>(null);
  const laneRefs = useRef<Array<SVGPathElement | null>>([]);
  const packets = useRef<Array<SVGCircleElement | null>>([]);
  const feedPacket = useRef<SVGCircleElement | null>(null);
  const appFeed = useRef<SVGPathElement | null>(null);
  const coreBloom = useRef<SVGRectElement>(null);
  const coreEnergy = useRef<SVGRectElement>(null);
  const coreEdge = useRef<SVGRectElement>(null);

  /* ---- pointer tilt ------------------------------------------------- */
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 120, damping: 18, mass: 0.6 };
  const rotateY = useSpring(useTransform(px, [0, 1], [-7, 7]), spring);
  const rotateX = useSpring(useTransform(py, [0, 1], [5, -5]), spring);

  const bundles = useMemo(
    () =>
      nodes.map((node) => ({
        node,
        paths: [lanePath(node.angle, node.y, -5), lanePath(node.angle, node.y, 0), lanePath(node.angle, node.y, 5)],
      })),
    [],
  );

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const paths = gsap.utils.toArray<SVGPathElement>(".nexus-route");
      if (reduce) {
        gsap.set(paths, { drawSVG: "0% 100%", opacity: 1 });
        gsap.set(".nexus-packet", { opacity: 0 });
        if (coreBloom.current) gsap.set(coreBloom.current, { opacity: 0.6 });
        if (coreEdge.current) gsap.set(coreEdge.current, { opacity: 0.22 });
        return;
      }

      gsap.fromTo(
        ".nexus-plate",
        { opacity: 0, y: 10, scale: 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "power2.out", stagger: 0.07 },
      );

      gsap.set(paths, { drawSVG: "0% 0%" });
      gsap.to(paths, { drawSVG: "0% 100%", duration: 1.05, ease: "power2.out", stagger: 0.045, delay: 0.15 });

      if (appFeed.current) {
        gsap.fromTo(appFeed.current, { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 0.6, ease: "power2.out" });
      }

      // ambient hairline flow on the outer lanes (starts once the draw-in lands)
      gsap.delayedCall(1.25, () => {
        const ambient = gsap.utils.toArray<SVGPathElement>(".nexus-ambient");
        gsap.set(ambient, { strokeDasharray: "5 15", strokeDashoffset: 0 });
        gsap.to(ambient, { strokeDashoffset: -220, duration: 7.5, repeat: -1, ease: "none" });
      });

      packets.current.forEach((dot, index) => {
        if (!dot) return;
        const lane = laneRefs.current[Math.floor(index / 2)];
        if (!lane) return;
        const duration = 7.5 + (index % 3) * 1.6;
        gsap.set(dot, { opacity: 0 });
        const tween = gsap.to(dot, {
          motionPath: { path: lane, align: lane, alignOrigin: [0.5, 0.5] },
          duration,
          repeat: -1,
          ease: "none",
          delay: 0.9 + (index % 4) * (duration / 4),
          repeatDelay: 0.35,
        });
        tween.eventCallback("onUpdate", () => {
          const progress = tween.progress();
          const fade = Math.min(1, Math.min(progress, 1 - progress) / 0.12);
          gsap.set(dot, { opacity: Math.max(0, fade) * 0.9 });
        });
      });

      if (feedPacket.current && appFeed.current) {
        gsap.set(feedPacket.current, { opacity: 0.85 });
        gsap.to(feedPacket.current, {
          motionPath: { path: appFeed.current, align: appFeed.current, alignOrigin: [0.5, 0.5] },
          duration: 3.4,
          repeat: -1,
          repeatDelay: 0.5,
          ease: "none",
        });
      }

      // concentrated energy inside the core plate: tight rectangular bloom,
      // breathing inner light, and a single highlight travelling the border
      if (coreBloom.current) {
        gsap.fromTo(
          coreBloom.current,
          { opacity: 0.45 },
          { opacity: 0.85, duration: 3.6, repeat: -1, yoyo: true, ease: "sine.inOut" },
        );
      }

      if (coreEnergy.current) {
        gsap.fromTo(
          coreEnergy.current,
          { opacity: 0.55 },
          { opacity: 1, duration: 2.9, repeat: -1, yoyo: true, ease: "sine.inOut" },
        );
      }

      if (coreEdge.current) {
        const length = coreEdge.current.getTotalLength();
        gsap.set(coreEdge.current, { strokeDasharray: `${length * 0.22} ${length}`, strokeDashoffset: length * 0.35 });
        gsap.to(coreEdge.current, {
          strokeDashoffset: -length * 1.1,
          duration: 5.5,
          repeat: -1,
          ease: "none",
        });
      }
    }, scope);

    return () => ctx.revert();
  }, [reduce, bundles]);

  const activeModels = useMemo(() => state.models.filter((model) => model.enabled).length, [state.models]);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
  };

  const handleLeave = () => {
    px.set(0.5);
    py.set(0.5);
  };

  const Card = ({ node, index }: { node: (typeof nodes)[number]; index: number }) => (
    <div
      data-testid={`nexus-node-${node.id}`}
      className="nexus-plate group relative"
      style={{ transitionDelay: `${index * 20}ms` }}
    >
      <div className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-[#FAF8F4]/[0.07] min-[900px]:min-h-0 min-[900px]:gap-2 min-[900px]:rounded-xl xl:gap-2.5 bg-[linear-gradient(180deg,#222327_0%,#1B1C20_60%,#17181B_100%)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(250,248,244,0.07),0_1px_2px_rgba(0,0,0,0.5)] min-[900px]:px-2 min-[900px]:py-1.5 xl:px-2.5 xl:py-2 backdrop-blur transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-[#E7893C]/35 group-hover:shadow-[inset_0_1px_0_rgba(250,248,244,0.09),0_10px_24px_-16px_rgba(231,137,60,0.55)]">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl min-[900px]:size-6 min-[900px]:rounded-lg xl:size-7 border border-[#FAF8F4]/[0.08] bg-[#FAF8F4]/[0.035] text-warm/80 transition-colors duration-300 group-hover:text-flame">
          <ModelMark provider={node.provider} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-warm min-[900px]:text-[10.5px] xl:text-[11.5px]">{node.name}</span>
            <span className="flex items-center gap-1 text-[9px] text-ash/90">
              <span className="relative flex size-1">
                <span className="absolute inline-flex size-1 animate-ping rounded-full bg-flame/70" />
                <span className="relative inline-flex size-1 rounded-full bg-flame" />
              </span>
              <span className="hidden xl:inline">Online</span>
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-ash min-[900px]:text-[9.5px] xl:text-[10px]">
            <span className="xl:hidden">{node.model}</span>
            <span className="hidden xl:inline">{node.note}</span>
          </span>
        </span>
      </div>
    </div>
  );

  return (
    <div ref={scope} className={cn("relative w-full select-none", className)}>
      {/* ---------------- desktop / tablet ---------------- */}
      <div
        className="relative mx-auto hidden aspect-[600/430] w-full max-w-[620px] min-[900px]:block"
        style={{ perspective: "1300px" }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <motion.div
          className="absolute inset-0"
          style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        >
          {/* ambient core glow */}

          <svg viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <linearGradient id="lane-fade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#E7893C" stopOpacity="0.62" />
                <stop offset="52%" stopColor="#9C542F" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#85888B" stopOpacity="0.16" />
              </linearGradient>
              <linearGradient id="lane-feed" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#85888B" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#E7893C" stopOpacity="0.5" />
              </linearGradient>
              <radialGradient id="core-energy" cx="50%" cy="34%" r="68%">
                <stop offset="0%" stopColor="#E7893C" stopOpacity="0.22" />
                <stop offset="42%" stopColor="#9C542F" stopOpacity="0.11" />
                <stop offset="100%" stopColor="#9C542F" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="core-edge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#E7893C" stopOpacity="0" />
                <stop offset="50%" stopColor="#E7893C" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#E7893C" stopOpacity="0" />
              </linearGradient>
              <filter id="core-bloom" x="-70%" y="-70%" width="240%" height="240%">
                <feGaussianBlur stdDeviation="15" />
              </filter>
              <linearGradient id="core-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#26272C" />
                <stop offset="58%" stopColor="#1B1C20" />
                <stop offset="100%" stopColor="#141518" />
              </linearGradient>
            </defs>

            {/* app → core feed */}
            {[-4, 0, 4].map((offset, index) => (
              <path
                key={`feed-${offset}`}
                ref={index === 1 ? appFeed : undefined}
                d={`M104 ${CORE.y + offset} C 124 ${CORE.y + offset}, 146 ${CORE.y + offset}, ${CORE.x - CORE.w / 2} ${CORE.y + offset}`}
                fill="none"
                stroke={index === 1 ? "#E7893C" : "url(#lane-feed)"}
                strokeOpacity={index === 1 ? 0.8 : 0.5}
                strokeWidth={index === 1 ? 1.45 : 1}
                strokeLinecap="round"
              />
            ))}
            <circle cx={CORE.x - CORE.w / 2} cy={CORE.y} r="2.4" fill="#E7893C" fillOpacity="0.85" />
            <circle cx={CORE.x - CORE.w / 2} cy={CORE.y} r="5.5" fill="none" stroke="#E7893C" strokeOpacity="0.22" />

            {/* lanes */}
            {bundles.map(({ node, paths }) => (
              <g key={node.id}>
                {paths.map((d, index) => (
                  <path
                    key={index}
                    className={cn("nexus-route", index !== 1 && "nexus-ambient")}
                    ref={(el) => {
                      if (index === 1) laneRefs.current[bundles.findIndex((item) => item.node.id === node.id)] = el;
                    }}
                    d={d}
                    fill="none"
                    stroke="url(#lane-fade)"
                    strokeWidth={index === 1 ? 1.3 : 0.9}
                    strokeOpacity={index === 1 ? 0.95 : 0.55}
                    strokeLinecap="round"
                  />
                ))}
              </g>
            ))}

            {/* core plate: stacked rounded rectangles for depth */}
            <g>
              <rect
                x={CORE.x - CORE.w / 2 - 11}
                y={CORE.y - CORE.h / 2 - 11}
                width={CORE.w + 22}
                height={CORE.h + 22}
                rx="27"
                fill="none"
                stroke="#FAF8F4"
                strokeOpacity="0.045"
              />
              <rect
                x={CORE.x - CORE.w / 2 - 5}
                y={CORE.y - CORE.h / 2 - 5}
                width={CORE.w + 10}
                height={CORE.h + 10}
                rx="24"
                fill="none"
                stroke="#E7893C"
                strokeOpacity="0.14"
              />
              <rect
                ref={coreBloom}
                x={CORE.x - CORE.w / 2}
                y={CORE.y - CORE.h / 2}
                width={CORE.w}
                height={CORE.h}
                rx="20"
                fill="#E7893C"
                fillOpacity="0.34"
                filter="url(#core-bloom)"
              />
              <rect
                x={CORE.x - CORE.w / 2}
                y={CORE.y - CORE.h / 2}
                width={CORE.w}
                height={CORE.h}
                rx="20"
                fill="url(#core-body)"
                stroke="#FAF8F4"
                strokeOpacity="0.12"
              />
              <rect
                ref={coreEnergy}
                className="nexus-core-energy"
                x={CORE.x - CORE.w / 2}
                y={CORE.y - CORE.h / 2}
                width={CORE.w}
                height={CORE.h}
                rx="20"
                fill="url(#core-energy)"
              />
              <rect
                ref={coreEdge}
                x={CORE.x - CORE.w / 2}
                y={CORE.y - CORE.h / 2}
                width={CORE.w}
                height={CORE.h}
                rx="20"
                fill="none"
                stroke="url(#core-edge)"
                strokeWidth="1"
                strokeOpacity="0.9"
              />
            </g>

            <circle
              className="nexus-packet nexus-packet-feed"
              r="2.2"
              fill="#FAF8F4"
              fillOpacity="0.9"
              ref={(el) => {
                feedPacket.current = el;
              }}
            />

            {bundles.map(({ node }, bundleIndex) =>
              [0, 1].map((slot) => (
                <circle
                  key={`${node.id}-${slot}`}
                  className="nexus-packet"
                  r={slot === 0 ? 2.4 : 1.6}
                  fill={slot === 0 ? "#E7893C" : "#FAF8F4"}
                  fillOpacity={slot === 0 ? 0.92 : 0.5}
                  ref={(el) => {
                    packets.current[bundleIndex * 2 + slot] = el;
                  }}
                />
              )),
            )}
          </svg>

          {/* core label plate */}
          <div
            data-testid="nexus-hub"
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center"
            style={{
              left: `${(CORE.x / VB.w) * 100}%`,
              top: `${(CORE.y / VB.h) * 100}%`,
              width: `${(CORE.w / VB.w) * 100}%`,
              height: `${(CORE.h / VB.h) * 100}%`,
            }}
          >
            <BrandLogo size={30} />
            <p className="mt-1.5 text-[11.5px] font-semibold tracking-[0.01em] text-warm">AethinkAI</p>
            <p className="mt-0.5 text-[7.5px] uppercase tracking-[0.26em] text-ash">OpenAI-compatible</p>
            <p className="mt-1.5 flex items-center gap-1 rounded-full border border-[#E7893C]/25 bg-[#E7893C]/[0.09] px-1.5 py-0.5 text-[7.5px] font-medium text-flame">
              <span className="size-1 rounded-full bg-flame" aria-hidden />
              {routes ?? activeModels} routes live
            </p>
          </div>

          {/* app plate */}
          <div
            className="nexus-plate absolute z-10 -translate-y-1/2"
            style={{ left: 0, top: `${(CORE.y / VB.h) * 100}%` }}
          >
            <div className="rounded-lg border border-[#FAF8F4]/[0.09] bg-[linear-gradient(180deg,#1F2024,#17181B)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(250,248,244,0.06),0_1px_2px_rgba(0,0,0,0.5)]">
              <p className="flex items-center gap-1.5 whitespace-nowrap text-[9.5px] font-semibold text-warm">
                <span className="size-1.5 rounded-full bg-flame" aria-hidden />
                Your App / Service
              </p>
              <p className="mt-0.5 whitespace-nowrap text-[8px] text-ash">one endpoint</p>
            </div>
          </div>

          {/* provider cards */}
          {nodes.map((node, index) => (
            <div
              key={node.id}
              className="absolute z-10 -translate-y-1/2"
              style={{
                left: `${(CARD_X / VB.w) * 100}%`,
                top: `${(node.y / VB.h) * 100}%`,
                width: "33.6%",
              }}
            >
              <Card node={node} index={index} />
            </div>
          ))}
        </motion.div>
      </div>

      {/* Mobile keeps the same topology as a compact stack: core plate, then the
          four routes on one rail. No scaled-down SVG, no missing context. */}
      <div className="min-[900px]:hidden">
        <div className="rounded-2xl border border-[#FAF8F4]/[0.08] bg-[linear-gradient(180deg,#1F2024,#17181B)] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(250,248,244,0.06)]">
          <div className="flex items-center gap-2.5">
            <BrandLogo size={26} />
            <div>
              <p className="text-[14px] font-semibold text-warm">AethinkAI</p>
              <p className="text-[10px] uppercase tracking-[0.22em] text-ash">OpenAI-compatible</p>
            </div>
            <span className="ml-auto rounded-full border border-[#E7893C]/25 bg-[#E7893C]/[0.09] px-2.5 py-1 text-[11px] font-medium text-flame">
              {routes ?? activeModels} routes live
            </span>
          </div>
        </div>

        <div className="relative mt-4 space-y-2.5 pl-5">
          <span aria-hidden className="absolute left-2 top-3 bottom-3 w-px bg-gradient-to-b from-[#E7893C]/50 via-[#9C542F]/30 to-transparent" />
          {nodes.map((node, index) => (
            <div key={node.id} className="relative">
              <span aria-hidden className="absolute -left-[15px] top-1/2 size-2 -translate-y-1/2 rounded-full bg-flame/80" />
              <Card node={node} index={index} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}