import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { AppAmbient } from "@/components/layout/AppAmbient";
import { Topbar } from "@/components/layout/Topbar";
import { useToast } from "@/components/common/Toast";
import { useStore } from "@/data/store";
import { me } from "@/lib/gw";
import type { Role } from "@/types";

const titles: Record<string, string> = {
  "/app/overview": "Overview",
  "/app/models": "AI Models",
  "/app/api-keys": "API Keys",
  "/app/usage": "Usage & Logs",
  "/app/billing": "Credits & Billing",
  "/app/settings": "Settings",
  "/admin/overview": "Overview",
  "/admin/access": "Access & keys",
  "/admin/users": "Users",
  "/admin/models": "Katalog & harga",
  "/admin/pricing": "Paket & RPM",
  "/admin/api-keys": "Customer API keys",
  "/admin/monitor": "Key monitor",
  "/admin/model-live": "Model monitor",
  "/admin/bansos": "Bansos",
  "/admin/routing": "Model routing",
  "/admin/fallbacks": "Model fallback",
  "/admin/usage": "Usage analytics",
  "/admin/settings": "Admin settings",
};

export function AppShell({ role }: { role: Role }) {
  const [navOpen, setNavOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const { state, currentUser, logout } = useStore();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    me()
      .then((data) => {
        if (!cancelled) setBalance(data.balance_idr);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const user = currentUser ?? state.users[0];

  return (
    <div className="relative isolate flex min-h-screen bg-charcoal">
      <AppAmbient />
      <Sidebar
        role={role}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        credits={balance ?? 0}
        userName={user.name}
        email={user.email}
        plan={role === "admin" ? "Admin" : user.plan}
        onSwitchRole={() => {
          logout();
          navigate("/login");
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenNav={() => setNavOpen(true)}
          title={titles[location.pathname] ?? "AethinkAI"}
          role={role}
          onNotify={() => toast("You're all caught up", { description: "No new alerts for this workspace.", variant: "info" })}
        />
        <main className="safe-b relative min-w-0 flex-1 px-4 py-5 pb-16 sm:px-6 sm:py-8">
          <div key={location.pathname} className="page-enter mx-auto w-full max-w-[1240px]">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-white/6 px-6 py-4 text-[11px] text-dim">
          AethinkAI Gateway · router.aethink.ai.id · v0.1.0
        </footer>
      </div>
    </div>
  );
}
