import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  ArrowRightLeft,
  Boxes,
  Cpu,
  CreditCard,
  Gauge,
  Gift,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Package,
  Radar,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/layout/BrandLogo";
import type { Role } from "@/types";
import { formatIDR } from "@/lib/format";

type Item = { to: string; label: string; icon: LucideIcon };
type Group = { title?: string; items: Item[] };

const userNav: Group[] = [
  {
    items: [
      { to: "/app/overview", label: "Ringkasan", icon: LayoutDashboard },
      { to: "/app/api-keys", label: "API key", icon: KeyRound },
      { to: "/app/models", label: "Model & harga", icon: Boxes },
      { to: "/app/usage", label: "Pemakaian", icon: Activity },
      { to: "/app/billing", label: "Saldo & tagihan", icon: CreditCard },
    ],
  },
  { items: [{ to: "/app/settings", label: "Pengaturan", icon: Settings }] },
];

const adminNav: Group[] = [
  { items: [{ to: "/admin/overview", label: "Ringkasan", icon: Gauge }] },
  {
    title: "Pelanggan",
    items: [
      { to: "/admin/users", label: "Pengguna", icon: Users },
      { to: "/admin/access", label: "Akses & key", icon: ShieldCheck },
      { to: "/admin/api-keys", label: "Key pelanggan", icon: KeyRound },
      { to: "/admin/bansos", label: "Bansos", icon: Gift },
    ],
  },
  {
    title: "Katalog",
    items: [
      { to: "/admin/models", label: "Model & harga", icon: Boxes },
      { to: "/admin/pricing", label: "Paket", icon: Package },
      { to: "/admin/routing", label: "Routing", icon: GitBranch },
      { to: "/admin/fallbacks", label: "Fallback", icon: ArrowRightLeft },
    ],
  },
  {
    title: "Pantau",
    items: [
      { to: "/admin/usage", label: "Analitik pemakaian", icon: Activity },
      { to: "/admin/monitor", label: "Monitor key", icon: Radar },
      { to: "/admin/model-live", label: "Monitor model", icon: Cpu },
    ],
  },
  { items: [{ to: "/admin/settings", label: "Pengaturan", icon: Settings }] },
];

const roleNav = { user: userNav, admin: adminNav } as const;

export function Sidebar({
  role,
  open,
  onClose,
  credits,
  userName,
  email,
  plan,
  onSwitchRole,
}: {
  role: Role;
  open: boolean;
  onClose: () => void;
  credits: number | null;
  userName: string;
  email: string;
  plan: string;
  onSwitchRole: () => void;
}) {
  const groups = roleNav[role];

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <>
      {open ? <div className="overlay-enter fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={onClose} aria-hidden /> : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-white/8 bg-charcoal transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label={role === "admin" ? "Navigasi admin" : "Navigasi"}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Wordmark compact />
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-lg text-ash transition-colors hover:bg-white/[0.06] hover:text-warm lg:hidden"
            aria-label="Tutup navigasi"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
          {groups.map((group, index) => (
            <div key={group.title ?? index}>
              {group.title ? <p className="mb-1 px-3 text-[12px] font-medium text-dim">{group.title}</p> : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] transition-colors lg:py-2 lg:text-[13px]",
                        isActive ? "bg-white/[0.07] font-medium text-warm" : "text-ash hover:bg-white/[0.04] hover:text-warm",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon size={16} className={cn(isActive ? "text-flame" : "text-ash")} aria-hidden />
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/8 p-3">
          {role === "user" ? (
            <div className="mb-3 flex items-baseline justify-between px-3 text-[13px]">
              <span className="text-ash">Saldo</span>
              <span className="num font-semibold text-warm">{credits === null ? "n/a" : formatIDR(credits)}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5 px-3 py-1.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[12px] font-semibold text-warm">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-warm">{userName}</p>
              <p className="truncate text-[12px] text-ash">{role === "admin" ? "Admin" : plan}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSwitchRole}
            className="mt-1 w-full rounded-lg px-3 py-2.5 text-left text-[13px] text-ash transition-colors hover:bg-white/[0.04] hover:text-warm lg:py-2"
            title={email}
          >
            Keluar
          </button>
        </div>
      </aside>
    </>
  );
}
