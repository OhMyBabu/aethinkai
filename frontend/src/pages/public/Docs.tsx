import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Copy, Terminal } from "lucide-react";
import { apiStream, publicModels, type PublicModel } from "@/lib/gw";
import { fetchShop, type Pkg, type TopupPolicy } from "@/lib/portal";
import { cn } from "@/lib/cn";

const BASE = "https://router.aethink.ai.id";

function idr(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

function ctxLabel(tokens: number): string {
  if (!tokens) return "n/a";
  if (tokens >= 1_000_000) {
    const m = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${m % 1 === 0 ? m.toFixed(0) : m}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function CopyBlock({ code, label, copyLabel = "Salin kode" }: { code: string; label: string; copyLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative rounded-xl border border-white/12 bg-panel">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <span className="font-mono text-[12px] text-ash">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setDone(true);
            window.setTimeout(() => setDone(false), 1400);
          }}
          aria-label={done ? "Kode berhasil disalin" : copyLabel}
          className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2 py-1 text-[12px] text-warm/80 transition hover:bg-panel-2"
        >
          {done ? <Check size={11} /> : <Copy size={11} />} {done ? "Tersalin" : copyLabel}
          <span aria-live="polite" className="sr-only">
            {done ? "Kode berhasil disalin" : ""}
          </span>
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-5 text-warm/85">{code}</pre>
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-white/8 pt-8">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-warm">{title}</h2>
      <div className="mt-3 space-y-3 text-[13.5px] leading-7 text-ash">{children}</div>
    </section>
  );
}

const ERRORS: [string, string, string][] = [
  ["400", "invalid_json / missing_model", "Format JSON tidak valid atau parameter model belum disertakan."],
  ["400", "context_too_long", "Input melebihi batas konteks model. Kurangi panjang percakapan atau prompt."],
  ["401", "invalid_api_key", "API key tidak valid, telah dicabut, atau akun sedang ditangguhkan."],
  ["402", "insufficient_balance", "Saldo tidak mencukupi untuk memproses permintaan."],
  ["403", "model_not_allowed", "Model tidak diizinkan untuk akun Anda atau sedang dinonaktifkan."],
  ["404", "model_not_found", "ID model tidak ditemukan dalam katalog aktif."],
  ["429", "rate_limited", "Batas permintaan akun telah tercapai. Periksa Retry-After."],
  ["429", "gateway_busy", "Gateway sedang mencapai batas kapasitas. Coba kembali setelah beberapa saat."],
  ["502", "upstream_unavailable", "Provider tidak tersedia atau gagal memproses permintaan. Coba lagi atau gunakan model lain."],
  ["503", "model_maintenance", "Model sedang dalam pemeliharaan atau mengalami gangguan sementara."],
];

export default function DocsPage() {
  const [models, setModels] = useState<PublicModel[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [topup, setTopup] = useState<TopupPolicy>({ min_idr: 2000, max_idr: null, enabled: true });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    publicModels()
      .then((data) => alive && setModels(data.data))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "gagal memuat katalog"));
    const pullShop = () => {
      fetchShop()
        .then((shop) => {
          if (!alive) return;
          setPackages(shop.packages);
          setTopup(shop.topup);
        })
        .catch(() => undefined);
    };
    pullShop();
    const pullModels = () => {
      publicModels()
        .then((data) => alive && setModels(data.data))
        .catch(() => undefined);
    };
    // admin edits (price, package, status) reach the guide without a reload
    const offStream = apiStream({ catalog: () => { pullModels(); pullShop(); }, status: () => undefined });
    return () => {
      alive = false;
      offStream();
    };
  }, []);

  const solidModels = useMemo(() => models.filter((m) => (m.status ?? "on") === "on"), [models]);
  const quickModel = solidModels[0]?.id ?? models[0]?.id ?? "glm-5.3";

  const curl = `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer sk-aeth_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${quickModel}",
    "messages": [{"role": "user", "content": "Halo"}],
    "max_tokens": 256
  }'`;

  return (
    <div className="min-h-screen bg-charcoal text-warm">
      <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-ash transition hover:text-flame">
              <ArrowLeft size={13} /> Beranda
            </Link>
            <Link to="/status" className="text-[12.5px] text-ash transition hover:text-flame">
              Status Layanan
            </Link>
          </div>
          <span className="text-[12px] text-warm/70">Dokumentasi</span>
        </div>

        <header className="mt-8">
          <p className="text-[12px] text-flame">Dokumentasi</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">Satu API untuk Berbagai Model AI</h1>
          <p className="mt-2 max-w-[640px] text-[14px] leading-7 text-ash">
            Akses berbagai model AI melalui satu endpoint yang kompatibel dengan OpenAI API. Gunakan{" "}
            <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[12px]">base_url</code> dan{" "}
            <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[12px]">api_key</code> AethinkAI pada
            aplikasi yang sudah mendukung OpenAI API.
          </p>
          <p className="mt-2 max-w-[640px] text-[13.5px] leading-7 text-ash">
            Pembayaran menggunakan saldo prabayar dengan sistem <strong className="text-ash">Pay As You Go (PAYG)</strong>.
            Tidak ada biaya langganan bulanan atau biaya aktivasi model. Biaya penggunaan mengikuti jumlah token dan
            tarif masing-masing model.
          </p>
        </header>

        <div className="mt-8 space-y-8">
          <section className="rounded-xl border border-white/12 bg-panel p-5">
            <p className="text-[12px] text-ash">Informasi Koneksi</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[12px] text-ash">Base URL</p>
                <p className="mt-1 break-all font-mono text-[12.5px] text-warm">{BASE}/v1</p>
              </div>
              <div>
                <p className="text-[12px] text-ash">Autentikasi</p>
                <p className="mt-1 break-all font-mono text-[12.5px] text-warm">Authorization: Bearer sk-aeth_...</p>
              </div>
              <div>
                <p className="text-[12px] text-ash">Format</p>
                <p className="mt-1 font-mono text-[12.5px] text-warm">OpenAI-compatible Chat Completions</p>
              </div>
            </div>
          </section>

          <Section title="Mulai Integrasi" id="quickstart">
            <p>Kirim permintaan pertama menggunakan cURL atau OpenAI SDK untuk Python.</p>
            <p>
              API key diberikan melalui bot Telegram. Simpan dengan aman di environment variable atau secret manager.
              Jangan menaruh kredensial di repository, kode frontend, atau dokumen publik.
            </p>
            <CopyBlock label="cURL" code={curl} />
            <CopyBlock
              label="Python (OpenAI SDK)"
              code={`from openai import OpenAI

client = OpenAI(
    base_url="${BASE}/v1",
    api_key="sk-aeth_..."
)

response = client.chat.completions.create(
    model="${quickModel}",
    messages=[{"role": "user", "content": "Halo"}]
)

print(response.choices[0].message.content)`}
            />
            <p className="text-[12.5px] text-dim">
              Pastikan ID model masih tersedia dalam katalog aktif sebelum menjalankan contoh.
            </p>
          </Section>

          <Section title="Katalog Model dan Tarif" id="models">
            <p>
              Tarif dihitung per 1 juta token untuk input, output, dan input yang dilayani dari cache. Biaya aktual
              ditentukan berdasarkan pemakaian token serta tarif model yang berlaku saat permintaan diselesaikan.
            </p>
            {err ? <p className="text-bad">Katalog gagal dimuat: {err}</p> : null}
            <div className="overflow-x-auto rounded-xl border border-white/12">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-white/8 text-[12px] text-ash">
                    <th className="px-3 py-2 font-medium">Model / ID</th>
                    <th className="px-3 py-2 font-medium">Context Window</th>
                    <th className="px-3 py-2 text-right font-medium">Input / 1 Juta</th>
                    <th className="px-3 py-2 text-right font-medium">Output / 1 Juta</th>
                    <th className="px-3 py-2 text-right font-medium">Cache / 1 Juta</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252A] font-mono text-[12px]">
                  {models.map((m) => {
                    const status = m.status ?? "on";
                    return (
                      <tr key={m.id} className={cn(status !== "on" && "opacity-60")}>
                        <td className="px-3 py-2 text-warm">
                          {m.display_name}
                          <span className="ml-2 font-sans text-[12px] text-ash">{m.id}</span>
                        </td>
                        <td className="px-3 py-2 text-ash">{ctxLabel(m.context_length)}</td>
                        <td className="px-3 py-2 text-right text-warm">{m.pricing_idr_per_1m.input.toLocaleString("id-ID")}</td>
                        <td className="px-3 py-2 text-right text-ash">{m.pricing_idr_per_1m.output.toLocaleString("id-ID")}</td>
                        <td className="px-3 py-2 text-right text-ash">{m.pricing_idr_per_1m.cached_input.toLocaleString("id-ID")}</td>
                        <td className="px-3 py-2 text-right font-sans">
                          <span className={cn("rounded px-1.5 py-0.5 text-[12px]", status !== "on" ? "bg-bad/15 text-bad" : "bg-flame/12 text-flame")}>
                            {status === "on" ? "Aktif" : status === "maintenance" ? "Pemeliharaan" : "Tidak tersedia"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!models.length && !err ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center font-sans text-ash">Memuat katalog…</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="text-[12.5px] text-dim">
              Semua tarif dalam Rupiah (IDR). Harga dan ketersediaan model dapat berubah sesuai konfigurasi layanan.
              Data yang ditampilkan mengikuti katalog gateway aktif.
            </p>
          </Section>

          <Section title="Pembayaran dan Penggunaan Saldo" id="billing">
            <p>
              AethinkAI menggunakan saldo prabayar. Anda dapat mengisi saldo melalui QRIS dan menggunakannya untuk
              membayar permintaan API sesuai tarif model yang dipilih.
            </p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <strong className="text-warm/85">Isi saldo.</strong> Pilih paket kredit atau lakukan top-up sesuai
                ketentuan yang berlaku. Saldo tersimpan pada akun, bukan pada API key.
              </li>
              <li>
                <strong className="text-warm/85">Kirim permintaan.</strong> Gateway mencadangkan perkiraan biaya
                sebelum memproses request.
              </li>
              <li>
                <strong className="text-warm/85">Hitung penggunaan.</strong> Setelah request selesai, biaya aktual
                dihitung berdasarkan token yang digunakan.
              </li>
              <li>
                <strong className="text-warm/85">Sesuaikan saldo.</strong> Biaya akhir dibebankan dan selisih dana
                yang dicadangkan dikembalikan sesuai hasil perhitungan.
              </li>
            </ol>
            <p>
              Jika saldo tidak cukup, API mengembalikan <code className="font-mono text-[12px]">402 insufficient_balance</code>.
              Isi ulang saldo sebelum mengirim permintaan baru.
            </p>
            <p>
              Jika gateway mengembalikan <code className="font-mono text-[12px]">502 upstream_unavailable</code> untuk
              permintaan yang gagal diproses, reservasi biaya dilepaskan sesuai mekanisme billing yang berlaku.
            </p>
            <p>
              Tidak ada biaya langganan bulanan. Akses model tetap mengikuti status model, izin akun, dan ketersediaan
              saldo.
            </p>
            <h3 className="pt-1 text-[14px] font-semibold text-warm">Cek Saldo dan Pemakaian</h3>
            <p>Lihat saldo, riwayat penggunaan, dan informasi akun melalui Portal AethinkAI.</p>
            <CopyBlock
              label="Periksa akun · Buat sesi portal"
              code={`curl ${BASE}/api/portal/me \\
  -H "Authorization: Bearer <token-portal>"

# token portal didapat dari:
curl -X POST ${BASE}/api/portal/session \\
  -H "Content-Type: application/json" \\
  -d '{"api_key":"sk-aeth_..."}'`}
            />
          </Section>

          <Section title="Paket Kredit dan Rate Limit" id="limits">
            <p>
              Semua paket menggunakan batas standar <strong className="text-warm/85">60 permintaan per menit (RPM) per akun Telegram</strong>.
              Paket dengan nilai lebih besar menambah saldo, bukan meningkatkan batas RPM secara otomatis.
            </p>
            <div className="overflow-x-auto rounded-xl border border-white/12">
              <table className="w-full min-w-[440px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/8 text-[12px] text-ash">
                    <th className="px-3 py-2 font-medium">Paket</th>
                    <th className="px-3 py-2 text-right font-medium">Harga</th>
                    <th className="px-3 py-2 text-right font-medium">Kredit</th>
                    <th className="px-3 py-2 text-right font-medium">RPM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252A] text-ash">
                  {packages.map((pkg) => (
                    <tr key={pkg.sku}>
                      <td className="px-3 py-2 text-warm">
                        {pkg.name}
                        {pkg.blurb ? <span className="ml-1.5 text-[12px] text-ash">{pkg.blurb}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right">{idr(pkg.price_idr)}</td>
                      <td className="px-3 py-2 text-right">{idr(pkg.credits_micro / 1_000_000)}</td>
                      <td className="px-3 py-2 text-right font-mono">{pkg.rpm_limit}</td>
                    </tr>
                  ))}
                  {!packages.length ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-[12px] text-ash">
                        Paket sedang tidak tersedia, cek portal.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="text-[12.5px] text-dim">
              Batas standar tetap 60 RPM untuk seluruh paket.{" "}
              {topup.enabled
                ? `Top-up mulai ${idr(topup.min_idr)} menambah saldo tanpa mengubah RPM.`
                : "Top-up sedang ditutup; pembelian lewat paket."}
            </p>
            <p>
              Jika memerlukan RPM lebih tinggi, hubungi administrator untuk mengajukan penyesuaian khusus pada akun.
              Penyesuaian tersebut tidak otomatis berubah ketika Anda membeli paket lain.
            </p>

            <h3 className="pt-1 text-[14px] font-semibold text-warm">Respons Saat Batas Tercapai</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <code className="font-mono text-[12px]">429 rate_limited</code>, batas RPM akun telah tercapai.
              </li>
              <li>
                <code className="font-mono text-[12px]">429 gateway_busy</code>, kapasitas gateway sedang penuh.
                Kondisi ini tidak berarti kuota RPM akun Anda habis.
              </li>
            </ul>
            <p>
              Setiap balasan membawa <code className="font-mono text-[12px]">X-RateLimit-Limit</code>,{" "}
              <code className="font-mono text-[12px]">X-RateLimit-Remaining</code>, dan{" "}
              <code className="font-mono text-[12px]">X-RateLimit-Reset</code>. Jika menerima HTTP 429, ikuti nilai{" "}
              <code className="font-mono text-[12px]">Retry-After</code> jika disertakan. Hindari pengiriman ulang tanpa jeda.
            </p>
          </Section>

          <Section title="Kode Error API" id="errors">
            <p>Gunakan status HTTP dan kode error untuk mengenali penyebab kegagalan serta menentukan tindakan berikutnya.</p>
            <div className="overflow-x-auto rounded-xl border border-white/12">
              <table className="w-full min-w-[600px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/8 text-[12px] text-ash">
                    <th className="px-3 py-2 font-medium">HTTP</th>
                    <th className="px-3 py-2 font-medium">Kode</th>
                    <th className="px-3 py-2 font-medium">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252A]">
                  {ERRORS.map(([status, code, meaning]) => (
                    <tr key={code}>
                      <td className="px-3 py-2 font-mono text-ash">{status}</td>
                      <td className="px-3 py-2 font-mono text-warm">{code}</td>
                      <td className="px-3 py-2 text-ash">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Invoice dan Pengelolaan API Key" id="invoice">
            <h3 className="text-[14px] font-semibold text-warm">Riwayat Transaksi</h3>
            <p>
              Setiap pembelian kredit memiliki nomor invoice unik dengan format{" "}
              <code className="font-mono text-[12px]">AETH-YYYYMMDD-XXXX</code>. Informasi transaksi, kredit yang
              diterima, dan saldo setelah pembelian dapat dilihat melalui portal pengguna.
            </p>
            <h3 className="pt-1 text-[14px] font-semibold text-warm">Rotasi API Key</h3>
            <p>
              Setiap akun Telegram memiliki satu API key aktif. Pembelian paket atau top-up berikutnya menambahkan saldo
              ke akun yang sama tanpa membuat API key baru.
            </p>
            <p>
              Jika API key hilang atau diduga bocor, lakukan rotasi melalui Portal AethinkAI dengan verifikasi bot
              Telegram, atau gunakan perintah <code className="font-mono text-[12px]">/rotate</code> di bot. Setelah
              rotasi berhasil, API key lama tidak dapat digunakan lagi. Saldo dan riwayat transaksi akun tetap tersimpan.
            </p>
          </Section>

          <Section title="Siap Menggunakan AethinkAI?" id="cta">
            <p>Kelola API key, pantau saldo, dan tinjau penggunaan API dari satu portal.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/portal" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-flame px-3 text-[12.5px] font-semibold text-[#18191B]">
                <Terminal size={13} /> Buka Portal
              </Link>
              <Link to="/status" className="inline-flex h-9 items-center rounded-lg border border-white/12 px-3 text-[12.5px] text-warm/85">
                Lihat Status Layanan
              </Link>
            </div>
          </Section>
        </div>

        <p className="mt-10 border-t border-white/8 pt-5 text-[12px] text-dim">
          Informasi harga, paket, dan ketersediaan model mengikuti konfigurasi gateway yang aktif.
        </p>
      </div>
    </div>
  );
}
