import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Pencil, RefreshCw, Save, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { useToast } from "@/components/common/Toast";
import { adminModels, savePrice, type GwModel } from "@/lib/gw";
import { formatIDR } from "@/lib/format";

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-ash/25 px-2.5 text-[11.5px] text-ash transition hover:border-ash/40"
    >
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full border transition ${
          on ? "border-flame/60 bg-flame/80" : "border-ash/30 bg-ash/20"
        }`}
      >
        <span
          className={`absolute size-3.5 rounded-full bg-warm transition-all ${on ? "left-[18px]" : "left-0.5"}`}
          aria-hidden
        />
      </span>
      {on ? "Aktif" : "Mati"}
    </button>
  );
}

function ModelRow({ model, onSaved }: { model: GwModel; onSaved: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priceIn, setPriceIn] = useState(String(model.price_in_idr));
  const [priceOut, setPriceOut] = useState(String(model.price_out_idr));
  const [priceCached, setPriceCached] = useState(String(model.price_cached_idr));
  const [label, setLabel] = useState(model.display_name);
  const [active, setActive] = useState(model.enabled);

  const startEdit = () => {
    setPriceIn(String(model.price_in_idr));
    setPriceOut(String(model.price_out_idr));
    setPriceCached(String(model.price_cached_idr));
    setLabel(model.display_name);
    setActive(model.enabled);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await savePrice(model.model_id, {
        price_in_idr: Math.max(0, Math.round(Number(priceIn) || 0)),
        price_out_idr: Math.max(0, Math.round(Number(priceOut) || 0)),
        price_cached_idr: Math.max(0, Math.round(Number(priceCached) || 0)),
        active,
        display_name: label.trim() || undefined,
      });
      toast("Tersimpan", { description: `${model.model_id} · ${active ? "aktif" : "mati"}`, variant: "success" });
      setEditing(false);
      onSaved();
    } catch (err) {
      toast("Gagal menyimpan", { description: (err as Error).message, variant: "warning" });
    } finally {
      setSaving(false);
    }
  };

  const numeric = (setter: (v: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setter(event.target.value.replace(/[^0-9]/g, ""));

  const inputClass =
    "h-10 w-[112px] rounded-lg border border-flame/45 bg-[#141518] px-2 text-right font-mono text-[12.5px] text-warm focus:border-flame focus:outline-none";

  return (
    <tr className="border-b border-ash/10 align-top last:border-0">
      <td className="max-w-[260px] px-4 py-3">
        {editing ? (
          <div className="space-y-1.5">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void save()}
              placeholder="Nama tampilan"
              aria-label={`Nama tampilan ${model.model_id}`}
              className="h-10 w-full rounded-lg border border-flame/45 bg-[#141518] px-2 text-[12.5px] text-warm focus:border-flame focus:outline-none"
            />
            <div className="truncate font-mono text-[10px] text-ash/70">{model.model_id}</div>
          </div>
        ) : (
          <>
            <div className="truncate text-[13px] font-medium text-warm">{model.display_name}</div>
            <div className="truncate font-mono text-[10.5px] text-ash">{model.model_id}</div>
          </>
        )}
      </td>

      {editing ? (
        <>
          <td className="px-3 py-2">
            <input
              inputMode="numeric"
              value={priceIn}
              onChange={numeric(setPriceIn)}
              onFocus={(event) => { const el = event.currentTarget; if (!el.value || el.value === "0") el.select(); }}
              maxLength={12}
              onKeyDown={(event) => event.key === "Enter" && void save()}
              autoFocus
              aria-label={`Harga input ${model.display_name}`}
              className={inputClass}
            />
          </td>
          <td className="px-3 py-2">
            <input
              inputMode="numeric"
              value={priceOut}
              onChange={numeric(setPriceOut)}
              onFocus={(event) => { const el = event.currentTarget; if (!el.value || el.value === "0") el.select(); }}
              maxLength={12}
              onKeyDown={(event) => event.key === "Enter" && void save()}
              aria-label={`Harga output ${model.display_name}`}
              className={inputClass}
            />
          </td>
          <td className="px-3 py-2">
            <input
              inputMode="numeric"
              value={priceCached}
              onChange={numeric(setPriceCached)}
              onFocus={(event) => { const el = event.currentTarget; if (!el.value || el.value === "0") el.select(); }}
              maxLength={12}
              onKeyDown={(event) => event.key === "Enter" && void save()}
              aria-label={`Harga cached ${model.display_name}`}
              className={inputClass}
            />
          </td>
        </>
      ) : (
        <>
          <td className="px-3 py-3 text-right font-mono text-[12.5px] text-warm">{formatIDR(model.price_in_idr)}</td>
          <td className="px-3 py-3 text-right font-mono text-[12.5px] text-warm">{formatIDR(model.price_out_idr)}</td>
          <td className="px-3 py-3 text-right font-mono text-[12.5px] text-ash">{formatIDR(model.price_cached_idr)}</td>
        </>
      )}

      <td className="px-3 py-3 text-[12px] text-ash">
        {model.requests_30d} req
        <div className="text-[10.5px]">{formatIDR(model.revenue_micro_30d / 1_000_000)}</div>
      </td>

      <td className="px-3 py-3">
        {editing ? (
          <Toggle on={active} label={`Aktifkan ${model.display_name}`} onChange={setActive} />
        ) : (
          <span
            className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] ${
              model.enabled ? "border-flame/45 bg-flame/10 text-warm" : "border-ash/25 text-ash"
            }`}
          >
            {model.enabled ? "Aktif" : "Mati"}
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        {editing ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving} leadingIcon={<X size={13} />}>
              Batal
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save()}
              disabled={saving}
              leadingIcon={saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            >
              Simpan
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={startEdit} leadingIcon={<Pencil size={13} />}>
            Edit
          </Button>
        )}
      </td>
    </tr>
  );
}

