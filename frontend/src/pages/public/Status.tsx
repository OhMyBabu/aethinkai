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

  return (
    <div className="min-h-screen bg-[#18191B] text-[#FAF8F4]">
      <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-[#85888B] transition hover:text-[#E7893C]">
            <ArrowLeft size={13} /> Beranda
          </Link>
          <Link to="/panduan" className="inline-flex h-8 items-center rounded-lg border border-[#3A3B3D] px-3 text-[12px] text-[#FAF8F4]/80 transition hover:bg-[#22242a]">
            Dokumentasi
          </Link>
        </div>

        <header className="mt-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#E7893C]">Status layanan</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">Kondisi gateway sekarang</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]",
                ok ? "border-[#E7893C]/45 bg-[#E7893C]/10 text-[#E7893C]" : "border-[#c4633a]/45 bg-[#c4633a]/10 text-[#e79c78]",
              )}
            >
              <CircleDot size={11} /> {status ? (ok ? "operational" : "degraded") : "memuat…"}
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-[#85888B]">
            Verdikt diambil dari jendela {status?.window_minutes ?? 15} menit terakhir, bukan rata-rata 24 jam.
            Halaman ini menerima push dari gateway setiap ada request masuk (plus polling 30 detik sebagai cadangan)
            {at ? `, terakhir ${at.toLocaleTimeString("id-ID")}` : ""}.
          </p>
        </header>

        {err ? (
          <p className="mt-4 rounded-lg border border-[#c4633a]/35 bg-[#c4633a]/10 px-3 py-2 text-[12.5px] text-[#e79c78]">
            Status gagal dimuat: {err}. Ini berarti masalah jaringan atau gateway, bukan berarti layanan mati.
          </p>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <Activity size={14} />, label: "Request 24 jam", value: status ? compact(status.requests_24h) : "—" },
            { icon: <Gauge size={14} />, label: "Sukses 24 jam", value: status ? `${status.success_rate}%` : "—" },
            { icon: <Timer size={14} />, label: "p95 latency", value: status?.p95_latency_ms ? `${status.p95_latency_ms} ms` : "—" },
            { icon: <Server size={14} />, label: "Model aktif", value: status ? String(status.models_active) : "—" },
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

        <section className="mt-6 rounded-xl border border-[#3A3B3D] bg-[#1B1C1F] p-4">
          <h2 className="text-[13px] font-semibold text-[#FAF8F4]">Jendela {status?.window_minutes ?? 15} menit</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3 text-[12.5px] text-[#a9a49c]">
            <p>request: <span className="font-mono text-[#FAF8F4]">{status?.window_requests ?? 0}</span></p>
            <p>error: <span className="font-mono text-[#FAF8F4]">{status?.window_error_pct ?? 0}%</span></p>
            <p>request terakhir: <span className="font-mono text-[#FAF8F4]">{when(status?.last_request_at ?? null)}</span></p>
          </div>
          <p className="mt-2 text-[11.5px] leading-5 text-[#6f6a63]">
            Ambang degraded: minimal 10 request dalam jendela dan error di atas 5%. Di bawah sampel itu, dua error acak
            tidak cukup untuk menyatakan layanan bermasalah.
          </p>
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-[#3A3B3D] bg-[#1B1C1F]">
          <h2 className="border-b border-[#2A2B2E] px-4 py-3 text-[13px] font-semibold text-[#FAF8F4]">Per model · 24 jam</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-[#2A2B2E] text-[10.5px] uppercase tracking-[0.1em] text-[#85888B]">
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 text-right font-medium">Request</th>
                  <th className="px-4 py-2 text-right font-medium">Token</th>
                  <th className="px-4 py-2 text-right font-medium">Error</th>
                  <th className="px-4 py-2 text-right font-medium">p95</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23252A] font-mono text-[11.5px]">
                {models.map((m) => (
                  <tr key={m.model_id}>
                    <td className="px-4 py-2 text-[#FAF8F4]">{m.model_id}</td>
                    <td className="px-4 py-2 text-right text-[#a9a49c]">{m.requests}</td>
                    <td className="px-4 py-2 text-right text-[#a9a49c]">{compact(m.tokens)}</td>
                    <td className={cn("px-4 py-2 text-right", m.errors ? "text-[#e79c78]" : "text-[#a9a49c]")}>{m.errors}</td>
                    <td className="px-4 py-2 text-right text-[#a9a49c]">{m.p95_latency_ms ? `${m.p95_latency_ms} ms` : "—"}</td>
                  </tr>
                ))}
                {!models.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[#85888B]">
                      Belum ada trafik dalam 24 jam terakhir.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-6 text-[11.5px] leading-5 text-[#6f6a63]">
          Proses gateway berjalan {Math.floor((status?.uptime_seconds ?? 0) / 3600)} jam{" "}
          {Math.floor(((status?.uptime_seconds ?? 0) % 3600) / 60)} menit sejak deploy terakhir. Angka ini ikut reset
          setiap deploy, jadi bukan SLA bulanan — untuk SLA, lihat uptime eksternal.
        </p>
      </div>
    </div>
  );
}
