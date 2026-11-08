import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Boxes } from "lucide-react";
import { Button } from "@/components/common/Button";
import { SignalNexus } from "@/components/landing/SignalNexus";
import {
  FeatureStrip,
  FullModelCatalog,
  KpiStrip,
  PopularModels,
  PricingPreview,
} from "@/components/landing/LandingSections";
import { TerminalPreview } from "@/components/landing/TerminalPreview";
import { LandingAurora } from "@/components/landing/LandingAurora";
import { Wordmark } from "@/components/layout/BrandLogo";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { useStore } from "@/data/store";
import { useReveal } from "@/hooks/useReveal";
import { useLandingData } from "@/lib/landing-data";

export default function LandingPage() {
  const { state } = useStore();
  const role = state.role;
  const navigate = useNavigate();

  const revealLeft = useReveal<HTMLDivElement>();
  const revealPreview = useReveal<HTMLDivElement>();
  const revealPricing = useReveal<HTMLDivElement>();

  // Catalogue + prices + status come from the gateway, never from fixtures.
  const { models: enabledModels, status } = useLandingData();

  const navLinkClass =
    "text-[12.5px] text-ash transition hover:text-warm focus-visible:text-warm";

  return (
    <div className="relative min-h-screen">
      <LandingAurora />

      <SiteHeader />

      <main>
        <section className="mx-auto max-w-[1320px] px-4 pb-8 pt-6 max-[899px]:px-5 sm:px-6 sm:pb-12 sm:pt-12 lg:pt-14">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-10 min-[900px]:grid-cols-[1.02fr_1fr] min-[900px]:gap-8">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-ash/25 bg-warm/[0.03] px-3 py-1 text-[11px] font-medium text-ash max-[899px]:px-3.5 max-[899px]:py-1.5 max-[899px]:text-[12px]">
                <span className="size-1.5 rounded-full bg-flame" aria-hidden />
                OpenAI-compatible API
              </span>

              <h1 className="mt-5 text-balance text-[38px] font-semibold leading-[1.03] tracking-[-0.035em] text-warm sm:text-[52px] lg:text-[62px]">
                One API.
                <br />
                Every Model.
              </h1>

              <p className="mt-4 text-[15px] font-medium text-warm/85 max-[899px]:mt-5 max-[899px]:text-[16.5px] sm:text-[17px]">Connect once. Route smarter.</p>

              <p className="mt-2.5 max-w-[520px] text-[13.5px] leading-6 text-ash max-[899px]:mt-3 max-[899px]:text-[15px] max-[899px]:leading-7 sm:text-[14px]">
                A single gateway for DeepSeek, GLM, Kimi and Claude. Smart routing, key management and spend
                visibility — without wiring four providers into your stack.
              </p>

              <div className="aethink-hero-cta-row mt-6 max-[899px]:mt-7 max-[899px]:flex-col max-[899px]:items-stretch max-[899px]:gap-2.5">
                <Button
                  variant="primary"
                  size="lg"
                  className="aethink-hero-cta aethink-hero-cta--primary max-[899px]:w-full"
                  trailingIcon={<ArrowRight size={16} />}
                  onClick={() => navigate("/login")}
                >
                  Get API Key
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="aethink-hero-cta aethink-hero-cta--secondary max-[899px]:w-full"
                  leadingIcon={<Boxes size={15} />}
                  onClick={() => document.getElementById("models")?.scrollIntoView({ behavior: "smooth" })}
                >
                  Explore Models
                </Button>
              </div>

              <p className="mt-3 text-[11.5px] text-dim">
                Pay as you go · QRIS · API key issued in Telegram
              </p>
            </div>

            <SignalNexus routes={enabledModels.length} />
          </div>

        </section>

        <section className="mx-auto max-w-[1320px] px-4 pb-10 sm:px-6">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[1.05fr_1fr]">
            <div ref={revealLeft} className="space-y-6">
              <FeatureStrip />
              <KpiStrip models={enabledModels} status={status} />
              <div id="models" className="scroll-mt-24">
                <PopularModels models={enabledModels} />
              </div>
            </div>
            <div id="terminal" ref={revealPreview} className="min-w-0 scroll-mt-24 space-y-3">
              <TerminalPreview />
            </div>
          </div>
        </section>

        <div ref={revealPricing} className="mx-auto max-w-[1320px] px-4 pb-14 sm:px-6">
          <PricingPreview />
        </div>

        <div className="mx-auto max-w-[1320px] px-4 pb-16 sm:px-6">
          <FullModelCatalog models={enabledModels} />
        </div>

        <section className="border-t border-ash/10 bg-[linear-gradient(180deg,#101113_0%,#0C0D0F_100%)]">
          <div className="mx-auto max-w-[1320px] px-4 py-12 sm:px-6 sm:py-14">
            <div className="flex flex-col items-start justify-between gap-5 min-[900px]:flex-row min-[900px]:items-center">
              <div>
                <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-warm">
                  Ship your first routed request today
                </h2>
                <p className="mt-2 max-w-[52ch] text-[13px] leading-6 text-ash">
                  Create a key, send one request, and watch the spend land in your ledger — every provider behind
                  one endpoint.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 max-[899px]:w-full max-[899px]:flex-col max-[899px]:items-stretch max-[899px]:gap-1">
                <Button
                  variant="primary"
                  className="cta-landing shrink-0 max-[899px]:w-full"
                  onClick={() => navigate("/login")}
                  trailingIcon={<ArrowRight size={15} />}
                >
                  Get a key
                </Button>
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="group inline-flex h-11 items-center gap-1.5 px-1 text-[13.5px] font-medium text-warm/85 transition hover:text-warm max-[899px]:justify-center"
                >
                  Sign in
                  <ArrowRight
                    size={14}
                    aria-hidden
                    className="text-ash transition-transform group-hover:translate-x-0.5 group-hover:text-flame"
                  />
                </button>
              </div>
            </div>

            <footer className="mt-10 border-t border-ash/10 sm:mt-12">
              <div className="flex flex-col gap-6 py-7 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Wordmark compact className="[&_span.block]:text-[15px]" />
                  <span className="hidden h-4 w-px bg-ash/20 sm:block" aria-hidden />
                  <span className="text-[11.5px] text-dim">© {new Date().getFullYear()}</span>
                </div>
                <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-0">
                  {[
                    { label: "Models", href: "#catalog" },
                    { label: "Pricing", href: "#pricing" },
                    { label: "Playground", href: "#terminal" },
                  ].map((item) => (
                    <a
                      key={item.label}
                      href={item.href}
                      className="flex h-9 items-center text-[12.5px] text-ash transition hover:text-warm max-sm:h-11"
                    >
                      {item.label}
                    </a>
                  ))}
                  <Link
                    to="/login"
                    className="flex h-9 items-center text-[12.5px] text-ash transition hover:text-warm max-sm:h-11"
                  >
                    Sign in
                  </Link>
                  <a
                    href="mailto:support@aethink.ai"
                    className="flex h-9 items-center text-[12.5px] text-ash transition hover:text-warm max-sm:h-11"
                  >
                    Contact
                  </a>
                </nav>
              </div>
              <div className="flex flex-col gap-1 border-t border-ash/10 py-4 text-[11px] text-dim sm:flex-row sm:items-center sm:justify-between">
                <span className="font-mono">api.aethink.ai/v1</span>
                <span>Jakarta · WIB · UTC+7</span>
              </div>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
