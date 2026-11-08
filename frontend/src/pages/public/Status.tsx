import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowLeft, CircleDot, Gauge, Server, Timer } from "lucide-react";
import type { LandingStatus } from "@/lib/landing-data";
import { apiStream } from "@/lib/gw";
import { cn } from "@/lib/cn";

const BASE = "https://router.aethink.ai.id";

function when(iso: string | null): string {
  if (!iso) return "belum ada";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function StatusPage() {
  const [status, setStatus] = useState<LandingStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch(`${BASE}/api/status`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as LandingStatus;
        if (!alive) return;
        setStatus(body);
        setErr(null);
        setAt(new Date());
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "gagal memuat status");
      }
    };
    void pull();
    // push: the gateway emits `status` when traffic lands, so counters move within ~2s
    const offStream = apiStream({ status: () => void pull() });
    // polling stays as a net if the stream drops (proxy, sleep, mobile network)
    const timer = window.setInterval(() => document.visibilityState === "visible" && void pull(), 30_000);
    return () => {
      alive = false;
      offStream();
      window.clearInterval(timer);
    };
  }, []);

  const ok = status?.status === "operational";
  const models = status?.models ?? [];
  const windowMinutes = status?.window_minutes ?? 15;
  const windowRequests = status?.window_requests ?? 0;
  const hasWindowData = windowRequests > 0;

  const verdict = !status
    ? "Status belum dapat dipastikan"
    : ok
      ? "Seluruh layanan terpantau normal"
      : "Performa layanan menurun";

  const uptime = status?.uptime_seconds ?? 0;
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#FAF8F4]">
      <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-[#85888B] transition hover:text-[#E7893C]">
              <ArrowLeft size={13} /> Beranda
            </Link>
            <Link to="/panduan" className="text-[12.5px] text-[#85888B] transition hover:text-[#E7893C]">
              Dokumentasi
            </Link>
          </div>
          <span className="text-[12px] text-[#FAF8F4]/70">Status Layanan</span>
        </div>

        <header className="mt-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#E7893C]">Status Layanan</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">Kondisi Operasional Gateway</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]",
                !status
                  ? "border-[#3A3B3D] bg-[#22242a] text-[#85888B]"
                  : ok
                    ? "border-[#E7893C]/45 bg-[#E7893C]/10 text-[#E7893C]"
                    : "border-[#c4633a]/45 bg-[#c4633a]/10 text-[#e79c78]",
              )}
            >
              <CircleDot size={11} /> {verdict}
            </span>
          </div>
          <p className="mt-2 max-w-[680px] text-[13px] leading-6 text-[#85888B]">
            Pantau ketersediaan layanan, aktivitas permintaan, dan performa model AethinkAI berdasarkan data pemantauan
            terbaru. Data aktivitas diperbarui melalui pembaruan gateway dan pemeriksaan berkala setiap 30 detik sebagai
            cadangan
            {at ? (
              <>
                . <span className="text-[#a9a49c]">Terakhir diperbarui: {at.toLocaleTimeString("id-ID")}</span>
              </>
            ) : (
              "."
            )}
          </p>
        </header>

        {err ? (
          <p className="mt-4 rounded-lg border border-[#c4633a]/35 bg-[#c4633a]/10 px-3 py-2 text-[12.5px] text-[#e79c78]">
            Status gagal dimuat: {err}. Ini berarti masalah jaringan atau gateway, bukan berarti layanan mati.
          </p>
        ) : null}

        <div className="mt-6">
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">24 Jam Terakhir</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: <Activity size={14} />,
                label: "Total Permintaan",
                value: status ? compact(status.requests_24h) : "—",
              },
              {
                icon: <Gauge size={14} />,
                label: "Tingkat Keberhasilan",
                value: status ? `${status.success_rate.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%` : "—",
              },
              {
                icon: <Timer size={14} />,
                label: "Latensi P95",
                value: status?.p95_latency_ms ? `${status.p95_latency_ms.toLocaleString("id-ID")} ms` : "—",
              },
              {
                icon: <Server size={14} />,
                label: "Model Aktif",
                value: status ? String(status.models_active) : "—",
              },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
                <div className="flex items-center gap-1.5 text-[#85888B]">
                  {kpi.icon}
                  <span className="text-[10.5px] uppercase tracking-[0.12em]">{kpi.label}</span>
                </div>
                <p className="mt-2 font-mono text-[20px] text-[#FAF8F4]">{kpi.value}</p>
              </div>
            ))}
          </div>
        </div>

        <section className="mt-6 rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
          <h2 className="text-[13px] font-semibold text-[#FAF8F4]">Aktivitas {windowMinutes} Menit Terakhir</h2>
          <div className="mt-2 grid gap-3 text-[12.5px] text-[#a9a49c] sm:grid-cols-3">
            <p>
              Total Permintaan: <span className="font-mono text-[#FAF8F4]">{windowRequests}</span>
            </p>
            <p>
              Tingkat Error:{" "}
              <span className="font-mono text-[#FAF8F4]">
                {hasWindowData
                  ? `${(status?.window_error_pct ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`
                  : "Tidak ada data"}
              </span>
            </p>
            <p>
              Permintaan Terakhir:{" "}
              <span className="font-mono text-[#FAF8F4]">{when(status?.last_request_at ?? null)}</span>
            </p>
          </div>
          {!hasWindowData ? (
            <p className="mt-2 text-[11.5px] leading-5 text-[#6f6a63]">
              Belum ada permintaan dalam {windowMinutes} menit terakhir.
            </p>
          ) : null}
          <p className="mt-2 text-[11.5px] leading-5 text-[#6f6a63]">
            Status performa dievaluasi berdasarkan aktivitas dalam jendela {windowMinutes} menit terakhir. Kondisi
            menurun ditandai jika terdapat setidaknya 10 permintaan dalam jendela tersebut dan tingkat error melebihi 5%.
            Jumlah sampel yang kecil belum cukup untuk menyimpulkan kualitas layanan.
          </p>
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-[#3A3B3D] bg-[#1B1C1F]">
          <div className="border-b border-white/8 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[#FAF8F4]">Aktivitas per Model</h2>
            <p className="mt-1 text-[11.5px] text-[#6f6a63]">
              Ringkasan permintaan, penggunaan token, kegagalan, dan latensi setiap model dalam 24 jam terakhir.
              {status && models.length > 0 && models.length < status.models_active
                ? " Menampilkan model dengan aktivitas terbanyak."
                : ""}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left">
              <thead>
                <tr className="border-b border-white/8 text-[10.5px] uppercase tracking-[0.1em] text-[#85888B]">
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 text-right font-medium">Permintaan</th>
                  <th className="px-4 py-2 text-right font-medium">Token</th>
                  <th className="px-4 py-2 text-right font-medium">Error</th>
                  <th className="px-4 py-2 text-right font-medium">Latensi P95</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23252A] font-mono text-[11.5px]">
                {models.map((m) => (
                  <tr key={m.model_id}>
                    <td className="px-4 py-2 text-[#FAF8F4]">{m.model_id}</td>
                    <td className="px-4 py-2 text-right text-[#a9a49c]">{m.requests.toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2 text-right text-[#a9a49c]">{compact(m.tokens)}</td>
                    <td className={cn("px-4 py-2 text-right", m.errors ? "text-[#e79c78]" : "text-[#a9a49c]")}>
                      {m.errors}
                    </td>
                    <td className="px-4 py-2 text-right text-[#a9a49c]">
                      {m.p95_latency_ms ? `${m.p95_latency_ms.toLocaleString("id-ID")} ms` : "—"}
                    </td>
                  </tr>
                ))}
                {!models.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center font-sans text-[#85888B]">
                      Belum ada aktivitas model dalam periode ini.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="border-t border-white/8 px-4 py-2.5 text-[11px] text-[#6f6a63]">
            Statistik mengikuti permintaan yang tercatat dan diperbarui secara otomatis.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
          <h2 className="text-[13px] font-semibold text-[#FAF8F4]">Waktu Aktif Gateway</h2>
          <p className="mt-1.5 font-mono text-[18px] text-[#FAF8F4]">
            {uptimeHours} jam {uptimeMinutes} menit
          </p>
          <p className="mt-1.5 text-[11.5px] leading-5 text-[#6f6a63]">
            Durasi proses gateway sejak deployment atau restart terakhir. Penghitungan dimulai ulang setiap kali proses
            dijalankan kembali. Angka ini bukan ukuran uptime atau SLA bulanan; untuk evaluasi ketersediaan jangka
            panjang, gunakan hasil monitoring uptime eksternal.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link to="/panduan" className="inline-flex h-9 items-center rounded-lg bg-[#E7893C] px-3 text-[12.5px] font-semibold text-[#18191B]">
            Lihat Dokumentasi
          </Link>
          <Link to="/" className="inline-flex h-9 items-center rounded-lg border border-[#3A3B3D] px-3 text-[12.5px] text-[#FAF8F4]/85">
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    </div>
  );
}
