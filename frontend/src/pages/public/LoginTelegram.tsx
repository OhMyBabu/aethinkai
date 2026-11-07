import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/layout/BrandLogo";
import { TelegramConnect } from "@/components/portal/TelegramConnect";

/** Buyer sign-in: Telegram only. No email, no password — the bot is the identity provider. */
export default function LoginTelegramPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "/portal";

  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-14">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_50%_-10%,rgba(231,137,60,0.10),transparent_65%)]" />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative w-full max-w-[440px] rounded-2xl border border-[#3A3B3D] bg-[#1B1C1F] p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.9)]"
      >
        <Link to="/" className="inline-flex"><Wordmark /></Link>
        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[#FAF8F4]">
          Masuk dengan Telegram
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-[#85888B]">
          Akun AethinkAI terikat ke Telegram — di situ API key dikirim, dan dari situ pembelian
          tercatat. Nggak ada email atau password.
        </p>

        <div className="mt-5">
          <TelegramConnect
            onToken={(token) => {
              sessionStorage.setItem("aethink-portal-token", token);
              navigate(next, { replace: true });
            }}
          />
        </div>

        <p className="mt-5 flex items-start gap-1.5 text-[11.5px] leading-5 text-[#85888B]">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[#E7893C]" />
          Admin panel tetap pakai email &amp; password di{" "}
          <Link to="/admin/login" className="text-[#FAF8F4] underline decoration-[#3A3B3D] underline-offset-2">
            /admin/login
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}
