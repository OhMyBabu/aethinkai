import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, Loader2, QrCode, RefreshCw, ShieldCheck, Timer } from "lucide-react";
import { payStatus, type PayPayload } from "@/lib/portal";
import { Wordmark } from "@/components/layout/BrandLogo";
import { cn } from "@/lib/cn";

/** QRIS checkout — reached from the bot ("Bayar di web") or right after a web purchase. */
const idr = (micro: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(Math.round(micro / 1_000_000));

const mmss = (ms: number) => {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function PayPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";

  const [pay, setPay] = useState<PayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!orderId || !token) {
      setError("Link pembayaran tidak lengkap. Buka ulang dari bot Telegram.");
      setBusy(false);
      return;
    }
    try {
      setPay(await payStatus(orderId, token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat pembayaran");
    } finally {
      setBusy(false);
    }
  }, [orderId, token]);

  useEffect(() => { void load(); }, [load]);

  // poll only while the transaction can still change
  useEffect(() => {
    const pending = !pay || pay.status === "pending";
    if (!pending) return;
    const id = window.setInterval(() => { void load(); }, 6000);
    return () => window.clearInterval(id);
  }, [load, pay]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expiresIn = useMemo(() => {
    if (!pay?.expires_at) return null;
    return new Date(pay.expires_at).getTime() - now;
  }, [pay?.expires_at, now]);

  const paid = pay?.status === "paid" || pay?.status === "granted";
  const expired = pay?.status === "expired" || (expiresIn !== null && expiresIn <= 0 && !paid);

  const copyQr = async () => {
    if (!pay?.qr_string) return;
    try {
      await navigator.clipboard.writeText(pay.qr_string);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the image still works */ }
  };

  return (
    <div className="min-h-dvh bg-[#18191B] text-[#FAF8F4]">
      <header className="border-b border-[#2A2B2E]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Wordmark />
          <Link to="/portal" className="flex items-center gap-1.5 text-[12px] text-[#85888B] transition hover:text-[#FAF8F4]">
            <ArrowLeft size={14} /> Portal
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-[#3A3B3D] bg-[#1B1C1F] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#85888B]">Pembayaran QRIS</p>
              <h1 className="mt-1 font-mono text-[13px] text-[#FAF8F4]">{orderId || "—"}</h1>
            </div>
            <span className={cn("rounded-md px-2 py-1 text-[11px] font-semibold",
              paid ? "bg-[#E7893C]/15 text-[#E7893C]"
                : expired ? "bg-red-500/10 text-red-400"
                : "bg-[#FAF8F4]/6 text-[#85888B]")}>
              {paid ? "LUNAS" : expired ? "KEDALUWARSA" : "MENUNGGU PEMBAYARAN"}
            </span>
          </div>

          {busy && !pay ? (
            <div className="mt-10 flex items-center justify-center gap-2 text-[12px] text-[#85888B]">
              <Loader2 size={14} className="animate-spin" /> Memuat…
            </div>
          ) : error ? (
            <p className="mt-6 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
              {error}
            </p>
          ) : pay && paid ? (
            <div className="mt-8 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#E7893C]/15">
                <Check size={26} className="text-[#E7893C]" />
              </div>
              <p className="mt-4 text-[15px] font-semibold">Pembayaran diterima</p>
              <p className="mt-1 text-[12px] leading-5 text-[#85888B]">
                API key dikirim ke chat Telegram kamu. Kalau belum muncul, buka bot → <b>Key Saya</b>.
              </p>
              <a href="https://t.me/AethinkBot" className="mt-4 inline-flex h-9 items-center rounded-lg bg-[#E7893C] px-4 text-[12.5px] font-semibold text-[#18191B]">
                Buka Telegram
              </a>
            </div>
          ) : pay ? (
            <div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr]">
              <div className="rounded-xl border border-[#3A3B3D] bg-white p-2">
                {pay.qr_image ? (
                  <img src={pay.qr_image} alt="QRIS" className="h-full w-full rounded-lg object-contain" />
                ) : (
                  <div className="grid aspect-square place-items-center text-[#85888B]"><QrCode size={40} /></div>
                )}
              </div>
              <div>
                <p className="text-[11px] text-[#85888B]">Nominal transfer</p>
                <p className="text-2xl font-semibold tabular-nums text-[#E7893C]">{idr((pay.total_bayar || pay.amount_idr) * 1_000_000)}</p>
                {pay.fee_idr ? (
                  <p className="mt-1 text-[11px] leading-5 text-[#85888B]">
                    {idr(pay.amount_idr * 1_000_000)} kredit + {idr(pay.fee_idr * 1_000_000)} biaya QRIS.
                    Bayar <b>tepat</b> nominal ini.
                  </p>
                ) : null}

                <div className="mt-4 flex items-center gap-2 text-[11.5px] text-[#85888B]">
                  <Timer size={13} />
                  {expiresIn !== null && !expired
                    ? <span>Berlaku <b className="text-[#FAF8F4]">{mmss(expiresIn)}</b> lagi</span>
                    : <span>{expired ? "QR sudah kedaluwarsa" : "—"}</span>}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void load()}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-[#3A3B3D] px-3 text-[12px] text-[#FAF8F4] transition hover:bg-[#232426]">
                    <RefreshCw size={13} /> Cek status
                  </button>
                  {pay.qr_string ? (
                    <button type="button" onClick={() => void copyQr()}
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-[#3A3B3D] px-3 text-[12px] text-[#FAF8F4] transition hover:bg-[#232426]">
                      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Tersalin" : "Copy QR string"}
                    </button>
                  ) : null}
                </div>

                {pay.trx_reference ? (
                  <p className="mt-4 font-mono text-[10.5px] text-[#85888B]">Ref {pay.trx_reference}</p>
                ) : null}
                {expired ? (
                  <p className="mt-3 rounded-lg border border-[#E7893C]/35 bg-[#E7893C]/10 px-3 py-2 text-[11.5px] leading-5 text-[#E7893C]">
                    QR ini sudah lewat masa berlaku. Buat order baru dari bot / portal untuk QR baru.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="mt-6 flex items-start gap-1.5 border-t border-[#2A2B2E] pt-4 text-[10.5px] leading-4 text-[#85888B]">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" />
            Status pembayaran diverifikasi langsung ke penyedia QRIS, bukan dari browser. Key hanya
            dikirim ke Telegram pemilik akun.
          </p>
        </div>

        {pay?.tutorial ? (
          <details className="mt-3 rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-[#FAF8F4]">Cara bayar QRIS</summary>
            <pre className="mt-2 whitespace-pre-wrap text-[11.5px] leading-5 text-[#85888B]">{pay.tutorial}</pre>
          </details>
        ) : null}
      </main>
    </div>
  );
}
