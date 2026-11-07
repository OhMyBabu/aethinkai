import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field } from "@/components/common/Field";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusPill } from "@/components/common/StatusPill";
import { Switch } from "@/components/common/Switch";
import { SearchInput } from "@/components/common/SearchInput";
import {
  adminFallbacks,
  adminModels,
  createFallback,
  deleteFallback,
  updateFallback,
  upstreamModels,
  type GwFallback,
  type GwModel,
} from "@/lib/gw";

export default function AdminFallbacksPage() {
  const [fallbacks, setFallbacks] = useState<GwFallback[]>([]);
  const [models, setModels] = useState<GwModel[]>([]);
  const [upstream, setUpstream] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [priority, setPriority] = useState("10");
  const [providerLabel, setProviderLabel] = useState("");

  const load = useCallback(async () => {
    const [f, m] = await Promise.all([adminFallbacks(), adminModels()]);
    setFallbacks(f.fallbacks);
    setModels(m.models.filter((model) => model.enabled || model.priced));
  }, []);

  useEffect(() => {
    void load();
    upstreamModels()
      .then((data) => setUpstream(data.models))
      .catch(() => setUpstream([]));
  }, [load]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? fallbacks.filter((row) =>
          `${row.model_name} ${row.public_id} ${row.fallback_name} ${row.model_id} ${row.fallback_model_id}`
            .toLowerCase()
            .includes(q),
        )
      : fallbacks;
    const map = new Map<string, { name: string; publicId: string; rows: GwFallback[] }>();
    rows.forEach((row) => {
      const entry = map.get(row.model_id) ?? { name: row.model_name, publicId: row.public_id, rows: [] };
      entry.rows.push(row);
      map.set(row.model_id, entry);
    });
    return Array.from(map.entries()).map(([modelId, value]) => ({ modelId, ...value }));
  }, [fallbacks, query]);

  const submit = async () => {
    if (!source || !target) {
      setError("Model utama dan fallback wajib dipilih.");
      return;
    }
    if (source === target) {
      setError("Fallback harus beda dari model utama.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createFallback({
        model_id: source,
        fallback_model_id: target,
        provider_label: providerLabel.trim() || undefined,
        priority: Number(priority) || 10,
        active: true,
      });
      setOpen(false);
      setSource("");
      setTarget("");
      setPriority("10");
      setProviderLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan fallback.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Model Fallback"
        description="Kalau provider utama error, request otomatis dialihkan ke model cadangan dari 9Router."
        actions={
          <Button leadingIcon={<Plus size={14} />} onClick={() => setOpen(true)}>
            Chain baru
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-lg border border-flame/25 bg-flame/10 text-flame">
              <ArrowRightLeft size={16} />
            </span>
            <div>
              <p className="text-[13.5px] font-medium text-warm">Urutan percobaan</p>
              <p className="text-[12px] text-ash/75">
                Model utama → fallback #1 → fallback #2 (prioritas kecil dicoba dulu). Berlaku untuk chat biasa dan streaming.
                Harga tetap memakai harga model yang dipilih user.
              </p>
            </div>
          </div>
          <div className="w-full sm:w-64">
            <SearchInput value={query} onChange={setQuery} placeholder="Cari model…" />
          </div>
        </div>
      </Card>

      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={ArrowRightLeft}
            title="Belum ada fallback"
            description="Tambahkan rantai cadangan supaya layanan tetap jalan saat provider utama down."
            action={
              <Button leadingIcon={<Plus size={14} />} onClick={() => setOpen(true)}>
                Chain baru
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <Card key={group.modelId} padded={false}>
              <div className="flex flex-wrap items-center gap-2 border-b border-ash/12 p-4 sm:p-5">
                <span className="text-[13.5px] font-semibold text-warm">{group.name}</span>
                <StatusPill tone="neutral" dot={false}>
                  {group.publicId}
                </StatusPill>
                <span className="ml-auto text-[11px] text-ash/60">{group.rows.length} cadangan</span>
              </div>
              <div className="divide-y divide-ash/8">
                {group.rows.map((row, index) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                    <span className="grid h-6 w-6 place-items-center rounded-md border border-ash/20 bg-warm/[0.04] text-[11px] text-ash">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-warm">{row.fallback_name}</p>
                      <p className="truncate font-mono text-[10.5px] text-ash/60">{row.fallback_model_id}</p>
                    </div>
                    <span className="text-[11.5px] text-ash">
                      {row.provider_label || "—"} · prioritas {row.priority}
                    </span>
                    <Switch
                      checked={row.active}
                      label={`Aktifkan fallback ${row.fallback_name}`}
                      onChange={async (next) => {
                        await updateFallback(row.id, { active: next });
                        await load();
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Hapus fallback"
                      onClick={async () => {
                        await deleteFallback(row.id);
                        await load();
                      }}
                      className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Fallback baru"
        description="Pilih model Aethink, lalu model 9Router yang dipakai kalau model itu gagal."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Model utama (dipilih user)" required>
            {(id) => (
              <select
                id={id}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className="w-full cursor-pointer rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              >
                <option value="">Pilih model…</option>
                {models.map((model) => (
                  <option key={model.model_id} value={model.model_id}>
                    {model.display_name} ({model.public_id})
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Model cadangan (route 9Router)" required hint={`${upstream.length} model upstream tersedia`}>
            {(id) => (
              <select
                id={id}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="w-full cursor-pointer rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              >
                <option value="">Pilih model cadangan…</option>
                {upstream.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prioritas" hint="Kecil = dicoba lebih dulu">
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value.replace(/[^\d]/g, ""))}
                  className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
                />
              )}
            </Field>
            <Field label="Label provider (opsional)">
              {(id) => (
                <input
                  id={id}
                  value={providerLabel}
                  onChange={(event) => setProviderLabel(event.target.value)}
                  placeholder="DeepSeek"
                  className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
                />
              )}
            </Field>
          </div>

          {error ? <p className="text-[12px] text-[#e08a5f]">{error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
