import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Activity, ArrowRightLeft, Boxes, Cpu, CreditCard, Gauge, Gift, GitBranch, KeyRound, LayoutDashboard, Radar, Settings, ShieldCheck, Tag, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/layout/BrandLogo";
import { StatusPill } from "@/components/common/StatusPill";
import type { Role } from "@/types";
import { formatIDR } from "@/lib/format";

const userNav = [
  { to: "/app/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/app/models", label: "AI Models", icon: Boxes },
  { to: "/app/api-keys", label: "API Keys", icon: KeyRound },
  { to: "/app/usage", label: "Usage & Logs", icon: Activity },
  { to: "/app/billing", label: "Credits & Billing", icon: CreditCard },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

const adminNav = [
  { to: "/admin/overview", label: "Overview", icon: Gauge },
  { to: "/admin/access", label: "Access & Keys", icon: ShieldCheck },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/models", label: "Model Catalog", icon: Boxes },
  { to: "/admin/pricing", label: "Packages & Pricing", icon: Tag },
  { to: "/admin/api-keys", label: "Customer Keys", icon: KeyRound },
  { to: "/admin/monitor", label: "Key Monitor", icon: Radar },
  { to: "/admin/model-live", label: "Model Monitor", icon: Cpu },
  { to: "/admin/bansos", label: "Bansos", icon: Gift },
  { to: "/admin/routing", label: "Routing", icon: GitBranch },
  { to: "/admin/fallbacks", label: "Fallback", icon: ArrowRightLeft },
  { to: "/admin/usage", label: "Usage Analytics", icon: Activity },
  { to: "/admin/settings", label: "Admin Settings", icon: Settings },
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
  credits: number;
  userName: string;
  email: string;
  plan: string;
  onSwitchRole: () => void;
}) {
  const items = roleNav[role];

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {open ? (
        <div
          className="overlay-enter fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-ash/15 bg-[#151619] transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label={`${role} navigation`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Wordmark />
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-xl text-ash transition active:scale-95 active:bg-warm/[0.08] hover:bg-warm/[0.06] hover:text-warm lg:hidden"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center justify-between rounded-xl border border-ash/15 bg-warm/[0.03] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ash">
              <ShieldCheck size={12} aria-hidden />
              {role === "admin" ? "Admin" : "Workspace"}
            </span>
            <StatusPill tone="active" dot={false}>
              {plan}
            </StatusPill>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] font-medium transition lg:py-2.5 lg:text-[13px]",
                  isActive
                    ? "bg-gradient-to-r from-flame/[0.18] via-flame/[0.07] to-transparent text-warm shadow-[inset_0_0_0_1px_rgba(231,137,60,0.25)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-flame"
                    : "text-ash hover:bg-warm/[0.045] hover:text-warm",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={16} className={cn(isActive && "text-flame")} aria-hidden />
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-ash/12 p-4">
          {role === "user" ? (
            <div className="rounded-xl border border-ash/15 bg-warm/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-ash">Credit balance</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-warm">{formatIDR(credits)}</p>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-full border border-flame/25 bg-flame/10 text-[12px] font-semibold text-flame">
              {userName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-warm">{userName}</p>
              <p className="truncate text-[11px] text-ash">{email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSwitchRole}
            className="w-full rounded-xl border border-ash/20 px-3 py-3 text-[13px] font-medium text-ash transition active:scale-[0.99] hover:border-ash/35 hover:text-warm lg:py-2 lg:text-[11.5px]"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