export default function AdminModelsPage() {
  const [models, setModels] = useState<GwModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyPriced, setOnlyPriced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminModels();
      setModels(data.models);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((m) => {
      if (onlyPriced && !m.priced) return false;
      if (!needle) return true;
      return m.model_id.toLowerCase().includes(needle) || m.display_name.toLowerCase().includes(needle);
    });
  }, [models, query, onlyPriced]);

  const pricedCount = models.filter((m) => m.priced).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Models & pricing"
        description="Klik Edit pada satu model, atur harga dan status aktif, lalu Simpan sekali — keduanya tersimpan bersamaan."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Models" }]}
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading} leadingIcon={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari model…"
            className="h-11 w-[240px] rounded-xl border border-ash/25 bg-[#141518] pl-9 pr-3 text-[13px] text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none sm:h-10"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyPriced((v) => !v)}
          className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-[12.5px] transition sm:h-10 ${
            onlyPriced ? "border-flame/60 bg-flame/10 text-warm" : "border-ash/25 text-ash hover:text-warm"
          }`}
        >
          <Boxes size={14} aria-hidden /> Hanya yang berharga
        </button>
        <span className="text-[12.5px] text-ash">
          {pricedCount} priced · {models.length} total · {rows.length} tampil
        </span>
      </div>

      {error ? (
        <Card className="border-[#c4633a]/40 bg-[#c4633a]/10 p-4 text-[13px] text-[#e79c78]">{error}</Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ash/15 text-[11px] uppercase tracking-[0.08em] text-ash">
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-3 py-3 text-right font-medium">Input / 1M</th>
                <th className="px-3 py-3 text-right font-medium">Output / 1M</th>
                <th className="px-3 py-3 text-right font-medium">Cached / 1M</th>
                <th className="px-3 py-3 font-medium">30d</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <ModelRow key={m.model_id} model={m} onSaved={() => void load()} />
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-ash">
                    Tidak ada model yang cocok.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {loading ? <div className="px-4 py-6 text-center text-[12.5px] text-ash">Memuat model dari gateway…</div> : null}
      </Card>

      <p className="text-[11.5px] leading-5 text-ash">
        Model tanpa harga ditolak gateway (<span className="font-mono">403 model_not_allowed</span>). Harga di-snapshot
        per request, jadi riwayat tagihan tidak berubah saat harga diperbarui.
      </p>
    </div>
  );
}