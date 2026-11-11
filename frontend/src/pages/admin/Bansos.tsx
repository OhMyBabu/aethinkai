import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Gift, Plus, Power, Receipt, RefreshCw, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field } from "@/components/common/Field";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusPill } from "@/components/common/StatusPill";
import { SearchInput } from "@/components/common/SearchInput";
import { StatCard } from "@/components/common/StatCard";
import { Switch } from "@/components/common/Switch";
import {
  adminBansosGrants,
  adminBansosPrograms,
  createBansosGrants,
  createBansosProgram,
  deleteBansosProgram,
  publicModels,
  revokeBansosGrant,
  rotateBansosKey,
  updateBansosProgram,
  type GwBansosGrant,
  type GwBansosProgram,
} from "@/lib/gw";
import { formatCompact, formatDateTime, formatIDR, formatNumber } from "@/lib/format";

const idr = (micro: number) => formatIDR(Number(micro ?? 0) / 1_000_000);

/** Small credit amounts need cents, Rp 0,13 not Rp 0. */
const idrFine = (micro: number) => {
  const value = Number(micro ?? 0) / 1_000_000;
  if (Math.abs(value) >= 1000) return formatIDR(value);
  return `Rp ${value.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

type Draft = {
  name: string;
  credit: string;
  models: string[];
  auto: boolean;
  limit: string;
  note: string;
  active: boolean;
};

const emptyDraft: Draft = { name: "", credit: "5000", models: [], auto: true, limit: "1", note: "", active: true };

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy API key"
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="grid size-7 cursor-pointer place-items-center rounded-md border border-ash/20 text-ash transition hover:border-flame/40 hover:text-warm"
    >
      {copied ? <Check size={11} className="text-flame" /> : <Copy size={11} />}
    </button>
  );
}

export default function AdminBansosPage() {
  const [programs, setPrograms] = useState<GwBansosProgram[]>([]);
  const [grants, setGrants] = useState<GwBansosGrant[]>([]);
  const [catalog, setCatalog] = useState<Array<{ id: string; display_name: string }>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [programModal, setProgramModal] = useState(false);
  const [editing, setEditing] = useState<GwBansosProgram | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const [grantModal, setGrantModal] = useState(false);
  const [grantProgram, setGrantProgram] = useState<string>("");
  const [grantEmails, setGrantEmails] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, g] = await Promise.all([adminBansosPrograms(), adminBansosGrants(undefined, 200)]);
      setPrograms(p.programs);
      setGrants(g.grants);
      setGrantProgram((prev) => prev || p.programs[0]?.id || "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    publicModels()
      .then((data) => setCatalog(data.data.map((m) => ({ id: m.id, display_name: m.display_name }))))
      .catch(() => setCatalog([]));
  }, [load]);

  const totals = useMemo(
    () => ({
      active: programs.filter((p) => p.active).length,
      granted: programs.reduce((acc, p) => acc + p.granted_idr, 0),
      used: programs.reduce((acc, p) => acc + p.used_idr, 0),
      receivers: new Set(grants.map((g) => g.user_id)).size,
    }),
    [programs, grants],
  );

  const filteredGrants = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grants;
    return grants.filter((g) => `${g.email} ${g.program_name}`.toLowerCase().includes(q));
  }, [grants, query]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setError(null);
    setProgramModal(true);
  };

  const openEdit = (program: GwBansosProgram) => {
    setEditing(program);
    setDraft({
      name: program.name,
      credit: String(Math.round(program.credit_micro / 1_000_000)),
      models: program.models ?? [],
      auto: program.auto_grant,
      limit: String(program.per_user_limit),
      note: program.note ?? "",
      active: program.active,
    });
    setError(null);
    setProgramModal(true);
  };

  const saveProgram = async () => {
    if (!draft.name.trim()) {
      setError("Nama program wajib diisi.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        credit_idr: Number(draft.credit) || 0,
        models: draft.models,
        auto_grant: draft.auto,
        per_user_limit: Number(draft.limit) || 1,
        note: draft.note.trim() || undefined,
        active: draft.active,
      };
      if (editing) await updateBansosProgram(editing.id, payload);
      else await createBansosProgram(payload);
      setProgramModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan program.");
    } finally {
      setSaving(false);
    }
  };

  const submitGrants = async () => {
    if (!grantProgram) {
      setError("Pilih program dulu.");
      return;
    }
    const emails = grantEmails
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length) {
      setError("Isi minimal satu email penerima.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createBansosGrants({
        program_id: grantProgram,
        emails,
        amount_idr: grantAmount ? Number(grantAmount) : undefined,
      });
      setGrantModal(false);
      setGrantEmails("");
      setGrantAmount("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat bansos.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bansos"
        description="Kredit gratis untuk publik: atur nominal, model yang boleh dipakai, dan siapa penerimanya."
        actions={
          <>
            <Button variant="primary" leadingIcon={<Gift size={14} />} onClick={() => setGrantModal(true)}>
              Salurkan
            </Button>
            <Button variant="secondary" leadingIcon={<Plus size={14} />} onClick={openCreate}>
              Program
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard key={`ba-${totals.active}`} label="Program aktif" value={totals.active} icon={Gift} hint={`${programs.length} program total`} />
        <StatCard key={`bg-${totals.granted}`} label="Kredit tersalur" value={totals.granted} format={(v) => formatIDR(v)} icon={Receipt} />
        <StatCard key={`bu-${totals.used}`} label="Terpakai" value={totals.used} format={(v) => idrFine(v * 1_000_000)} icon={Power} hint={`${((totals.used / Math.max(totals.granted, 1)) * 100).toFixed(1)}% terserap`} />
        <StatCard key={`br-${totals.receivers}`} label="Penerima" value={totals.receivers} icon={Users} hint={`${grants.length} grant`} />
      </div>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Program bansos" description="Satu program = satu nominal, satu daftar model, satu aturan auto-grant." />
        </div>
        {programs.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="Belum ada program"
            description="Buat program pertama: tentukan kredit, model yang masuk bansos, lalu salurkan ke publik."
            action={
              <Button leadingIcon={<Plus size={14} />} onClick={openCreate}>
                Buat program
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-y border-ash/12 text-[11px] uppercase tracking-wide text-ash/70">
                  <th className="px-5 py-2.5 font-medium">Program</th>
                  <th className="px-4 py-2.5 font-medium">Kredit</th>
                  <th className="px-4 py-2.5 font-medium">Key bersama</th>
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Grant</th>
                  <th className="px-4 py-2.5 font-medium">Terpakai</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium" aria-label="aksi" />
                </tr>
              </thead>
              <tbody>
                {programs.map((program) => (
                  <tr key={program.id} className="border-b border-ash/8 transition hover:bg-warm/[0.02]">
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => openEdit(program)} className="cursor-pointer text-left">
                        <span className="block font-medium text-warm">{program.name}</span>
                        <span className="text-[11px] text-ash/60">
                          1 key bersama · {program.auto_grant ? "auto-grant signup" : "manual"}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-warm">{idr(program.credit_micro)}</td>
                    <td className="px-4 py-3">
                      {program.shared_key ? (
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono text-[10.5px] text-ash">{program.shared_key.masked}</code>
                          <CopyChip value={program.shared_key.key} />
                          <button
                            type="button"
                            title="Rotasi key (key lama langsung mati)"
                            aria-label={`Rotasi key ${program.name}`}
                            onClick={async () => {
                              await rotateBansosKey(program.id);
                              await load();
                            }}
                            className="grid size-7 cursor-pointer place-items-center rounded-md border border-ash/20 text-ash transition hover:border-flame/40 hover:text-warm"
                          >
                            <RefreshCw size={11} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-ash/50">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex flex-wrap gap-1">
                        {(program.models ?? []).slice(0, 3).map((model) => (
                          <span key={model} className="rounded border border-ash/20 bg-warm/[0.03] px-1.5 py-0.5 text-[10.5px] text-ash">
                            {model}
                          </span>
                        ))}
                        {(program.models ?? []).length > 3 ? (
                          <span className="px-1 text-[10.5px] text-ash/60">+{(program.models ?? []).length - 3}</span>
                        ) : null}
                        {(program.models ?? []).length === 0 ? <span className="text-[11px] text-ash/60">semua model</span> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ash">
                      {program.active_grants}/{program.grants}
                    </td>
                    <td className="px-4 py-3 text-ash">
                      {formatIDR(program.used_idr)}
                      <span className="ml-1 text-[11px] text-ash/50">
                        ({((program.used_idr / Math.max(program.granted_idr, 1)) * 100).toFixed(0)}%)
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={program.active ? "active" : "neutral"}>{program.active ? "Aktif" : "Mati"}</StatusPill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Switch
                          checked={program.active}
                          label={`Aktifkan ${program.name}`}
                          onChange={async (next) => {
                            await updateBansosProgram(program.id, { active: next });
                            await load();
                          }}
                        />
                        <button
                          type="button"
                          aria-label={`Hapus ${program.name}`}
                          onClick={async () => {
                            await deleteBansosProgram(program.id);
                            await load();
                          }}
                          className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="flex flex-col gap-3 p-5 pb-0 sm:flex-row sm:items-end sm:justify-between">
          <CardHeader title="Penerima bansos" description="Sisa kredit per user. Request hanya jalan kalau saldo wallet habis dan modelnya termasuk program." />
          <div className="w-full sm:w-64">
            <SearchInput value={query} onChange={setQuery} placeholder="Cari email atau program…" />
          </div>
        </div>
        {filteredGrants.length === 0 ? (
          <EmptyState icon={Users} title="Belum ada penerima" description="Salurkan bansos ke email user yang sudah terdaftar." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead>
                <tr className="border-y border-ash/12 text-[11px] uppercase tracking-wide text-ash/70">
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Program</th>
                  <th className="px-4 py-2.5 font-medium">Kredit</th>
                  <th className="px-4 py-2.5 font-medium">Terpakai</th>
                  <th className="px-4 py-2.5 font-medium">Sisa</th>
                  <th className="px-4 py-2.5 font-medium">Dibuat</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium" aria-label="aksi" />
                </tr>
              </thead>
              <tbody>
                {filteredGrants.map((grant) => (
                  <tr key={grant.id} className="border-b border-ash/8 transition hover:bg-warm/[0.02]">
                    <td className="px-5 py-3 text-warm">{grant.email}</td>
                    <td className="px-4 py-3 text-ash">{grant.program_name}</td>
                    <td className="px-4 py-3 text-ash">{idrFine(grant.amount_micro)}</td>
                    <td className="px-4 py-3 text-ash">{idrFine(grant.used_micro)}</td>
                    <td className="px-4 py-3 text-warm">{idrFine(grant.remaining_micro)}</td>
                    <td className="px-4 py-3 text-[11.5px] text-ash/70">{formatDateTime(grant.created_at)}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={grant.status === "active" ? "active" : grant.status === "revoked" ? "revoked" : "neutral"}>
                        {grant.status}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {grant.status === "active" ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            await revokeBansosGrant(grant.id);
                            await load();
                          }}
                        >
                          Cabut
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={programModal}
        onClose={() => setProgramModal(false)}
        title={editing ? "Edit program bansos" : "Program bansos baru"}
        description="Kredit dihitung dari saldo bansos, bukan wallet user."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProgramModal(false)}>
              Batal
            </Button>
            <Button onClick={saveProgram} disabled={saving}>
              {saving ? "Menyimpan…" : editing ? "Simpan" : "Buat program"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nama program" required>
            {(id) => (
              <input
                id={id}
                value={draft.name}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                placeholder="Bansos Publik November"
                className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm placeholder:text-ash/60 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kredit per penerima (Rp)">
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={draft.credit}
                  onChange={(event) => setDraft((d) => ({ ...d, credit: event.target.value.replace(/[^\d]/g, "") }))}
                  className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
                />
              )}
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-ash/18 bg-[#141518] px-3.5 py-2.5">
            <div>
              <p className="text-[13px] text-warm">Auto-grant saat signup</p>
              <p className="text-[11px] text-ash/70">Setiap akun baru langsung dapat kredit bansos ini.</p>
            </div>
            <Switch checked={draft.auto} label="Auto grant" onChange={(next) => setDraft((d) => ({ ...d, auto: next }))} />
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-ash">Model yang masuk bansos</p>
            <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-xl border border-ash/18 bg-[#141518] p-2 sm:grid-cols-2">
              {catalog.map((model) => {
                const checked = draft.models.includes(model.id);
                return (
                  <label
                    key={model.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ash transition hover:bg-warm/[0.05]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraft((d) => ({
                          ...d,
                          models: checked ? d.models.filter((id) => id !== model.id) : [...d.models, model.id],
                        }))
                      }
                      className="h-4 w-4 cursor-pointer accent-[#E7893C]"
                    />
                    <span className={checked ? "text-warm" : ""}>{model.display_name}</span>
                    <span className="ml-auto font-mono text-[10px] text-ash/50">{model.id}</span>
                  </label>
                );
              })}
              {catalog.length === 0 ? <p className="p-2 text-[12px] text-ash/60">Katalog model belum termuat.</p> : null}
            </div>
            <p className="mt-1.5 text-[11px] text-ash/60">Kosongkan centang = semua model berharga boleh dipakai.</p>
          </div>

          <Field label="Catatan (opsional)">
            {(id) => (
              <input
                id={id}
                value={draft.note}
                onChange={(event) => setDraft((d) => ({ ...d, note: event.target.value }))}
                placeholder="Kuota uji coba publik"
                className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm placeholder:text-ash/60 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              />
            )}
          </Field>

          <div className="flex items-center justify-between rounded-xl border border-ash/18 bg-[#141518] px-3.5 py-2.5">
            <p className="text-[13px] text-warm">Program aktif</p>
            <Switch checked={draft.active} label="Aktif" onChange={(next) => setDraft((d) => ({ ...d, active: next }))} />
          </div>

          {error ? <p className="text-[12px] text-[#e08a5f]">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={grantModal}
        onClose={() => setGrantModal(false)}
        title="Salurkan bansos"
        description="Tempel email user (satu per baris atau pisah koma)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantModal(false)}>
              Batal
            </Button>
            <Button onClick={submitGrants} disabled={saving}>
              {saving ? "Menyalurkan…" : "Salurkan"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Program">
            {(id) => (
              <select
                id={id}
                value={grantProgram}
                onChange={(event) => setGrantProgram(event.target.value)}
                className="w-full cursor-pointer rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              >
                <option value="">Pilih program…</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name} · {idr(program.credit_micro)}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Email penerima" hint="User harus sudah punya akun.">
            {(id) => (
              <textarea
                id={id}
                value={grantEmails}
                onChange={(event) => setGrantEmails(event.target.value)}
                rows={4}
                placeholder={"budi@mail.com\nsari@mail.com"}
                className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              />
            )}
          </Field>

          <Field label="Nominal khusus (Rp, opsional)">
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                value={grantAmount}
                onChange={(event) => setGrantAmount(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="Kosongkan = pakai nominal program"
                className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3.5 py-2.5 text-sm text-warm placeholder:text-ash/50 focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/25"
              />
            )}
          </Field>

          {error ? <p className="text-[12px] text-[#e08a5f]">{error}</p> : null}
        </div>
      </Modal>

      <p className="text-[11px] text-ash/50">
        {loading ? "Memuat data bansos…" : `${formatNumber(grants.length)} grant · total kredit ${formatIDR(totals.granted)} · terpakai ${formatIDR(totals.used)}`}{" "}
        · {formatCompact(grants.length)} baris
      </p>
    </div>
  );
}
