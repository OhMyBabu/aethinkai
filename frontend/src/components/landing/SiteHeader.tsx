import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BansosPanel } from "./BansosPanel";
import { useLandingData } from "@/lib/landing-data";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Gift,
  Boxes,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  Layers,
  Menu,
  ShieldCheck,
  Tag,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { Wordmark } from "@/components/layout/BrandLogo";
import { Button } from "@/components/common/Button";
import { cn } from "@/lib/cn";
import { useStore } from "@/data/store";
import type { Role } from "@/types";

/* ------------------------------------------------------------------ */
/*  Nav primitives                                                     */
/* ------------------------------------------------------------------ */

const spring = { type: "spring", stiffness: 420, damping: 26, mass: 0.7 } as const;

/** Flat premium nav item — no boxes, no bevels, no 3D tilt. */
function NavItem({
  label,
  icon,
  href,
  active,
  onClick,
  hasPanel,
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  hasPanel?: boolean;
}) {
  const classes = cn(
    "group relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-[13px] font-medium tracking-[-0.01em] transition-[background-color,color] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7893C]/40",
    active
      ? "bg-[#292B2E] text-[#FAF8F4]"
      : "text-[#85888B] hover:bg-[#292B2E]/70 hover:text-[#FAF8F4]",
  );

  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex transition-colors duration-200",
          active ? "text-[#E7893C]" : "text-[#85888B] group-hover:text-[#FAF8F4]",
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
      {hasPanel ? (
        <ChevronDown
          size={12}
          aria-hidden
          strokeWidth={2}
          className={cn(
            "transition-transform duration-200",
            active ? "rotate-180 text-[#E7893C]" : "text-[#85888B] group-hover:text-[#FAF8F4]",
          )}
        />
      ) : null}
      {active ? (
        <span
          aria-hidden
          className="absolute inset-x-2.5 -bottom-px h-px bg-[linear-gradient(90deg,transparent,rgba(231,137,60,0.55),transparent)]"
        />
      ) : null}
    </>
  );

  return href ? (
    <a href={href} className={classes}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} aria-expanded={active} aria-haspopup="true" className={classes}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Docs mega panel                                                    */
/* ------------------------------------------------------------------ */

/** Real gateway host: env override, otherwise whatever origin is serving this page. */
const BASE = (import.meta.env.VITE_GATEWAY_BASE_URL ?? `${window.location.origin}/v1`).replace(/\/$/, "");

const snippets: Record<string, string> = {
  cURL: `curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer sk-•••" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4.1-flash",
    "messages": [{ "role": "user", "content": "Summarise this invoice" }]
  }'`,
  Python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="sk-•••",
)

r = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "Summarise this invoice"}],
)`,
  Node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: process.env.AETHINK_KEY,
});

const r = await client.chat.completions.create({
  model: "deepseek-v4.1-flash",
  messages: [{ role: "user", content: "Summarise this invoice" }],
});`,
};

const endpoints = [
  { method: "POST", path: "/v1/chat/completions", note: "chat · stream" },
  { method: "GET", path: "/v1/models", note: "catalogue" },
  { method: "GET", path: "/api/models", note: "pricing" },
  { method: "GET", path: "/health", note: "health" },
];

const panelMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
};

/** Shared floating popover shell: graphite card, 1px border, soft shadow, 12px radius. */
const FLOATING =
  "absolute left-1/2 top-[54px] z-50 mt-2 -translate-x-1/2 rounded-xl border bg-[#222325] shadow-[0_20px_48px_-20px_rgba(0,0,0,0.85)]";

const FLOATING_STYLE = { borderColor: "#3A3B3D" } as const;

const listMotion = {
  initial: "hidden",
  animate: "show",
  variants: {
    hidden: {},
    show: { transition: { staggerChildren: 0.045, delayChildren: 0.06 } },
  },
};

const itemMotion = {
  variants: {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 28 } as const },
  },
};

