import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Wordmark } from "@/components/layout/BrandLogo";
import { LandingAurora } from "@/components/landing/LandingAurora";
import { TelegramConnect } from "@/components/portal/TelegramConnect";

/** Buyer sign-in: Telegram only. No email, no password, the bot is the identity provider. */
export default function LoginTelegramPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "/portal";

  return (
    <div className="relative grid min-h-[100svh] place-items-center px-4 py-10">
      <LandingAurora />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative w-full max-w-[440px] rounded-xl border border-white/[0.07] bg-panel/95 p-6 sm:p-7"
      >
        <Link to="/" className="inline-flex">
          <Wordmark />
        </Link>

        <h1 className="mt-6 text-[22px] font-semibold tracking-[-0.02em] text-warm">
          Masuk ke AethinkAI
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ash">
          Hubungkan akun Telegram Anda untuk mengakses dashboard, mengelola API key, memantau saldo, dan
          melihat riwayat transaksi.
        </p>

        <div className="mt-6">
          <TelegramConnect
            compact
            pulse
            onToken={(token) => {
              sessionStorage.setItem("aethink-portal-token", token);
              navigate(next, { replace: true });
            }}
          />
        </div>

        <p className="mt-3 text-[12px] leading-5 text-ash">
          Masuk dengan Telegram tanpa email atau kata sandi.
        </p>
      </motion.div>
    </div>
  );
}
