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

function CopyButton({ value, label = "Copy", block }: { value: string; label?: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={
        block
          ? "flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[linear-gradient(180deg,#E7893C,#9C542F)] text-[13px] font-semibold text-[#18191B] transition active:scale-[0.985]"
          : "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ash/25 px-2.5 py-1 text-[11px] text-ash transition hover:border-flame/45 hover:text-warm"
      }
    >
      {copied ? <Check size={block ? 14 : 11} className={block ? undefined : "text-flame"} /> : <Copy size={block ? 14 : 11} />}
      {copied ? (block ? "Tersalin" : "Copied") : label}
    </button>
  );
}

export function BansosPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<BansosSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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

  return (
    <motion.div
      {...panelMotion}
      role="region"
      aria-label="Bansos"
      style={{ borderColor: "#3A3B3D" }}
      className="absolute left-1/2 top-[54px] z-50 mt-2 max-h-[calc(100vh-4rem)] w-[min(880px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto rounded-xl border bg-[#222325] shadow-[0_20px_48px_-20px_rgba(0,0,0,0.85)]"
    >
      <div className="grid w-full min-w-0 gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* ---------------------------------------------------------- monitor */}
        <div>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-flame">
              <Gift size={12} aria-hidden /> Bansos publik
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup bansos"
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm"
            >
              <X size={14} />
            </button>
          </div>

          <h3 className="mt-3 text-[19px] font-semibold tracking-[-0.02em] text-warm">
            {data.program ? data.program.name : "Bansos belum dibuka"}
          </h3>
          <p className="mt-1 text-[12.5px] leading-5 text-ash">
            Satu key untuk semua orang. Kreditnya dipakai bareng — rebutan, dan habis bareng.
          </p>

          <div className="mt-5 rounded-2xl border border-ash/15 bg-[#111214] p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.16em] text-ash/70">Sisa kredit bansos</p>
                <p className="mt-1 font-sans text-[30px] font-semibold leading-none tracking-[-0.03em] text-warm tabular-nums">
                  {rupiah(data.remaining_micro)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                aria-label="Muat ulang monitor"
                className="grid size-9 cursor-pointer place-items-center rounded-lg border border-ash/20 text-ash transition hover:border-ash/35 hover:text-warm"
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
              </button>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-warm/[0.08]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#9C542F,#E7893C)] transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
              <div>
                <p className="text-ash/60">Total</p>
                <p className="text-warm">{rupiah(data.total_micro)}</p>
              </div>
              <div>
                <p className="text-ash/60">Terpakai</p>
                <p className="text-warm">{rupiah(data.used_micro)}</p>
              </div>
              <div>
                <p className="text-ash/60">Request</p>
                <p className="text-warm">{data.stats.requests.toLocaleString("id-ID")}</p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-ash/70">Model yang termasuk</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(data.program?.models ?? []).length ? (
                data.program?.models.map((model) => (
                  <span
                    key={model}
                    className="rounded-md border border-ash/20 bg-warm/[0.03] px-2 py-1 font-mono text-[10.5px] text-ash"
                  >
                    {model}
                  </span>
                ))
              ) : (
                <span className="text-[11.5px] text-ash/60">Semua model berharga</span>
              )}
            </div>
            <p className="mt-3 text-[11.5px] text-ash/60">
              Token terpakai: {formatCompact(data.stats.tokens_in + data.stats.tokens_out)}
            </p>
          </div>

          {error ? <p className="mt-3 text-[12px] text-[#e08a5f]">{error}</p> : null}
        </div>

        {/* -------------------------------------------------------- shared key */}
        <div className="min-w-0 lg:border-l lg:border-ash/12 lg:pl-7">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ash">
            <KeyRound size={12} aria-hidden /> API key bersama
          </p>

          {data.shared_key ? (
            <>
              <div className="mt-3 rounded-xl border border-flame/30 bg-flame/[0.06] p-3.5">
                <p className="text-[10.5px] uppercase tracking-[0.16em] text-flame">Key aktif</p>
                <p className="mt-1.5 break-all font-mono text-[13px] leading-6 text-warm">
                  {data.shared_key.masked}
                </p>
                <div className="mt-3">
                  <CopyButton value={data.shared_key.key} label="Copy API key" block />
                </div>
                <p className="mt-2 text-[10.5px] leading-4 text-ash/60">
                  dibuat {relativeTime(data.shared_key.created_at)}
                  {data.shared_key.last_used_at
                    ? ` · terakhir dipakai ${relativeTime(data.shared_key.last_used_at)}`
                    : " · belum dipakai"}
                </p>
              </div>

              <div className="mt-3 space-y-1.5 rounded-xl border border-ash/15 bg-[#111214] p-3 text-[11.5px] text-ash">
                <p className="text-warm">Satu key, semua orang.</p>
                <p>
                  Siapa pun yang pegang key ini ikut menghabiskan kuota yang sama. Kalau kreditnya habis, semua
                  berhenti sampai admin menambah saldo atau merotasi key.
                </p>
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-ash/20 px-3 py-6 text-center">
              <p className="text-[12.5px] text-ash">Belum ada key bansos.</p>
              <p className="mt-1 text-[11.5px] text-ash/60">Aktifkan program bansos dulu di dashboard admin.</p>
            </div>
          )}

          <div className="mt-4 rounded-xl border border-ash/15 bg-[#111214] p-3">
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-ash/70">Base URL</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] leading-5 text-flame">
                {window.location.origin}/v1
              </code>
              <CopyButton value={`${window.location.origin}/v1`} />
            </div>
            <pre className="mt-2 w-full min-w-0 whitespace-pre-wrap break-all rounded-lg bg-[#0f1012] p-2.5 font-mono text-[10.5px] leading-5 text-warm/80">
{`curl ${window.location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${data.shared_key ? data.shared_key.key : "<key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${data.program?.models?.[0] ?? "deepseek-v4.1-flash-1017"}", "messages":[{"role":"user","content":"hi"}]}'`}
            </pre>
          </div>

          <p className="mt-3 text-[10.5px] leading-4 text-ash/50">
            Kredit bansos hanya dipakai kalau saldo wallet kosong, dan cuma untuk model di daftar kiri.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