function DocsPanel({ onClose }: { onClose: () => void }) {
  const [lang, setLang] = useState<keyof typeof snippets>("cURL");
  const [copied, setCopied] = useState(false);

  return (
    <motion.div
      {...panelMotion}
      role="region"
      aria-label="Documentation"
      style={FLOATING_STYLE}
      className={cn(FLOATING, "max-h-[calc(100vh-4.5rem)] w-[min(860px,calc(100vw-32px))] overflow-y-auto")}
    >
      <div className="grid w-full min-w-0 gap-7 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-flame">
              <BookOpen size={12} aria-hidden /> Documentation
            </p>
            <Link
              to="/panduan"
              onClick={onClose}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-flame/35 px-2.5 text-[11.5px] text-flame transition hover:bg-flame/10"
            >
              Panduan lengkap <ArrowUpRight size={11} />
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close documentation"
              className="grid size-8 place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm"
            >
              <X size={14} />
            </button>
          </div>

          <h3 className="mt-3 text-[19px] font-semibold tracking-[-0.02em] text-warm">
            One base URL. Four providers. First request in a minute.
          </h3>

          <div className="mt-4 flex items-center gap-1.5">
            {(Object.keys(snippets) as Array<keyof typeof snippets>).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setLang(key)}
                className={cn(
                  "relative rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
                  lang === key ? "text-warm" : "text-ash hover:text-warm",
                )}
              >
                {lang === key ? (
                  <motion.span
                    layoutId="docs-lang"
                    className="absolute inset-0 rounded-lg border border-flame/30 bg-flame/[0.12]"
                    transition={spring}
                  />
                ) : null}
                <span className="relative">{key}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(snippets[lang]).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ash/20 px-2.5 py-1 text-[11px] text-ash transition hover:border-ash/35 hover:text-warm"
            >
              {copied ? <Check size={11} className="text-flame" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="relative mt-3 min-w-0 overflow-hidden rounded-xl border border-ash/15 bg-[#0f1012]">
            <AnimatePresence mode="wait">
              <motion.pre
                key={lang}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="max-h-[220px] w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words p-3.5 font-mono text-[11px] leading-5 text-warm/85"
              >
                {snippets[lang]}
              </motion.pre>
            </AnimatePresence>
          </div>
        </div>

        <motion.div {...listMotion} className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ash">
            <Layers size={12} aria-hidden /> Endpoints
          </p>
          <ul className="mt-3 space-y-1.5">
            {endpoints.map((endpoint) => (
              <motion.li
                key={endpoint.path}
                {...itemMotion}
                className="group flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 transition hover:border-ash/15 hover:bg-warm/[0.03]"
              >
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                    endpoint.method === "POST"
                      ? "bg-flame/12 text-flame"
                      : "bg-warm/[0.07] text-warm/70",
                  )}
                >
                  {endpoint.method}
                </span>
                <code className="flex-1 truncate font-mono text-[11.5px] text-warm/85">{endpoint.path}</code>
                <span className="text-[10.5px] text-dim">{endpoint.note}</span>
                <ArrowUpRight size={12} className="text-ash opacity-0 transition group-hover:opacity-100" aria-hidden />
              </motion.li>
            ))}
          </ul>

          <div className="mt-4 rounded-xl border border-ash/15 bg-warm/[0.02] p-3.5">
            <p className="flex items-center gap-2 text-[11px] font-medium text-warm">
              <Terminal size={12} className="text-flame" aria-hidden /> Auth
            </p>
            <p className="mt-1.5 text-[11.5px] leading-5 text-ash">
              Send your key as <code className="font-mono text-warm/85">Authorization: Bearer sk-…</code>. Keys are
              scoped per model and revocable from the dashboard.
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status popover                                                     */
/* ------------------------------------------------------------------ */

const uptimeLabel = (seconds: number) => {
  if (!seconds) return "—";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
};

function useBars(seed: number) {
  return Array.from({ length: 32 }, (_, index) => {
    const value = Math.sin((index + seed) * 1.7) * 0.5 + 0.5;
    return 0.72 + value * 0.28;
  });
}

function StatusPanel({ onClose }: { onClose: () => void }) {
  const bars = useBars(3);
  const { status, models } = useLandingData();
  const ok = status ? status.status === "operational" : true;
  const services = [
    { name: "Gateway API", latency: status?.p95_latency_ms || null, uptime: status ? `${status.success_rate}%` : "—" },
    { name: "Model katalog", latency: models.length, uptime: `${status?.models_active ?? models.length} live` },
    // process age, labelled as such — a deploy resets it, so it must not read as SLA uptime
    { name: "Proses gateway", latency: null, uptime: uptimeLabel(status?.uptime_seconds ?? 0) },
  ];

  return (
    <motion.div
      {...panelMotion}
      role="region"
      aria-label="System status"
      style={FLOATING_STYLE}
      className={cn(FLOATING, "w-[min(360px,calc(100vw-32px))] p-4")}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="flex items-center gap-2 text-[11.5px] font-semibold text-warm">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-flame/60" />
              <span className="relative inline-flex size-2 rounded-full bg-flame" />
            </span>
            {status ? (ok ? "All systems operational" : "Degraded — upstream errors") : "Status unavailable"}
          </p>
          <p className="mt-1 text-[10.5px] text-dim">
            {status
              ? `Live · ${status.requests_24h} req / 24h · ${status.requests_7d} / 7d · ${status.success_rate}% success`
              : "Gateway unreachable from here"}
          </p>
        </div>
        <Link
          to="/status"
          onClick={onClose}
          className="mb-3 inline-flex h-8 items-center gap-1 rounded-lg border border-flame/35 px-2.5 text-[11.5px] text-flame transition hover:bg-flame/10"
        >
          Halaman status <ArrowUpRight size={11} />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close status"
          className="grid size-7 place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm"
        >
          <X size={13} />
        </button>
      </div>

      <div className="mt-3.5 flex h-10 items-end gap-[3px]">
        {bars.map((value, index) => (
          <motion.span
            key={index}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: `${value * 100}%`, opacity: 1 }}
            transition={{ delay: index * 0.012, type: "spring", stiffness: 260, damping: 24 }}
            className="flex-1 rounded-sm bg-gradient-to-t from-flame/30 to-flame/80"
            title={`${Math.round(value * 100)}%`}
          />
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {services.map((service, index) => (
          <motion.li
            key={service.name}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 + index * 0.06 }}
            className="flex items-center justify-between text-[11.5px]"
          >
            <span className="flex items-center gap-2 text-ash">
              <Check size={11} className="text-flame" aria-hidden /> {service.name}
            </span>
            <span className="flex items-center gap-2 text-warm/75">
              {service.latency !== null ? (
                <span className="tabular-nums text-dim">
                  {service.latency}
                  {service.name === "Model routes" ? "" : "ms"}
                </span>
              ) : null}
              <span className="tabular-nums">{service.uptime}</span>
            </span>
          </motion.li>
        ))}
      </ul>

      <div className="mt-3.5 flex items-center justify-between border-t border-ash/12 pt-2.5 text-[10.5px] text-dim">
        <span className="flex items-center gap-1.5">
          <ShieldCheck size={11} aria-hidden /> {status ? `${status.errors_24h} errors / 24h` : "no telemetry"}
        </span>
        <span className="flex items-center gap-1 text-flame">
          <Zap size={10} aria-hidden /> {status?.models_active ?? models.length} routes live
        </span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                            */
/* ------------------------------------------------------------------ */

export function SiteHeader() {
  const { state } = useStore();
  const role: Role | null = state.role;
  const navigate = useNavigate();

  const [docsOpen, setDocsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [bansosOpen, setBansosOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"docs" | "status" | "bansos" | null>(null);
  const { status: mobileStatus } = useLandingData();

  const headerRef = useRef<HTMLElement>(null);

  /** Mobile menu closes before the jump, otherwise the collapsing menu shifts the target. */
  const jumpTo = (id: string) => {
    setMobileOpen(false);
    window.setTimeout(() => {
      const target = document.getElementById(id);
      if (!target) return;
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 64;
      const top = window.scrollY + target.getBoundingClientRect().top - headerHeight - 16;
      window.scrollTo({ top, behavior: "smooth" });
      window.history.replaceState(null, "", `#${id}`);
    }, 320);
  };

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setDocsOpen(false);
        setStatusOpen(false);
        setBansosOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDocsOpen(false);
        setStatusOpen(false);
        setBansosOpen(false);
        setMobileOpen(false);
        setMobilePanel(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const dashboardHref = role ? (role === "admin" ? "/admin/overview" : "/app/overview") : "/login";

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <header
      ref={headerRef}
      style={{ borderBottomColor: scrolled ? "rgba(58,59,61,0.7)" : "#2A2B2E" }}
      className={cn(
        "safe-t sticky top-0 z-40 border-b backdrop-blur-md transition-[background-color,border-color] duration-200",
        scrolled ? "bg-[#18191B]/95" : "bg-[#18191B]/85",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[1320px] items-center gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="AethinkAI home" className="flex shrink-0 items-center gap-2.5">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
          <NavItem label="Models" icon={<Boxes size={14} strokeWidth={1.9} />} href="#catalog" />
          <NavItem label="Pricing" icon={<Tag size={14} strokeWidth={1.9} />} href="#pricing" />
          <NavItem
            label="Docs"
            icon={<BookOpen size={14} strokeWidth={1.9} />}
            hasPanel
            active={docsOpen}
            onClick={() => {
              setDocsOpen((value) => !value);
              setStatusOpen(false);
              setBansosOpen(false);
            }}
          />
          <NavItem
            label="Status"
            icon={<Activity size={14} strokeWidth={1.9} />}
            hasPanel
            active={statusOpen}
            onClick={() => {
              setStatusOpen((value) => !value);
              setDocsOpen(false);
              setBansosOpen(false);
            }}
          />
          <NavItem
            label="Bansos"
            icon={<Gift size={14} strokeWidth={1.9} />}
            hasPanel
            active={bansosOpen}
            onClick={() => {
              setBansosOpen((value) => !value);
              setDocsOpen(false);
              setStatusOpen(false);
            }}
          />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={() => navigate(dashboardHref)}
            whileTap={{ scale: 0.985 }}
            transition={{ duration: 0.12 }}
            className="hidden h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-[#E7893C] px-4 text-[13px] font-semibold text-[#18191B] transition-colors duration-200 hover:bg-[#F09A55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7893C]/50 sm:inline-flex"
          >
            <span className="flex items-center gap-1.5">
              {role ? "Open dashboard" : "Sign in"}
              <ArrowRight size={13} aria-hidden />
            </span>
          </motion.button>
          <button
            type="button"
            style={{ borderColor: "#3A3B3D" }}
            className="grid size-10 place-items-center rounded-lg border text-[#FAF8F4]/80 transition-colors duration-200 hover:bg-[#292B2E] hover:text-[#FAF8F4] lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <Menu size={16} className="hidden" /> : null}
            {mobileOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {docsOpen ? <DocsPanel key="docs" onClose={() => setDocsOpen(false)} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {statusOpen ? <StatusPanel key="status" onClose={() => setStatusOpen(false)} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {bansosOpen ? <BansosPanel key="bansos" onClose={() => setBansosOpen(false)} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-t border-ash/12 bg-[#121315] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] lg:hidden"
          >
            <div className="safe-b flex flex-col gap-0.5 px-3 pt-2">
              {[
                { label: "Models", icon: <Boxes size={18} strokeWidth={1.9} />, href: "#catalog" },
                { label: "Pricing", icon: <Tag size={18} strokeWidth={1.9} />, href: "#pricing" },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={(event) => {
                    event.preventDefault();
                    jumpTo(item.href.replace("#", ""));
                  }}
                  className="flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-[#FAF8F4]/85 transition-colors duration-200 active:bg-[#292B2E]"
                >
                  <span aria-hidden className="flex text-ash">{item.icon}</span>
                  {item.label}
                </a>
              ))}
              {(["docs", "status", "bansos"] as const).map((panel) => (
                <button
                  key={panel}
                  type="button"
                  onClick={() => setMobilePanel((current) => (current === panel ? null : panel))}
                  className="flex h-12 items-center justify-between rounded-lg px-3 text-left text-[15px] font-medium capitalize text-[#FAF8F4]/85 transition-colors duration-200 active:bg-[#292B2E]"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="flex text-ash">
                      {panel === "docs" ? (
                        <BookOpen size={18} strokeWidth={1.9} />
                      ) : panel === "status" ? (
                        <Activity size={18} strokeWidth={1.9} />
                      ) : (
                        <Gift size={18} strokeWidth={1.9} />
                      )}
                    </span>
                    {panel}
                  </span>
                  <ChevronDown
                    size={16}
                    className={cn("transition-transform", mobilePanel === panel && "rotate-180 text-flame")}
                    aria-hidden
                  />
                </button>
              ))}

              <AnimatePresence>
                {mobilePanel ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {mobilePanel === "docs" ? (
                      <div className="mx-1 mb-2 rounded-xl border border-ash/15 bg-[#111214] p-3">
                        <p className="text-[12px] font-medium text-warm">Base URL</p>
                        <code className="mt-1 block break-all font-mono text-[12.5px] text-flame">{BASE}</code>
                        <p className="mt-2 text-[12.5px] leading-5 text-ash">
                          Authenticate with <code className="font-mono text-warm/85">Bearer sk-…</code>. One key covers
                          DeepSeek, GLM, Kimi and Claude.
                        </p>
                      </div>
                    ) : mobilePanel === "bansos" ? (
                      <div className="mx-1 mb-2 rounded-xl border border-flame/25 bg-[#111214] p-3">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warm">
                          <Gift size={12} className="text-flame" aria-hidden /> Bansos publik
                        </p>
                        <p className="mt-1 text-[12px] leading-5 text-ash">
                          Ambil API key gratis, lihat sisa kredit, dan pakai model yang termasuk bansos.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setMobileOpen(false);
                            setMobilePanel(null);
                            setBansosOpen(true);
                          }}
                          className="mt-2 flex h-10 w-full cursor-pointer items-center justify-center rounded-lg bg-[linear-gradient(180deg,#E7893C,#9C542F)] text-[13px] font-semibold text-[#18191B]"
                        >
                          Buka panel bansos
                        </button>
                      </div>
                    ) : (
                      <div className="mx-1 mb-2 rounded-xl border border-ash/15 bg-[#111214] p-3">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warm">
                          <CircleDot size={11} className="text-flame" aria-hidden />{" "}
                          {mobileStatus ? (mobileStatus.errors_24h === 0 ? "All systems operational" : "Degraded") : "Status unavailable"}
                        </p>
                        <p className="mt-1 text-[12px] text-ash">
                          {mobileStatus
                            ? `${mobileStatus.success_rate}% success · ${mobileStatus.requests_24h} req / 24h · p95 ${mobileStatus.p95_latency_ms || "—"}ms`
                            : "Memuat status gateway…"}
                        </p>
                      </div>
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="mt-2 flex flex-col gap-2 border-t border-ash/12 pt-3">
                <Link
                  to={dashboardHref}
                  onClick={() => setMobileOpen(false)}
                  className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#E7893C] text-[15px] font-semibold text-[#18191B] transition-colors duration-200 hover:bg-[#F09A55] active:scale-[0.99]"
                >
                  {role ? "Open dashboard" : "Sign in"}
                  <ArrowRight size={16} aria-hidden />
                </Link>
                {!role ? (
                  <Link
                    to="/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex h-12 items-center justify-center rounded-lg border border-[#3A3B3D] text-[15px] font-medium text-[#FAF8F4] transition-colors duration-200 hover:bg-[#292B2E] active:scale-[0.99]"
                  >
                    Masuk dengan Telegram
                  </Link>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
