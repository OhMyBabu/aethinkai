import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/common/Button";
import { BrandLogo } from "@/components/layout/BrandLogo";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-charcoal px-6 text-center">
      <BrandLogo size={44} />
      <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.3em] text-flame">404 · signal lost</p>
      <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.02em] text-warm sm:text-[32px]">
        This route is not in the nexus
      </h1>
      <p className="mt-2 max-w-md text-[13px] leading-6 text-ash">
        The page you requested does not exist. Return to the landing page or open your workspace.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/">
          <Button variant="primary" leadingIcon={<ArrowLeft size={14} />}>
            Back to landing
          </Button>
        </Link>
        <Link to="/login">
          <Button variant="secondary">Open dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
