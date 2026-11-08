import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, LogOut, Menu, Settings, ShieldCheck } from "lucide-react";
import { useStore } from "@/data/store";
import type { Role } from "@/types";

function AccountMenu({ role }: { role: Role }) {
  const { currentUser, logout } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!currentUser) return null;
  const initials = currentUser.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 items-center gap-2 rounded-xl border border-ash/20 pl-1 pr-2.5 text-[12.5px] text-ash transition active:scale-[0.98] hover:border-ash/35 hover:text-warm lg:h-9 lg:rounded-lg lg:text-[12px]"
      >
        <span className="grid size-7 place-items-center rounded-md bg-flame/12 text-[10.5px] font-semibold text-flame">
          {initials}
        </span>
        <span className="hidden max-w-[130px] truncate sm:block">{currentUser.email}</span>
        <ChevronDown size={13} aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-[248px] overflow-hidden rounded-xl border border-ash/20 bg-[#1b1c1f] shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]"
        >
          <div className="border-b border-ash/12 px-3.5 py-3">
            <p className="truncate text-[12.5px] font-medium text-warm">{currentUser.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-ash">{currentUser.email}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-flame/25 bg-flame/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-flame">
              <ShieldCheck size={10} aria-hidden />
              {role === "admin" ? "Gateway admin" : currentUser.plan}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate(role === "admin" ? "/admin/settings" : "/app/settings");
            }}
            className="flex min-h-12 w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] text-ash transition hover:bg-warm/[0.05] hover:text-warm"
          >
            <Settings size={14} aria-hidden /> Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
              navigate("/login", { replace: true });
            }}
            className="flex min-h-12 w-full items-center gap-2.5 border-t border-ash/12 px-3.5 py-3 text-left text-[13px] text-ash transition hover:bg-warm/[0.05] hover:text-warm"
          >
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({
  onOpenNav,
  title,
  role,
  onNotify,
}: {
  onOpenNav: () => void;
  title: string;
  role: Role;
  onNotify?: () => void;
}) {
  return (
    <div className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ash/12 bg-[#18191b]/85 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        className="grid size-11 place-items-center rounded-xl border border-ash/20 text-ash transition active:scale-95 active:bg-warm/10 hover:text-warm lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={16} />
      </button>
      <p className="hidden text-[13px] font-medium text-warm/85 sm:block lg:hidden">{title}</p>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onNotify?.()}
          className="relative grid size-11 place-items-center rounded-xl border border-ash/20 text-ash transition active:scale-95 hover:text-warm lg:size-9 lg:rounded-lg"
          aria-label="Notifications"
        >
          <Bell size={15} aria-hidden />
        </button>
        <AccountMenu role={role} />
      </div>
    </div>
  );
}
