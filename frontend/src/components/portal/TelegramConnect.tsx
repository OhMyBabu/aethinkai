import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";
import { pollLink, startLink, type LinkStatus } from "@/lib/portal";

/**
 * Telegram connect widget. No email, no password: the buyer opens a deep link, the bot confirms
 * the account, the browser picks up the session by polling. One code = one session.
 */
export function TelegramConnect({
  onToken,
  compact = false,
}: {
  onToken: (token: string, status: LinkStatus) => void;
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "expired" | "error">("idle");
  const [link, setLink] = useState<{ code: string; deep_link: string; expires_in: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const tick = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    if (tick.current) window.clearInterval(tick.current);
    timer.current = null;
    tick.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const begin = useCallback(async () => {
    setError(null);
    setPhase("waiting");
    try {
      const started = await startLink();
      setLink(started);
      setSeconds(started.expires_in);
      tick.current = window.setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
      timer.current = window.setInterval(async () => {
        try {
          const status = await pollLink(started.code);
          if (status.status === "confirmed" && status.token) {
            stop();
            onToken(status.token, status);
          } else if (status.status === "consumed") {
            stop();
            setPhase("expired");
            setError("Kode ini sudah dipakai. Buat kode baru.");
          } else if (status.status === "expired") {
            stop();
            setPhase("expired");
            setError("Kode kedaluwarsa. Buat kode baru.");
          }
        } catch (err) {
          stop();
          setPhase("error");
          setError(err instanceof Error ? err.message : "Gagal cek status");
        }
      }, 2000);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Gagal menghubungkan");
    }
  }, [onToken, stop]);

  return (
    <div className="space-y-3">
      {phase === "idle" || phase === "error" ? (
        <>
          <button
            type="button"
            onClick={() => void begin()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#E7893C] text-[13.5px] font-semibold text-[#18191B] transition-colors hover:bg-[#F09A55]"
          >
            <Send size={15} /> Hubungkan Telegram
          </button>
          {!compact ? (
            <p className="text-[11.5px] leading-5 text-[#85888B]">
              Tanpa email, tanpa password. Akun diambil dari Telegram, jadi pembelian dan API key
              selalu nyambung ke chat lu.
            </p>
          ) : null}
        </>
      ) : null}

      {phase === "waiting" && link ? (
        <div className="space-y-3">
          <a
            href={link.deep_link}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#E7893C] text-[13.5px] font-semibold text-[#18191B] transition-colors hover:bg-[#F09A55]"
          >
            <ExternalLink size={15} /> Buka bot Telegram
          </a>
          <div className="rounded-lg border border-[#3A3B3D] bg-[#141518] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">Kode koneksi</p>
                <code className="mt-0.5 block break-all font-mono text-[11.5px] text-[#FAF8F4]">{link.code}</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(link.deep_link).catch(() => undefined);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-md border border-[#3A3B3D] text-[#FAF8F4]"
                aria-label="Salin link"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-5 text-[#85888B]">
              Tekan <b className="text-[#FAF8F4]">Start</b> di bot, lalu balik ke tab ini. Otomatis masuk
              dalam beberapa detik.
            </p>
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-[#85888B]">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Menunggu konfirmasi
            </span>
            <span className="tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
          </div>
        </div>
      ) : null}

      {phase === "expired" ? (
        <button
          type="button"
          onClick={() => void begin()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#3A3B3D] text-[13px] font-medium text-[#FAF8F4] transition hover:bg-[#292B2E]"
        >
          <RefreshCw size={14} /> Buat kode baru
        </button>
      ) : null}

      {error ? <p className="text-[12px] text-[#E7893C]">{error}</p> : null}
    </div>
  );
}
