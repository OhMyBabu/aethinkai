import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Check, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/common/Button";
import { useToast } from "@/components/common/Toast";
import { useStore } from "@/data/store";
import { PASSWORD_MIN, hashPassword, isValidEmail, makeSalt, passwordChecks, passwordScore } from "@/lib/auth";
import { uid } from "@/lib/id";
import type { User } from "@/types";

const WELCOME_CREDITS = 25000;

export default function SignupPage() {
  const { state, signUp } = useStore();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checks = passwordChecks(password);
  const score = passwordScore(password);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2) return setError("Enter your full name.");
    if (!isValidEmail(cleanEmail)) return setError("Enter a valid email address.");
    if (state.users.some((user) => user.email.toLowerCase() === cleanEmail))
      return setError("An account with this email already exists. Sign in instead.");
    if (!checks.length) return setError(`Password must be at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError("Passwords do not match.");
    if (!accepted) return setError("Accept the terms to continue.");

    setBusy(true);
    const salt = makeSalt();
    const passwordHash = await hashPassword(password, salt);

    const account: User = {
      id: uid("usr"),
      name: cleanName,
      email: cleanEmail,
      role: "user",
      status: "active",
      credits: WELCOME_CREDITS,
      joinedAt: new Date().toISOString(),
      plan: "Starter",
      passwordHash,
      salt,
    };

    signUp(account, WELCOME_CREDITS);
    toast("Workspace created", {
      description: `Rp ${WELCOME_CREDITS.toLocaleString("id-ID")} trial credits added.`,
      variant: "success",
    });
    navigate("/app/overview", { replace: true });
  };

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="One key for DeepSeek, GLM, Kimi and Claude. No card needed to start."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="-my-2 inline-flex h-11 items-center font-medium text-flame hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-warm/85">Full name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder="Alya Prameswari"
            className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 text-[13.5px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-warm/85">Work email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@company.com"
            className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 text-[13.5px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-warm/85">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN} characters`}
            className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 text-[13.5px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
          <span className="mt-2 flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={`h-1 flex-1 rounded-full ${index < score ? "bg-flame" : "bg-ash/25"}`}
              />
            ))}
          </span>
          <span className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ash">
            {[
              ["length", `${PASSWORD_MIN}+ characters`],
              ["upper", "Uppercase letter"],
              ["number", "Number"],
              ["symbol", "Symbol"],
            ].map(([key, label]) => {
              const done = checks[key as keyof typeof checks];
              return (
                <span key={key} className={`flex items-center gap-1.5 ${done ? "text-warm/80" : ""}`}>
                  <Check size={11} className={done ? "text-flame" : "text-ash/40"} aria-hidden />
                  {label}
                </span>
              );
            })}
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-warm/85">Confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            placeholder="Repeat password"
            className="h-11 w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 text-[13.5px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
        </label>

        <label className="flex items-start gap-2.5 text-[12px] leading-5 text-ash">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[#e7893c]"
          />
          <span>
            I agree to the <span className="text-warm/85">Terms of Service</span> and{" "}
            <span className="text-warm/85">Privacy Policy</span>.
          </span>
        </label>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-[#c4633a]/30 bg-[#c4633a]/10 px-3 py-2 text-[12px] text-[#e79c78]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {busy ? "Creating workspace…" : "Create workspace"}
          {!busy ? <ArrowRight size={14} aria-hidden /> : null}
        </Button>
      </form>
    </AuthShell>
  );
}
