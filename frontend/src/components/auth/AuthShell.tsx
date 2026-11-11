import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Wordmark } from "@/components/layout/BrandLogo";

/** Split auth layout: product story on the left, form on the right. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-charcoal lg:grid lg:grid-cols-[1.05fr_1fr]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_0%,rgba(231,137,60,0.13),transparent_65%)]"
      />

      <aside className="relative hidden flex-col justify-between border-r border-ash/12 px-10 py-10 lg:flex xl:px-14">
        <Link to="/" aria-label="AethinkAI home" className="-my-2 flex w-fit items-center py-3">
          <Wordmark />
        </Link>

        <div className="max-w-[430px]">
          <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-warm xl:text-[40px]">
            One API.
            <br />
            Every Model.
          </h2>
          <p className="mt-4 text-[13.5px] leading-6 text-ash">
            DeepSeek, Qwen, GLM and Kimi behind a single key, one endpoint, one bill, automatic failover when a
            provider degrades.
          </p>

          <div className="mt-7 rounded-xl border border-ash/15 bg-[#141518]/90 p-4 font-mono text-[11.5px] leading-6">
            <p className="text-ash">
              <span className="text-flame">curl</span> -X POST \
            </p>
            <p className="pl-4 text-ash">https://router.aethink.ai.id/v1/chat/completions \</p>
            <p className="pl-4 text-ash">
              -H <span className="text-warm/80">"Authorization: Bearer sk-•••"</span> \
            </p>
            <p className="pl-4 text-ash">
              -d <span className="text-warm/80">'{"{"}"model":"deepseek-v4.1-flash"{"}"}'</span>
            </p>
            <p className="mt-2 text-flame/90">200 OK · 1.2s</p>
          </div>

          <ul className="mt-7 space-y-3 text-[12.5px] text-ash">
            <li className="flex items-center gap-2.5">
              <ShieldCheck size={14} className="text-flame" aria-hidden /> Keys are scoped per model, revocable anytime
            </li>
            <li className="flex items-center gap-2.5">
              <Sparkles size={14} className="text-flame" aria-hidden /> Usage metered per request, priced in rupiah
            </li>
          </ul>
        </div>

        <p className="text-[11px] text-dim">© {new Date().getFullYear()} AethinkAI, gateway for frontier models</p>
      </aside>

      <main className="relative flex flex-1 flex-col justify-center px-4 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex justify-center lg:hidden">
            <Link to="/" aria-label="AethinkAI home" className="-my-2 flex items-center py-3">
              <Wordmark />
            </Link>
          </div>

          <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-warm sm:text-[30px]">{title}</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-ash">{subtitle}</p>

          <div className="mt-7">{children}</div>
          <div className="mt-6 text-center text-[12.5px] text-ash">{footer}</div>
        </div>
      </main>
    </div>
  );
}
