import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/common/Button";
import { useStore } from "@/data/store";
import { isValidEmail } from "@/lib/auth";
import { login as gwLogin } from "@/lib/gw";

export default function LoginPage() {
  const { signIn } = useStore();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { next?: string } };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const locked = useMemo(() => Date.now() < lockedUntil, [lockedUntil]);
  const lockedSeconds = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length === 0) {
      setError("Enter your password.");
      return;
    }
    if (Date.now() < lockedUntil) {
      setError(`Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`);
      return;
    }

    setBusy(true);
    try {
      const { user } = await gwLogin(cleanEmail, password, needsTotp ? totp.trim() : undefined);
      const fixtureId = user.role === "admin" ? "usr_admin" : "usr_001";
      signIn(fixtureId);
      const fallback = user.role === "admin" ? "/admin/overview" : "/app/overview";
      navigate(location.state?.next ?? fallback, { replace: true });
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "totp_required" || code === "bad_totp") {
        // password was accepted; the account has a second factor
        setNeedsTotp(true);
        setError(code === "bad_totp" ? "Kode authenticator salah atau sudah dipakai." : null);
        setBusy(false);
        return;
      }
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) {
        setLockedUntil(Date.now() + 15_000);
        setAttempts(0);
        setError("Too many attempts. Locked for 15 seconds.");
      } else {
        setError((err as Error).message || "Email or password is incorrect.");
      }
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="Email + password hanya untuk operator panel. Pembeli masuk lewat Telegram."
      footer={
        <>
          Beli paket?{" "}
          <Link to="/login" className="-my-2 inline-flex h-11 items-center font-medium text-flame hover:underline">
            Masuk dengan Telegram
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-warm/85">Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 text-[13.5px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-warm/85">
            Password
            <a
              href="mailto:support@aethink.ai?subject=Password%20reset%20request"
              className="-my-2 inline-flex h-11 items-center px-1 text-[12px] font-normal text-ash hover:text-warm"
            >
              Forgot password?
            </a>
          </span>
          <span className="relative block">
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 pr-11 text-[13.5px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
            />
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-0 top-0 grid size-11 place-items-center rounded-lg text-ash transition active:scale-95 hover:text-warm"
            >
              {show ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
            </button>
          </span>
        </label>

        {needsTotp ? (
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-warm/85">
              Kode authenticator
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              autoFocus
              className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 font-mono text-[15px] tracking-[0.3em] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
            />
            <span className="mt-1.5 block text-[11px] text-ash">
              Password sudah benar, masukkan 6 digit dari aplikasi authenticator.
            </span>
          </label>
        ) : null}

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-[#c4633a]/30 bg-[#c4633a]/10 px-3 py-2 text-[12px] text-[#e79c78]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {error}
            {locked ? ` (${lockedSeconds}s)` : ""}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {busy ? "Signing in…" : "Sign in"}
          {!busy ? <ArrowRight size={14} aria-hidden /> : null}
        </Button>

        <p className="text-center text-[11.5px] leading-5 text-dim">
          Authenticated by the AethinkAI gateway. The session token stays in this browser.
        </p>
      </form>
    </AuthShell>
  );
}