import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { AppAmbient } from "@/components/layout/AppAmbient";
import { Topbar } from "@/components/layout/Topbar";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useStore } from "@/data/store";
import { me } from "@/lib/gw";
import type { Role } from "@/types";

const titles: Record<string, string> = {
  "/app/overview": "Ringkasan",
  "/app/models": "Model & harga",
  "/app/api-keys": "API key",
  "/app/usage": "Pemakaian",
  "/app/billing": "Saldo & tagihan",
  "/app/settings": "Pengaturan",
  "/admin/overview": "Ringkasan",
  "/admin/access": "Akses & key",
  "/admin/users": "Pengguna",
  "/admin/models": "Model & harga",
  "/admin/pricing": "Paket",
  "/admin/api-keys": "Key pelanggan",
  "/admin/monitor": "Monitor key",
  "/admin/model-live": "Monitor model",
  "/admin/bansos": "Bansos",
  "/admin/routing": "Routing",
  "/admin/fallbacks": "Fallback",
  "/admin/usage": "Analitik pemakaian",
  "/admin/settings": "Pengaturan",
};

export function AppShell({ role }: { role: Role }) {
  const [navOpen, setNavOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const { state, currentUser, logout } = useStore();
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
        credits={balance}
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
        />
        <main className="safe-b relative min-w-0 flex-1 px-4 py-5 pb-16 sm:px-6 sm:py-7">
          <div key={location.pathname} className="page-enter mx-auto w-full max-w-[1200px]">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
