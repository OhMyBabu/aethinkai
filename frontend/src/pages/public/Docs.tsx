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
  if (!tokens) return "—";
  if (tokens >= 1_000_000) {
    const m = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${m % 1 === 0 ? m.toFixed(0) : m}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function CopyBlock({ code, label }: { code: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative rounded-xl border border-[#3A3B3D] bg-[#141518]">
      <div className="flex items-center justify-between border-b border-[#2A2B2E] px-3 py-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setDone(true);
            window.setTimeout(() => setDone(false), 1400);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-[#3A3B3D] px-2 py-1 text-[10.5px] text-[#FAF8F4]/80 transition hover:bg-[#22242a]"
        >
          {done ? <Check size={11} /> : <Copy size={11} />} {done ? "tersalin" : "salin"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[11.5px] leading-5 text-[#d7d3cc]">{code}</pre>
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-[#2A2B2E] pt-8">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-[#FAF8F4]">{title}</h2>
      <div className="mt-3 space-y-3 text-[13.5px] leading-7 text-[#a9a49c]">{children}</div>
    </section>
  );
}

const ERRORS = [
  ["401", "invalid_api_key", "Key salah, dicabut, atau statusnya suspended."],
  ["402", "insufficient_balance", "Saldo tidak cukup untuk hold request ini. Isi ulang lewat paket."],
  ["403", "model_not_allowed", "Model sedang off (tidak dijual) atau belum ada di katalog."],
  ["400", "context_too_long", "Prompt melebihi context window model."],
  ["400", "invalid_json / missing_model", "Body bukan JSON valid, atau field model kosong."],
  ["404", "model_not_found", "Nama model tidak ada di katalog aktif."],
  ["429", "rate_limited", "RPM key terlampaui. Lihat header Retry-After."],
  ["429", "gateway_busy", "Kapasitas gateway penuh sesaat (bukan limit paket kamu)."],
  ["503", "model_maintenance", "Model sedang gangguan: tampil di katalog tapi belum bisa dipakai."],
  ["502", "upstream_unavailable", "Provider sedang gagal. Coba lagi atau pakai model lain — saldo tidak terpotong."],
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

  const cheapest = useMemo(
    () => (models.length ? models.reduce((a, b) => (a.pricing_idr_per_1m.input < b.pricing_idr_per_1m.input ? a : b)) : null),
    [models],
  );

  const curl = `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer sk-aeth_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${models[0]?.id ?? "glm-5.3"}",
    "messages": [{"role": "user", "content": "Halo"}],
    "max_tokens": 256
  }'`;

  return (
    <div className="min-h-screen bg-[#18191B] text-[#FAF8F4]">
      <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-[#85888B] transition hover:text-[#E7893C]">
            <ArrowLeft size={13} /> Beranda
          </Link>
          <Link
            to="/status"
            className="inline-flex h-8 items-center rounded-lg border border-[#3A3B3D] px-3 text-[12px] text-[#FAF8F4]/80 transition hover:bg-[#22242a]"
          >
            Status live
          </Link>
        </div>

        <header className="mt-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#E7893C]">Dokumentasi</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">Satu API untuk semua model</h1>
          <p className="mt-2 max-w-[640px] text-[14px] leading-7 text-[#a9a49c]">
            Gateway ini OpenAI-compatible: ganti <code className="rounded bg-[#22242a] px-1 py-0.5 font-mono text-[12px]">base_url</code> dan{" "}
            <code className="rounded bg-[#22242a] px-1 py-0.5 font-mono text-[12px]">api_key</code>, sisanya jalan seperti biasa.
            Bayar pakai saldo (pay as you go) — tidak ada langganan bulanan dan tidak ada biaya per model.
          </p>
        </header>

        <div className="mt-8 space-y-8">
          <section className="rounded-2xl border border-[#3A3B3D] bg-[#1B1C1F] p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">Base URL</p>
                <p className="mt-1 font-mono text-[12.5px] text-[#FAF8F4]">{BASE}/v1</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">Auth</p>
                <p className="mt-1 font-mono text-[12.5px] text-[#FAF8F4]">Authorization: Bearer sk-aeth_…</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#85888B]">Format</p>
                <p className="mt-1 font-mono text-[12.5px] text-[#FAF8F4]">OpenAI chat/completions</p>
              </div>
            </div>
          </section>

          <Section title="Request pertama" id="quickstart">
            <p>Key dikirim sekali lewat chat bot. Simpan di secret manager, jangan di repo.</p>
            <CopyBlock label="curl" code={curl} />
            <CopyBlock
              label="python (openai sdk)"
              code={`from openai import OpenAI

client = OpenAI(base_url="${BASE}/v1", api_key="sk-aeth_...")
r = client.chat.completions.create(
    model="${models[0]?.id ?? "glm-5.3"}",
    messages=[{"role": "user", "content": "Halo"}],
)
print(r.choices[0].message.content)`}
            />
          </Section>

          <Section title="Model & harga" id="models">
            <p>
              Harga di bawah adalah harga jual per <strong>1 juta token</strong>, berlaku saat request selesai.{" "}
              {cheapest ? <>Termurah saat ini: <strong>{cheapest.display_name}</strong> {idr(cheapest.pricing_idr_per_1m.input)} in.</> : null}{" "}
              Context window diambil dari provider, bukan angka marketing.
            </p>
            {err ? <p className="text-[#e08a5f]">Katalog gagal dimuat: {err}</p> : null}
            <div className="overflow-x-auto rounded-xl border border-[#3A3B3D]">
              <table className="w-full min-w-[620px] text-left">
                <thead>
                  <tr className="border-b border-[#2A2B2E] text-[10.5px] uppercase tracking-[0.1em] text-[#85888B]">
                    <th className="px-3 py-2 font-medium">Model (id)</th>
                    <th className="px-3 py-2 font-medium">Context</th>
                    <th className="px-3 py-2 text-right font-medium">in / 1M</th>
                    <th className="px-3 py-2 text-right font-medium">out / 1M</th>
                    <th className="px-3 py-2 text-right font-medium">cache / 1M</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252A] font-mono text-[11.5px]">
                  {models.map((m) => {
                    const bad = (m.status ?? "on") !== "on";
                    return (
                      <tr key={m.id} className={cn(bad && "opacity-60")}>
                        <td className="px-3 py-2 text-[#FAF8F4]">
                          {m.id}
                          <span className="ml-2 font-sans text-[10.5px] text-[#85888B]">{m.display_name}</span>
                        </td>
                        <td className="px-3 py-2 text-[#a9a49c]">{ctxLabel(m.context_length)}</td>
                        <td className="px-3 py-2 text-right text-[#FAF8F4]">{m.pricing_idr_per_1m.input.toLocaleString("id-ID")}</td>
                        <td className="px-3 py-2 text-right text-[#a9a49c]">{m.pricing_idr_per_1m.output.toLocaleString("id-ID")}</td>
                        <td className="px-3 py-2 text-right text-[#a9a49c]">{m.pricing_idr_per_1m.cached_input.toLocaleString("id-ID")}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px]", bad ? "bg-[#c4633a]/15 text-[#e79c78]" : "bg-[#E7893C]/12 text-[#E7893C]")}>
                            {(m.status ?? "on") === "on" ? "on" : m.status === "maintenance" ? "gangguan" : "off"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!models.length && !err ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-[#85888B]">memuat katalog…</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="text-[12.5px] text-[#85888B]">
              Harga berubah kapan saja dari sisi admin; halaman ini dan balasan API selalu membaca angka yang sama.
            </p>
          </Section>

          <Section title="Cara bayar: kredit PAYG" id="billing">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Saldo dibeli per paket (QRIS). Saldo masuk ke <strong>akun</strong>, bukan ke key.</li>
              <li>Setiap request: gateway menahan (hold) perkiraan biaya, lalu menyelesaikan biaya nyata setelah token dihitung.</li>
              <li>Saldo kurang → <code className="font-mono text-[12px]">402 insufficient_balance</code>. Upgrade paket atau isi ulang.</li>
              <li>Provider gagal → <code className="font-mono text-[12px]">502</code>, hold dilepas, saldo tidak berkurang.</li>
              <li>Tidak ada biaya bulanan, tidak ada biaya per model. Semua model bisa dipakai selama saldo ada.</li>
            </ul>
            <CopyBlock
              label="cek saldo & pemakaian"
              code={`curl ${BASE}/api/portal/me \\
  -H "Authorization: Bearer <token-portal>"

# token portal didapat dari:
curl -X POST ${BASE}/api/portal/session \\
  -H "Content-Type: application/json" \\
  -d '{"api_key":"sk-aeth_..."}'`}
            />
          </Section>

          <Section title="Rate limit: RPM per key, plus pagar kapasitas" id="limits">
            <p>
              RPM <strong>flat 60/menit per key</strong> (per akun Telegram) — sama untuk paket mana pun, bukan per model,
              bukan per IP. Kalau butuh lebih, ajukan ke admin: pengecualian di-set per akun dan tidak ditimpa pembelian paket.
              Di atas itu ada satu pagar global untuk kapasitas box: kalau gateway penuh, balasannya{" "}
              <code className="font-mono text-[12px]">429 gateway_busy</code> dan bukan limit paket kamu.
            </p>
            <div className="overflow-x-auto rounded-xl border border-[#3A3B3D]">
              <table className="w-full min-w-[420px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#2A2B2E] text-[10.5px] uppercase tracking-[0.1em] text-[#85888B]">
                    <th className="px-3 py-2 font-medium">Paket</th>
                    <th className="px-3 py-2 text-right font-medium">Harga</th>
                    <th className="px-3 py-2 text-right font-medium">Kredit</th>
                    <th className="px-3 py-2 text-right font-medium">RPM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252A] text-[#a9a49c]">
                  {packages.map((pkg) => (
                    <tr key={pkg.sku}>
                      <td className="px-3 py-2 text-[#FAF8F4]">
                        {pkg.name}
                        {pkg.blurb ? <span className="ml-1.5 text-[10.5px] text-[#85888B]">{pkg.blurb}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right">{idr(pkg.price_idr)}</td>
                      <td className="px-3 py-2 text-right">{idr(pkg.credits_micro / 1_000_000)}</td>
                      <td className="px-3 py-2 text-right font-mono">{pkg.rpm_limit}</td>
                    </tr>
                  ))}
                  {!packages.length ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-[12px] text-[#85888B]">
                        Paket sedang tidak tersedia — cek portal.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p>
              RPM milik <strong>akun</strong> dan nilainya <strong>60/menit untuk semua paket</strong> —
              beli paket lebih besar tidak menaikkannya.{" "}
              {topup.enabled
                ? `Top-up nominal bebas (minimal ${idr(topup.min_idr)}) hanya menambah saldo — RPM tidak berubah.`
                : "Top-up nominal bebas sedang ditutup; pembelian lewat paket."}
            </p>
            <p>
              Setiap balasan membawa <code className="font-mono text-[12px]">X-RateLimit-Limit</code>,{" "}
              <code className="font-mono text-[12px]">X-RateLimit-Remaining</code>, <code className="font-mono text-[12px]">X-RateLimit-Reset</code>.
              Kalau kena 429, tunggu sesuai <code className="font-mono text-[12px]">Retry-After</code> — jangan retry buta.
            </p>
          </Section>

          <Section title="Error yang perlu ditangani" id="errors">
            <div className="overflow-x-auto rounded-xl border border-[#3A3B3D]">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#2A2B2E] text-[10.5px] uppercase tracking-[0.1em] text-[#85888B]">
                    <th className="px-3 py-2 font-medium">HTTP</th>
                    <th className="px-3 py-2 font-medium">code</th>
                    <th className="px-3 py-2 font-medium">Artinya</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252A]">
                  {ERRORS.map(([status, code, meaning]) => (
                    <tr key={code}>
                      <td className="px-3 py-2 font-mono text-[#a9a49c]">{status}</td>
                      <td className="px-3 py-2 font-mono text-[#FAF8F4]">{code}</td>
                      <td className="px-3 py-2 text-[#a9a49c]">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Invoice & rotasi key" id="invoice">
            <p>
              Setiap pembelian punya nomor invoice <code className="font-mono text-[12px]">AETH-YYYYMMDD-XXXX</code> (tanggal + 4 karakter).
              Invoice bisa dilihat di portal: paket, harga, kredit, saldo setelahnya, dan pemakaian sejak invoice terbit.
            </p>
            <p>
              Satu akun Telegram = satu key aktif. Beli paket lagi <strong>tidak</strong> membuat key baru, saldo cuma bertambah.
              Kalau key bocor: rotasi dari portal (kode verifikasi dikirim ke chat bot) atau ketik{" "}
              <code className="font-mono text-[12px]">/rotate</code> langsung di bot. Saldo tetap, key lama langsung mati.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/portal" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#E7893C] px-3 text-[12.5px] font-semibold text-[#18191B]">
                <Terminal size={13} /> Buka portal
              </Link>
              <Link to="/status" className="inline-flex h-9 items-center rounded-lg border border-[#3A3B3D] px-3 text-[12.5px] text-[#FAF8F4]/85">
                Lihat status layanan
              </Link>
            </div>
          </Section>
        </div>

        <p className="mt-10 border-t border-[#2A2B2E] pt-5 text-[11.5px] text-[#6f6a63]">
          Angka di halaman ini ditarik langsung dari gateway dan ikut berubah saat admin mengedit harga atau paket — tidak ada yang di-hardcode.
        </p>
      </div>
    </div>
  );
}
