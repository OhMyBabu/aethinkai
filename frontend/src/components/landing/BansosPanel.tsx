import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, Gift, KeyRound, RefreshCw, X } from "lucide-react";
import { formatCompact, formatIDR, relativeTime } from "@/lib/format";

type BansosKey = {
  id: string;
  masked: string;
  key: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};

type BansosSnapshot = {
  program: { id: string; name: string; models: string[]; credit_idr: number } | null;
  programs?: number;
  total_micro: number;
  used_micro: number;
  remaining_micro: number;
  shared_key: BansosKey | null;
  keys: BansosKey[];
  stats: { requests: number; tokens_in: number; tokens_out: number };
};

const EMPTY: BansosSnapshot = {
  program: null,
  total_micro: 0,
  used_micro: 0,
  remaining_micro: 0,
  shared_key: null,
  keys: [],
  stats: { requests: 0, tokens_in: 0, tokens_out: 0 },
};

const rupiah = (micro: number) => {
  const value = Number(micro ?? 0) / 1_000_000;
  if (Math.abs(value) >= 1000) return formatIDR(value);
  return `Rp ${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
};

const panelMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
};

/** Copies exactly the string it was given — never the innerText of a wrapped node. */
function CopyButton({
  value,
  label = "Copy",
  block,
  disabled,
}: {
  value: string;
  label?: string;
  block?: boolean;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        navigator.clipboard?.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={
        block
          ? "flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[linear-gradient(180deg,#E7893C,#9C542F)] text-[13px] font-semibold text-[#18191B] transition active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45"
          : "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-ash/25 px-2.5 py-1 text-[11px] text-ash transition hover:border-flame/45 hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-ash/25 disabled:hover:text-ash"
      }
    >
      <span aria-live="polite" className="flex items-center gap-1.5">
        {copied ? (
          <Check size={block ? 14 : 11} className={block ? undefined : "text-flame"} />
        ) : (
          <Copy size={block ? 14 : 11} />
        )}
        {copied ? (block ? "Tersalin" : "Copied") : label}
      </span>
    </button>
  );
}

export function BansosPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<BansosSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bansos", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`bansos ${res.status}`);
      setData((await res.json()) as BansosSnapshot);
      setError(null);
    } catch {
      setError("Monitor bansos belum bisa dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const pct = useMemo(() => {
    if (!data.total_micro) return 0;
    return Math.min(100, (data.used_micro / data.total_micro) * 100);
  }, [data.total_micro, data.used_micro]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const baseUrl = `${origin}/v1`;
  const active = Boolean(data.program) && Boolean(data.shared_key);
  const sampleModel = data.program?.models?.[0] ?? "MODEL_ID";

  // The credential never enters the sample: it is an env var in the snippet, and
  // only the explicit Copy API key action hands over the real key.
  const snippet = `curl '${baseUrl}/chat/completions' \\
  -H 'Authorization: Bearer $BANSOS_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${sampleModel}",
    "messages": [{ "role": "user", "content": "Hi" }]
  }'`;

  return (
    <motion.div
      {...panelMotion}
      role="region"
      aria-label="Bansos"
      style={{ borderColor: "#3A3B3D" }}
      className="absolute left-1/2 top-[72px] z-50 mt-2 max-h-[calc(100dvh-92px)] w-[min(900px,calc(100vw-24px))] -translate-x-1/2 overflow-x-hidden overflow-y-auto rounded-xl border bg-[#222325] shadow-[0_20px_48px_-20px_rgba(0,0,0,0.85)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup bansos"
        className="absolute right-3 top-3 z-10 grid size-8 cursor-pointer place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
      >
        <X size={14} />
      </button>
      <div className="grid w-full min-w-0 gap-5 px-4 py-4 sm:gap-6 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        {/* ------------------------------------------------------ status + credit */}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3 pr-9">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-flame">
                <Gift size={12} aria-hidden /> Bansos publik
              </p>
              <h3 className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-warm sm:text-[20px]">
                {data.program ? data.program.name : "Bansos belum dibuka"}
              </h3>
              <p className="mt-1 text-[11.5px] leading-5 text-ash">
                {data.program
                  ? "Satu key bersama, satu kuota bersama. Kredit habis, semua berhenti."
                  : "Program belum diaktifkan. Angka di bawah masih nol sampai admin membukanya."}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-ash/15 bg-[#111214] p-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ash/70">Sisa kredit bansos</p>
                <p className="mt-1 font-sans text-[26px] font-semibold leading-none tracking-[-0.03em] text-warm tabular-nums sm:text-[30px]">
                  {rupiah(data.remaining_micro)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                aria-label="Muat ulang monitor"
                aria-busy={loading}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-ash/20 text-ash transition hover:border-ash/35 hover:text-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/40"
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
              </button>
            </div>

            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-warm/[0.08]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              aria-label="Kredit bansos terpakai"
            >
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#9C542F,#E7893C)] transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <p className="text-ash/65">Total</p>
                <p className="text-warm">{rupiah(data.total_micro)}</p>
              </div>
              <div>
                <p className="text-ash/65">Terpakai</p>
                <p className="text-warm">{rupiah(data.used_micro)}</p>
              </div>
              <div>
                <p className="text-ash/65">Request</p>
                <p className="text-warm tabular-nums">{data.stats.requests.toLocaleString("id-ID")}</p>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ash/70">Model yang termasuk</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(data.program?.models ?? []).length ? (
                data.program?.models.map((model) => (
                  <span
                    key={model}
                    className="max-w-full truncate rounded-md border border-ash/20 bg-warm/[0.03] px-2 py-1 font-mono text-[10.5px] text-ash"
                    title={model}
                  >
                    {model}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-ash/70">
                  Belum ada model — daftar muncul setelah Bansos aktif.
                </span>
              )}
            </div>
            <p className="mt-2.5 text-[11px] text-ash/70">
              Token terpakai: {formatCompact(data.stats.tokens_in + data.stats.tokens_out)}
            </p>
          </div>

          {error ? <p className="mt-3 text-[11.5px] text-[#e08a5f]">{error}</p> : null}
        </div>

        {/* --------------------------------------------- key, base URL, quickstart */}
        <div className="min-w-0 lg:border-l lg:border-ash/12 lg:pl-6">
          <div className="flex items-center justify-between gap-2 pr-9">
            <p className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-ash">
              <KeyRound size={12} aria-hidden /> API key bersama
            </p>
            <span
              className={
                active
                  ? "shrink-0 rounded-md border border-flame/30 bg-flame/[0.1] px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-flame"
                  : "shrink-0 rounded-md border border-ash/20 bg-warm/[0.03] px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-ash"
              }
            >
              {active ? "Aktif" : "Belum aktif"}
            </span>
          </div>

          {data.shared_key ? (
            <div className="mt-2.5 rounded-xl border border-flame/30 bg-flame/[0.06] p-3.5">
              <p className="break-all font-mono text-[12.5px] leading-5 text-warm">{data.shared_key.masked}</p>
              <div className="mt-2.5">
                <CopyButton value={data.shared_key.key} label="Copy API key" block />
              </div>
              <p className="mt-2 text-[10.5px] leading-4 text-ash/70">
                dibuat {relativeTime(data.shared_key.created_at)}
                {data.shared_key.last_used_at
                  ? ` · terakhir dipakai ${relativeTime(data.shared_key.last_used_at)}`
                  : " · belum dipakai"}
              </p>
            </div>
          ) : (
            <div className="mt-2.5 rounded-xl border border-dashed border-ash/20 px-3 py-4">
              <p className="text-[12px] font-medium text-warm/85">Belum ada key Bansos</p>
              <p className="mt-1 text-[11px] leading-4 text-ash/70">
                Program Bansos belum diaktifkan admin, jadi belum ada kredensial yang bisa dipakai.
              </p>
            </div>
          )}

          <div className="mt-3 rounded-xl border border-ash/15 bg-[#111214] p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ash/70">Base URL</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] leading-5 text-flame">
                {baseUrl}
              </code>
              <CopyButton value={baseUrl} />
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-ash/15 bg-[#111214] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-ash/70">Contoh request</p>
              <CopyButton value={snippet} label="Copy command" disabled={!active} />
            </div>
            <div className="mt-2 max-h-[200px] w-full min-w-0 overflow-auto overscroll-contain rounded-lg bg-[#0B0B0C]">
              <pre className="m-0 w-max min-w-full whitespace-pre p-2.5 font-mono text-[10.5px] leading-5 text-warm/80">
                {snippet}
              </pre>
            </div>
            {!active ? (
              <p className="mt-2 text-[10.5px] leading-4 text-ash/65">
                Contoh saja — belum bisa dipakai sampai Bansos aktif.
              </p>
            ) : null}
          </div>

          <p className="mt-2.5 text-[10.5px] leading-4 text-ash/60">
            Kredit bansos hanya dipakai kalau saldo wallet kosong, dan cuma untuk model di daftar kiri.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
