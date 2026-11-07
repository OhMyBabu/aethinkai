import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/Field";
import { StatusPill } from "@/components/common/StatusPill";
import { useToast } from "@/components/common/Toast";
import {
  adminPackages,
  createPackage,
  deletePackage,
  patchPackage,
  patchTopup,
  type GwPackage,
  type GwTopup,
} from "@/lib/gw";
import { cn } from "@/lib/cn";

const emptyForm = {
  sku: "",
  name: "",
  price: "5000",
  rpm: "60",
  blurb: "",
  kind: "plan" as "plan" | "topup",
  sort: "100",
  active: true,
  creditsSameAsPrice: true,
  credits: "",
};

function idr(value: number): string {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

export default function AdminPricingPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<GwPackage[]>([]);
  const [topup, setTopup] = useState<GwTopup>({ min_idr: 2000, max_idr: 5000000, enabled: true });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupDraft, setTopupDraft] = useState({ min: "2000", max: "5000000", enabled: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminPackages();
      setRows(data.packages);
      setTopup(data.topup);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat paket");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditing(null);
    setFormErr(null);
    setOpen(true);
  };

  const openEdit = (pkg: GwPackage) => {
    setForm({
      sku: pkg.sku,
      name: pkg.name,
      price: String(pkg.price_idr),
      rpm: String(pkg.rpm_limit),
      blurb: pkg.blurb ?? "",
      kind: pkg.kind,
      sort: String(pkg.sort),
      active: pkg.active,
      creditsSameAsPrice: pkg.credits_micro === pkg.price_idr * 1_000_000,
      credits: String(pkg.credits_micro / 1_000_000),
    });
    setEditing(pkg.sku);
    setFormErr(null);
    setOpen(true);
  };

  const submit = async () => {
    const price = Number(form.price);
    const rpm = Number(form.rpm);
    if (!form.name.trim()) return setFormErr("Nama paket wajib diisi.");
    if (!Number.isFinite(price) || price <= 0) return setFormErr("Harga harus lebih dari 0.");
    if (!Number.isFinite(rpm) || rpm <= 0) return setFormErr("RPM harus lebih dari 0.");
    if (!form.creditsSameAsPrice && !(Number(form.credits) > 0)) {
      return setFormErr("Kredit harus diisi kalau tidak disamakan dengan harga.");
    }

    setSaving(true);
    setFormErr(null);
    try {
      const credits_micro = form.creditsSameAsPrice ? null : Math.round(Number(form.credits) * 1_000_000);
      if (editing) {
        await patchPackage(editing, {
          name: form.name.trim(),
          price_idr: Math.round(price),
          rpm_limit: Math.round(rpm),
          blurb: form.blurb.trim(),
          kind: form.kind,
          sort: Number(form.sort) || 100,
          active: form.active,
          ...(credits_micro ? { credits_micro } : {}),
        });
      } else {
        await createPackage({
          sku: form.sku.trim().toLowerCase(),
          name: form.name.trim(),
          price_idr: Math.round(price),
          rpm_limit: Math.round(rpm),
          blurb: form.blurb.trim() || null,
          kind: form.kind,
          sort: Number(form.sort) || 100,
          active: form.active,
          ...(credits_micro ? { credits_micro } : {}),
        });
      }
      toast(editing ? "Paket diperbarui" : "Paket dibuat", {
        description: "Landing, panduan, portal, dan bot membaca data yang sama.",
        variant: "success",
      });
      setOpen(false);
      await load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Gagal menyimpan paket");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (pkg: GwPackage) => {
    try {
      await patchPackage(pkg.sku, { active: !pkg.active });
      await load();
    } catch (e) {
      toast("Gagal ubah status", { description: e instanceof Error ? e.message : "", variant: "warning" });
    }
  };

  const remove = async (pkg: GwPackage) => {
    try {
      const res = await deletePackage(pkg.sku);
      toast(res.deactivated ? "Paket dinonaktifkan" : "Paket dihapus", {
        description: res.reason ?? `${pkg.name} (${pkg.sku})`,
        variant: "warning",
      });
      await load();
    } catch (e) {
      toast("Gagal menghapus", { description: e instanceof Error ? e.message : "", variant: "warning" });
    }
  };

  const saveTopup = async () => {
    try {
      const res = await patchTopup({
        min_idr: Math.round(Number(topupDraft.min)),
        max_idr: Math.round(Number(topupDraft.max)) || null,
        enabled: topupDraft.enabled,
      });
      setTopup(res.topup);
      setTopupOpen(false);
      toast("Aturan top-up disimpan", { description: `min ${idr(res.topup.min_idr)}`, variant: "success" });
    } catch (e) {
      toast("Gagal menyimpan aturan top-up", { description: e instanceof Error ? e.message : "", variant: "warning" });
    }
  };

  const stats = useMemo(
    () => ({
      active: rows.filter((r) => r.active).length,
      cheapest: rows.filter((r) => r.active).sort((a, b) => a.price_idr - b.price_idr)[0],
      bestRpm: rows.filter((r) => r.active).sort((a, b) => b.rpm_limit - a.rpm_limit)[0],
    }),
    [rows],
  );

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Paket" }]}
        title="Paket & RPM"
        description="Harga dan kredit per paket; RPM flat 60 untuk semua. Satu sumber data untuk landing, panduan, portal, dan bot."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" leadingIcon={<RefreshCw size={13} />} onClick={() => void load()}>
              Muat ulang
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setTopupDraft({
                  min: String(topup.min_idr),
                  max: topup.max_idr ? String(topup.max_idr) : "",
                  enabled: topup.enabled,
                });
                setTopupOpen(true);
              }}
            >
              Aturan top-up
            </Button>
            <Button leadingIcon={<Plus size={13} />} onClick={openCreate}>
              Paket baru
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[10.5px] uppercase tracking-[0.12em] text-ash">Paket aktif</p>
          <p className="mt-1 font-mono text-[20px] text-warm">{stats.active}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10.5px] uppercase tracking-[0.12em] text-ash">Termurah</p>
          <p className="mt-1 text-[15px] text-warm">
            {stats.cheapest ? `${stats.cheapest.name} · ${idr(stats.cheapest.price_idr)}` : "—"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10.5px] uppercase tracking-[0.12em] text-ash">RPM</p>
          <p className="mt-1 text-[15px] text-warm">
            {stats.bestRpm ? `${stats.bestRpm.rpm_limit} rpm · flat semua paket` : "—"}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        {err ? <p className="px-4 py-3 text-[12px] text-[#e08a5f]">{err}</p> : null}
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ash/15 text-[10.5px] uppercase tracking-[0.1em] text-ash">
              <th className="px-4 py-2.5 font-medium">Paket</th>
              <th className="px-4 py-2.5 text-right font-medium">Harga</th>
              <th className="px-4 py-2.5 text-right font-medium">Kredit</th>
              <th className="px-4 py-2.5 text-right font-medium">RPM</th>
              <th className="px-4 py-2.5 text-right font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ash/10">
            {rows.map((pkg) => (
              <tr key={pkg.sku} className={cn(!pkg.active && "opacity-55")}>
                <td className="px-4 py-3">
                  <div className="text-[13px] text-warm">{pkg.name}</div>
                  <div className="font-mono text-[10.5px] text-ash">
                    {pkg.sku} · {pkg.kind}
                    {pkg.blurb ? ` · ${pkg.blurb}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-[12px] text-warm">{idr(pkg.price_idr)}</td>
                <td className="px-4 py-3 text-right font-mono text-[12px] text-warm">
                  {idr(pkg.credits_micro / 1_000_000)}
                  {pkg.credits_micro === pkg.price_idr * 1_000_000 ? (
                    <span className="ml-1 text-[10px] text-ash">= harga</span>
                  ) : (
                    <span className="ml-1 text-[10px] text-flame">manual</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-[12px] text-warm">
                  {pkg.rpm_limit} <span className="text-[10px] text-ash">flat</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => void toggleActive(pkg)} title="klik untuk ubah">
                    <StatusPill tone={pkg.active ? "success" : "neutral"}>{pkg.active ? "aktif" : "nonaktif"}</StatusPill>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(pkg)}
                      className="grid size-8 place-items-center rounded-lg text-ash transition hover:bg-warm/[0.06] hover:text-warm"
                      aria-label={`Edit ${pkg.name}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(pkg)}
                      className="grid size-8 place-items-center rounded-lg text-ash transition hover:bg-[#c4633a]/15 hover:text-[#e79c78]"
                      aria-label={`Hapus ${pkg.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[12.5px] text-ash">
                  Belum ada paket. Buat satu supaya landing dan portal punya yang dijual.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold text-warm">Top-up nominal bebas</p>
            <p className="mt-1 text-[11.5px] leading-5 text-ash">
              {topup.enabled
                ? `Aktif · minimal ${idr(topup.min_idr)}${topup.max_idr ? ` · maksimal ${idr(topup.max_idr)}` : ""}`
                : "Nonaktif — buyer hanya bisa beli paket"}
            </p>
          </div>
          <StatusPill tone={topup.enabled ? "success" : "neutral"}>{topup.enabled ? "aktif" : "mati"}</StatusPill>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-dim">
          Top-up hanya menambah saldo. RPM tidak berubah — RPM naik hanya lewat pembelian paket, dan nilainya adalah
          paket tertinggi yang pernah dibeli akun itu.
        </p>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit paket ${editing}` : "Paket baru"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
            <Button leadingIcon={<Check size={13} />} disabled={saving} onClick={() => void submit()}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {!editing ? (
            <Field label="SKU" hint="huruf kecil, dipakai di bot & web — tidak bisa diubah setelah dibuat">
              {(id) => (
                <TextInput
                  id={id}
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value.replace(/[^a-z0-9-]/g, "") })}
                  placeholder="starter-plus"
                />
              )}
            </Field>
          ) : null}
          <Field label="Nama tampilan">
            {(id) => <TextInput id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Starter Plus" />}
          </Field>
          <Field label="Harga (Rp)">
            {(id) => <TextInput id={id} type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />}
          </Field>
          <div className="rounded-xl border border-ash/20 bg-warm/[0.02] px-3 py-2.5 text-[11.5px] leading-5 text-ash">
            RPM <span className="font-mono text-warm">60/menit</span> untuk semua paket — tidak diatur per paket.
            Mau diubah? Set <span className="font-mono">AETHINK_RPM_LIMIT</span> atau ubah di DB, satu angka untuk semua.
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ash">
            <input
              type="checkbox"
              checked={form.creditsSameAsPrice}
              onChange={(e) => setForm({ ...form, creditsSameAsPrice: e.target.checked })}
              className="size-4 rounded border-ash/40 bg-[#141518]"
            />
            Kredit = harga (default). Uncheck untuk isi manual.
          </label>
          {!form.creditsSameAsPrice ? (
            <Field label="Kredit (Rp)" hint="berapa rupiah saldo yang masuk ke akun">
              {(id) => (
                <TextInput id={id} type="number" value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} />
              )}
            </Field>
          ) : null}
          <Field label="Deskripsi singkat">
            {(id) => <TextInput id={id} value={form.blurb} onChange={(e) => setForm({ ...form, blurb: e.target.value })} placeholder="buat produk kecil & automation harian" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Jenis">
              {(id) => (
                <select
                  id={id}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as "plan" | "topup" })}
                  className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3 py-2.5 text-sm text-warm"
                >
                  <option value="plan">plan</option>
                  <option value="topup">topup</option>
                </select>
              )}
            </Field>
            <Field label="Urutan">
              {(id) => <TextInput id={id} type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} />}
            </Field>
            <Field label="Status">
              {(id) => (
                <select
                  id={id}
                  value={form.active ? "1" : "0"}
                  onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}
                  className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3 py-2.5 text-sm text-warm"
                >
                  <option value="1">aktif — dijual</option>
                  <option value="0">nonaktif — disembunyikan</option>
                </select>
              )}
            </Field>
          </div>
          {formErr ? <p className="text-[11.5px] text-[#e08a5f]">{formErr}</p> : null}
        </div>
      </Modal>

      <Modal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title="Aturan top-up nominal bebas"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTopupOpen(false)}>Batal</Button>
            <Button onClick={() => void saveTopup()}>Simpan</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Minimal (Rp)">
              {(id) => <TextInput id={id} type="number" value={topupDraft.min} onChange={(e) => setTopupDraft({ ...topupDraft, min: e.target.value })} />}
            </Field>
            <Field label="Maksimal (Rp)" hint="kosongkan untuk tanpa batas">
              {(id) => <TextInput id={id} type="number" value={topupDraft.max} onChange={(e) => setTopupDraft({ ...topupDraft, max: e.target.value })} />}
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ash">
            <input
              type="checkbox"
              checked={topupDraft.enabled}
              onChange={(e) => setTopupDraft({ ...topupDraft, enabled: e.target.checked })}
              className="size-4 rounded border-ash/40 bg-[#141518]"
            />
            Top-up nominal bebas dibuka
          </label>
        </div>
      </Modal>
    </div>
  );
}
