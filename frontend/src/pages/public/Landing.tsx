import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { LandingAurora } from "@/components/landing/LandingAurora";
import { SiteHeader } from "@/components/landing/SiteHeader";
import {
  ClosingCta,
  HowItWorks,
  ModelCatalog,
  Pricing,
  Quickstart,
  SiteFooter,
  StatusStrip,
  useShop,
} from "@/components/landing/LandingSections";
import { useLandingData } from "@/lib/landing-data";

export default function LandingPage() {
  // Catalogue, prices and status come from the gateway, never from fixtures.
  const { models, status } = useLandingData();
  const shop = useShop();

  const providers = useMemo(() => Array.from(new Set(models.map((model) => model.provider))), [models]);
  const cheapest = useMemo(
    () => (shop.packages.length ? Math.min(...shop.packages.map((pkg) => pkg.price_idr)) : null),
    [shop.packages],
  );

  const providerText =
    providers.length > 1 ? `${providers.slice(0, -1).join(", ")}, dan ${providers[providers.length - 1]}` : providers[0] ?? "model AI terbaik";

  return (
    <div className="relative min-h-screen">
      <LandingAurora />
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-[1200px] px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:pt-20">
          <div className="grid min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
            <div className="min-w-0">
              <h1 className="text-balance text-[38px] font-semibold leading-[1.06] tracking-[-0.035em] text-warm sm:text-[52px] lg:text-[56px]">
                API model AI yang dibayar pakai Rupiah.
              </h1>
              <p className="mt-5 max-w-[52ch] text-[16px] leading-7 text-ash sm:text-[17px]">
                Satu endpoint kompatibel OpenAI untuk {providerText}. Beli saldo lewat QRIS di Telegram, terima API
                key di chat yang sama, lalu bayar sesuai token yang terpakai.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/login"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-flame px-6 text-[15px] font-medium text-[#1a1305] transition-colors hover:bg-[#f09a52]"
                >
                  Ambil API key <ArrowRight size={16} aria-hidden />
                </Link>
                <a
                  href="#pricing"
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-white/14 px-6 text-[15px] font-medium text-warm transition-colors hover:bg-white/[0.06]"
                >
                  Lihat harga
                </a>
              </div>

              <p className="mt-4 text-[13px] text-ash">Bayar sesuai pemakaian · QRIS · API key dikirim lewat Telegram</p>
            </div>

            <div className="min-w-0">
              <Quickstart models={models} />
            </div>
          </div>
        </section>

        <StatusStrip models={models} status={status} />
        <HowItWorks />
        <Pricing shop={shop} />
        <ModelCatalog models={models} />
        <ClosingCta cheapest={cheapest} />
      </main>

      <SiteFooter />
    </div>
  );
}
