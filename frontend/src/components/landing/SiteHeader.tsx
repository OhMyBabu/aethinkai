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
  panelId,
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  hasPanel?: boolean;
  panelId?: string;
}) {
  const classes = cn(
    "group relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-[13px] font-medium tracking-[-0.01em] transition-[background-color,color] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7893C]/40",
    active
      ? "bg-[#292B2E] text-[#FAF8F4]"
      : "text-[#9A9DA0] hover:bg-[#292B2E]/70 hover:text-[#FAF8F4]",
  );

  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex transition-colors duration-200",
          active ? "text-[#E7893C]" : "text-[#9A9DA0] group-hover:text-[#FAF8F4]",
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
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-haspopup="true"
      data-panel={panelId}
      className={classes}
    >
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
  -H "Authorization: Bearer $AETHINK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4.1-flash",
    "messages": [{ "role": "user", "content": "Summarise this invoice" }]
  }'`,
  Python: `import os
from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key=os.environ["AETHINK_API_KEY"],
)

r = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "Summarise this invoice"}],
)`,
  Node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: process.env.AETHINK_API_KEY,
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
  "absolute left-1/2 top-[72px] z-50 mt-2 -translate-x-1/2 rounded-xl border bg-[#222325] shadow-[0_20px_48px_-20px_rgba(0,0,0,0.85)]";

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
  const { models } = useLandingData();
  const sampleModel = models[0]?.modelId ?? "deepseek-v4.1-flash-1017";
  const code = snippets[lang].replace(/deepseek-v4\.1-flash/g, sampleModel);

  return (
    <motion.div
      {...panelMotion}
      role="region"
      aria-label="Quickstart API"
      style={FLOATING_STYLE}
      className={cn(
        FLOATING,
        "w-[min(820px,calc(100vw-32px))] max-h-[calc(100dvh-96px)] overflow-x-hidden overflow-y-auto",
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-ash/12 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em] text-warm">
            <BookOpen size={13} className="text-flame" aria-hidden /> Quickstart API
          </p>
          <p className="mt-0.5 text-[11.5px] text-dim">Your first request in a minute</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            to="/panduan"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] text-ash transition hover:bg-warm/[0.06] hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
          >
            Full documentation <ArrowUpRight size={11} />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quickstart"
            className="grid size-8 place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 p-4 sm:gap-6 sm:p-5 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {(Object.keys(snippets) as Array<keyof typeof snippets>).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setLang(key)}
                aria-pressed={lang === key}
                className={cn(
                  "relative rounded-lg px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40",
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
                navigator.clipboard?.writeText(code).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border border-ash/20 px-2.5 text-[11px] text-ash transition hover:border-ash/35 hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
            >
              {copied ? <Check size={11} className="text-flame" /> : <Copy size={11} />}
              <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <div className="mt-2.5 min-w-0 overflow-hidden rounded-xl border border-ash/12 bg-[#0B0B0C]">
            <AnimatePresence mode="wait">
              <motion.pre
                key={lang}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
                className="max-h-[240px] w-full min-w-0 overflow-auto whitespace-pre p-3.5 font-mono text-[11px] leading-5 text-warm/85"
              >
                {code}
              </motion.pre>
            </AnimatePresence>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-dim">Common endpoints</p>
          <ul className="mt-2 divide-y divide-ash/10">
            {endpoints.map((endpoint) => (
              <li key={endpoint.path} className="flex items-center gap-2.5 py-2">
                <span
                  className={cn(
                    "w-10 shrink-0 rounded-md px-1.5 py-0.5 text-center font-mono text-[9.5px] font-semibold",
                    endpoint.method === "POST" ? "bg-flame/12 text-flame" : "bg-warm/[0.06] text-warm/70",
                  )}
                >
                  {endpoint.method}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-warm/85">{endpoint.path}</code>
                <span className="shrink-0 text-[10px] text-dim">{endpoint.note}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 rounded-xl border border-ash/12 bg-warm/[0.02] p-3">
            <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.16em] text-dim">
              <Terminal size={11} className="text-flame" aria-hidden /> Authentication
            </p>
            <code className="mt-1.5 block max-w-full whitespace-normal font-mono text-[11px] text-warm/85 [overflow-wrap:anywhere]">
              Authorization: Bearer $AETHINK_API_KEY
            </code>
            <p className="mt-1 text-[11px] leading-4 text-dim">
              One key for every model. Rotate or revoke it from the dashboard.
            </p>
          </div>
        </div>
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

function StatusPanel({ onClose }: { onClose: () => void }) {
  const { status, models } = useLandingData();
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setSeenAt(Date.now()), [status]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const title = !status
    ? "Status unavailable"
    : status.status === "operational"
      ? "All systems operational"
      : "Degraded performance";

  const seconds = Math.max(0, Math.round((now - seenAt) / 1000));
  const updated = seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;

  const series = [...(status?.models ?? [])].sort((a, b) => b.requests - a.requests).slice(0, 5);
  const peak = Math.max(1, ...series.map((row) => row.requests));

  const rows = [
    {
      name: "Gateway API",
      value: status ? `${status.p95_latency_ms.toLocaleString("en-US")} ms` : "—",
      meta: "p95",
    },
    {
      name: "Model catalog",
      value: `${status?.models_active ?? models.length} live`,
      meta: "",
    },
    {
      name: "Gateway process",
      value: uptimeLabel(status?.uptime_seconds ?? 0),
      meta: "uptime",
    },
  ];

  return (
    <motion.div
      {...panelMotion}
      role="region"
      aria-label="System status"
      style={FLOATING_STYLE}
      className={cn(
        FLOATING,
        "w-[min(360px,calc(100vw-32px))] max-h-[min(560px,calc(100dvh-100px))] overflow-y-auto p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-warm">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                status ? (status.status === "operational" ? "bg-[#5FBF7A]" : "bg-flame") : "bg-ash",
              )}
              aria-hidden
            />
            {title}
          </p>
          <p className="mt-1 text-[10.5px] text-dim">
            {status ? `Updated ${updated} · window last ${status.window_minutes ?? 15}m` : "Gateway unreachable from here"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close status"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
        >
          <X size={13} />
        </button>
      </div>

      <dl className="mt-3.5 grid grid-cols-3 gap-2 border-y border-ash/10 py-3">
        {[
          { k: "Success 24h", v: status ? `${status.success_rate.toFixed(2)}%` : "—" },
          { k: "Requests 24h", v: status ? status.requests_24h.toLocaleString("en-US") : "—" },
          { k: "Latency p95", v: status ? `${status.p95_latency_ms.toLocaleString("en-US")} ms` : "—" },
        ].map((item) => (
          <div key={item.k} className="min-w-0">
            <dd className="text-[16px] font-semibold tabular-nums tracking-[-0.01em] text-warm">{item.v}</dd>
            <dt className="mt-0.5 truncate text-[10px] text-dim">{item.k}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-[10.5px]">
          <span className="text-ash">Top models by requests</span>
          <span className="tabular-nums text-dim">Last 24h</span>
        </div>
        {series.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {series.slice(0, 3).map((row) => {
              const share = Math.round((row.requests / Math.max(1, peak)) * 100);
              return (
                <li key={row.model_id} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
                    <span className="min-w-0 truncate text-warm/85" title={row.model_id}>
                      {row.model_id}
                    </span>
                    <span className="shrink-0 tabular-nums text-dim">{row.requests} req</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-warm/[0.07]">
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, share)}%` }}
                      transition={{ type: "spring", stiffness: 240, damping: 28 }}
                      className="block h-full rounded-full bg-flame/70"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-dim">No requests recorded in the last 24 hours.</p>
        )}
      </div>

      <ul className="mt-3.5 divide-y divide-ash/10">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-3 py-2 text-[11.5px]">
            <span className="flex min-w-0 items-center gap-2 text-ash">
              <Check size={11} className="shrink-0 text-flame" aria-hidden />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1">
              <span className="tabular-nums text-warm/85">{row.value}</span>
              {row.meta ? <span className="text-[10px] text-dim">{row.meta}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10.5px] text-dim">
        {status
          ? `${status.errors_24h} errors · ${status.models_active} routes live · ${status.requests_24h.toLocaleString("en-US")} requests / 24h`
          : "No telemetry from the gateway"}
      </p>

      <Link
        to="/status"
        onClick={onClose}
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-flame/30 bg-flame/[0.08] text-[11.5px] font-medium text-flame transition hover:bg-flame/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
      >
        Status page <ArrowUpRight size={12} />
      </Link>
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
      if (event.key !== "Escape") return;
      const open = docsOpen ? "docs" : statusOpen ? "status" : bansosOpen ? "bansos" : null;
      setDocsOpen(false);
      setStatusOpen(false);
      setBansosOpen(false);
      setMobileOpen(false);
      setMobilePanel(null);
      if (open) {
        requestAnimationFrame(() => {
          document.querySelector<HTMLButtonElement>(`[data-panel="${open}"]`)?.focus();
        });
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [docsOpen, statusOpen, bansosOpen]);

  const dashboardHref = role ? (role === "admin" ? "/admin/overview" : "/app/overview") : "/login";

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // 20px, not 6: the header must blend into the grid at the very top and only
    // become a glass bar once the page has actually moved.
    const onScroll = () => setScrolled(window.scrollY > 20);
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
      className={cn(
        "site-header safe-t sticky top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter,box-shadow] duration-300",
        scrolled
          ? "site-header--scrolled bg-[#0A0A0A]/75 shadow-[0_10px_30px_-26px_rgba(0,0,0,0.9)] backdrop-blur-[16px]"
          : "border-transparent bg-transparent backdrop-blur-0",
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
            panelId="docs"
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
            panelId="status"
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
            className="aethink-header-cta hidden cursor-pointer items-center sm:inline-flex"
          >
            <span className="flex items-center gap-1.5">
              {role ? "Open dashboard" : "Sign in"}
              <ArrowRight size={13} aria-hidden />
            </span>
          </motion.button>
          <button
            type="button"
            style={{ borderColor: "#3A3B3D" }}
            className="grid size-11 place-items-center rounded-lg border text-[#FAF8F4]/80 transition-colors duration-200 hover:bg-[#292B2E] hover:text-[#FAF8F4] lg:hidden"
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
                          Authenticate with <code className="font-mono text-warm/85">Bearer YOUR_API_KEY</code>. One key covers
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
