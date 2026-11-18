import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { StoreProvider, useStore } from "@/data/store";
import { getSessionUser } from "@/lib/gw";
import { ToastProvider } from "@/components/common/Toast";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AppShell } from "@/components/layout/AppShell";
import LandingPage from "@/pages/public/Landing";
import LoginPage from "@/pages/public/Login";
import LoginTelegramPage from "@/pages/public/LoginTelegram";
import SignupPage from "@/pages/public/Signup";
import PayPage from "@/pages/public/Pay";
import PortalPage from "@/pages/public/Portal";
import MiniAppPage from "@/pages/tg/MiniApp";
import NotFoundPage from "@/pages/public/NotFound";
import DocsPage from "@/pages/public/Docs";
import StatusPage from "@/pages/public/Status";
import UserOverviewPage from "@/pages/user/Overview";
import UserModelsPage from "@/pages/user/Models";
import UserApiKeysPage from "@/pages/user/ApiKeys";
import UserUsagePage from "@/pages/user/Usage";
import UserBillingPage from "@/pages/user/Billing";
import UserSettingsPage from "@/pages/user/Settings";
import AdminOverviewPage from "@/pages/admin/Overview";
import AdminUsersPage from "@/pages/admin/Users";
import AdminModelsPage from "@/pages/admin/Models";
import AdminPricingPage from "@/pages/admin/Pricing";
import AdminApiKeysPage from "@/pages/admin/ApiKeys";
import AdminMonitorPage from "@/pages/admin/Monitor";
import AdminModelLivePage from "@/pages/admin/ModelsLive";
import AdminBansosPage from "@/pages/admin/Bansos";
import AdminFallbacksPage from "@/pages/admin/Fallbacks";
import AdminRoutingPage from "@/pages/admin/Routing";
import AdminAccessPage from "@/pages/admin/Access";
import AdminUsagePage from "@/pages/admin/Usage";
import AdminSettingsPage from "@/pages/admin/Settings";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

function RequireRole({ role, children }: { role: "user" | "admin"; children: ReactNode }) {
  const { state, signIn } = useStore();
  const location = useLocation();
  // The gateway session (gw token) is what actually authenticates API calls; the local store only
  // holds the UI identity. Restore it on load so a refresh does not kick a signed-in admin out.
  const remembered = getSessionUser();
  const restored = useRef(false);
  const [ready, setReady] = useState(!remembered);

  useEffect(() => {
    if (!remembered || state.currentUserId || restored.current) return;
    restored.current = true;
    signIn(remembered.role === "admin" ? "usr_admin" : "usr_001");
    setReady(true);
  }, [remembered, signIn, state.currentUserId]);

  if (!ready && (!state.role || !state.currentUserId)) {
    return <div className="grid min-h-screen place-items-center bg-[#0A0A0A] text-[12.5px] text-[#85888B]">Memuat sesi…</div>;
  }
  if (!state.role || !state.currentUserId) {
    return <Navigate to="/login" replace state={{ next: location.pathname }} />;
  }
  if (state.role !== role) {
    return <Navigate to={state.role === "admin" ? "/admin/overview" : "/app/overview"} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary scope="app">
    <StoreProvider>
      <ToastProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/panduan" element={<DocsPage />} />
          <Route path="/guide" element={<DocsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/login" element={<LoginTelegramPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route path="/portal" element={<PortalPage />} />
          <Route path="/pay/:orderId" element={<PayPage />} />
          <Route path="/tg" element={<MiniAppPage />} />

          <Route
            path="/app"
            element={
              <RequireRole role="user">
                <AppShell role="user" />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="/app/overview" replace />} />
            <Route path="overview" element={<UserOverviewPage />} />
            <Route path="models" element={<UserModelsPage />} />
            <Route path="api-keys" element={<UserApiKeysPage />} />
            <Route path="usage" element={<UserUsagePage />} />
            <Route path="billing" element={<UserBillingPage />} />
            <Route path="settings" element={<UserSettingsPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireRole role="admin">
                <AppShell role="admin" />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview" element={<AdminOverviewPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="models" element={<AdminModelsPage />} />
            <Route path="pricing" element={<AdminPricingPage />} />
            <Route path="api-keys" element={<AdminApiKeysPage />} />
            <Route path="monitor" element={<AdminMonitorPage />} />
            <Route path="model-live" element={<AdminModelLivePage />} />
            <Route path="bansos" element={<AdminBansosPage />} />
            <Route path="fallbacks" element={<AdminFallbacksPage />} />
            <Route path="routing" element={<AdminRoutingPage />} />
            <Route path="access" element={<AdminAccessPage />} />
            <Route path="usage" element={<AdminUsagePage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ToastProvider>
    </StoreProvider>
    </ErrorBoundary>
  );
}
