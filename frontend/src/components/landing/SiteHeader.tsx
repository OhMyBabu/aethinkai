import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { Menu, X } from "lucide-react";
import { BansosPanel } from "./BansosPanel";
import { Wordmark } from "@/components/layout/BrandLogo";
import { useStore } from "@/data/store";
import { useLandingData } from "@/lib/landing-data";
import { cn } from "@/lib/cn";
import type { Role } from "@/types";

const LINKS: Array<{ label: string; href: string; route?: boolean }> = [
  { label: "Harga", href: "#pricing" },
  { label: "Model", href: "#catalog" },
  { label: "Panduan", href: "/panduan", route: true },
  { label: "Status", href: "/status", route: true },
];

const linkClass = "inline-flex h-9 items-center rounded-lg px-3 text-[13.5px] text-ash transition-colors hover:text-warm";

export function SiteHeader() {
  const { state } = useStore();
  const role: Role | null = state.role;
  const navigate = useNavigate();
  const { status } = useLandingData();
  const headerRef = useRef<HTMLElement>(null);

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bansosOpen, setBansosOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setBansosOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBansosOpen(false);
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const dashboardHref = role ? (role === "admin" ? "/admin/overview" : "/app/overview") : "/login";
  const ctaLabel = role ? "Buka dashboard" : "Masuk";
  const degraded = status?.status === "degraded";

  const renderLink = (item: (typeof LINKS)[number], className: string) =>
    item.route ? (
      <Link key={item.label} to={item.href} className={className} onClick={() => setMenuOpen(false)}>
        {item.label}
      </Link>
    ) : (
      <a key={item.label} href={item.href} className={className} onClick={() => setMenuOpen(false)}>
        {item.label}
      </a>
    );

  return (
    <header ref={headerRef} className={cn("site-header sticky top-0 z-50", scrolled && "site-header--scrolled")}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-2 px-4 sm:px-6">
        <Link to="/" aria-label="AethinkAI, beranda" className="mr-3 flex shrink-0 items-center">
          <Wordmark compact />
        </Link>

        <nav aria-label="Utama" className="hidden items-center md:flex">
          {LINKS.map((item) => renderLink(item, linkClass))}
          <button
            type="button"
            aria-expanded={bansosOpen}
            onClick={() => setBansosOpen((value) => !value)}
            className={cn(linkClass, bansosOpen && "text-warm")}
          >
            Bansos
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          {status ? (
            <Link
              to="/status"
              className="hidden h-9 items-center gap-2 rounded-lg px-2 text-[12.5px] text-ash transition-colors hover:text-warm lg:inline-flex"
            >
              <span className={cn("size-1.5 rounded-full", degraded ? "bg-flame" : "live-dot bg-ok")} aria-hidden />
              {degraded ? "Ada gangguan" : "Semua sistem normal"}
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => navigate(dashboardHref)}
            className="inline-flex h-10 items-center rounded-lg bg-warm px-4 text-[13.5px] font-medium text-[#0a0a0a] transition-colors hover:bg-white sm:h-9"
          >
            {ctaLabel}
          </button>

          <button
            type="button"
            className="grid size-11 place-items-center rounded-lg text-ash transition-colors hover:text-warm md:hidden"
            aria-label={menuOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {bansosOpen ? <BansosPanel key="bansos" onClose={() => setBansosOpen(false)} /> : null}
      </AnimatePresence>

      {menuOpen ? (
        <nav aria-label="Menu seluler" className="panel-enter border-t border-white/8 bg-charcoal px-4 pb-4 pt-2 md:hidden">
          {LINKS.map((item) => renderLink(item, "flex h-12 items-center border-b border-white/[0.06] text-[15px] text-warm"))}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setBansosOpen(true);
            }}
            className="flex h-12 w-full items-center text-left text-[15px] text-warm"
          >
            Bansos
          </button>
        </nav>
      ) : null}
    </header>
  );
}
