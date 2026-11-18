import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Menu, Settings } from "lucide-react";
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!currentUser) return null;
  const admin = role === "admin";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ash transition-colors hover:bg-white/[0.05] hover:text-warm lg:h-9"
      >
        <span className="hidden max-w-[180px] truncate sm:block">{currentUser.email}</span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="panel-enter absolute right-0 top-11 z-50 w-[232px] overflow-hidden rounded-lg border border-white/12 bg-[#101012]"
        >
          <div className="border-b border-white/8 px-3.5 py-3">
            <p className="truncate text-[13px] font-medium text-warm">{currentUser.name}</p>
            <p className="mt-0.5 truncate text-[12px] text-ash">{currentUser.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate(admin ? "/admin/settings" : "/app/settings");
            }}
            className="flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ash transition-colors hover:bg-white/[0.05] hover:text-warm"
          >
            <Settings size={14} aria-hidden /> Pengaturan
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
              navigate("/login", { replace: true });
            }}
            className="flex min-h-11 w-full items-center gap-2.5 border-t border-white/8 px-3.5 py-2.5 text-left text-[13px] text-ash transition-colors hover:bg-white/[0.05] hover:text-warm"
          >
            <LogOut size={14} aria-hidden /> Keluar
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({ onOpenNav, title, role }: { onOpenNav: () => void; title: string; role: Role }) {
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/8 bg-charcoal/90 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        className="grid size-11 place-items-center rounded-lg text-ash transition-colors hover:bg-white/[0.06] hover:text-warm lg:hidden"
        aria-label="Buka navigasi"
      >
        <Menu size={18} />
      </button>
      <p className="text-[14px] font-medium text-warm lg:hidden">{title}</p>
      <div className="ml-auto">
        <AccountMenu role={role} />
      </div>
    </div>
  );
}
