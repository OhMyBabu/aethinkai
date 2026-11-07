import { useState } from "react";
import { Check, Pencil, Plus, Tag } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput, Textarea } from "@/components/common/Field";
import { StatusPill } from "@/components/common/StatusPill";
import { useToast } from "@/components/common/Toast";
import { useStore } from "@/data/store";
import type { CreditPackage } from "@/types";
import { formatIDR } from "@/lib/format";
import { uid } from "@/lib/id";
import { cn } from "@/lib/cn";

type FormState = {
  name: string;
  priceIdr: string;
  credits: string;
  description: string;
  recommended: boolean;
  enabled: boolean;
};

const empty: FormState = {
  name: "",
  priceIdr: "49000",
  credits: "60000",
  description: "",
  recommended: false,
  enabled: true,
};

export default function AdminPricingPage() {
  const { state, dispatch } = useStore();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setForm(empty);
    setEditingId(null);
    setError(null);
    setOpen(true);
  };

  const openEdit = (pkg: CreditPackage) => {
    setForm({
      name: pkg.name,
      priceIdr: String(pkg.priceIdr),
      credits: String(pkg.credits),
      description: pkg.description,
      recommended: pkg.recommended,
      enabled: pkg.enabled,
    });
    setEditingId(pkg.id);
    setError(null);
    setOpen(true);
  };

  const submit = () => {
    if (form.name.trim().length < 2) return setError("Package name is required.");
    const price = Number(form.priceIdr);
    const credits = Number(form.credits);
    if (!Number.isFinite(price) || price <= 0) return setError("Price must be a positive number.");
    if (!Number.isFinite(credits) || credits <= 0) return setError("Credit allowance must be positive.");
    const payload: CreditPackage = {
      id: editingId ?? uid("pkg"),
      name: form.name.trim(),
      priceIdr: price,
      credits,
      description: form.description.trim() || "Credit package.",
      recommended: form.recommended,
      enabled: form.enabled,
    };
    dispatch({ type: "upsertPackage", pkg: payload });
    toast(editingId ? "Package updated" : "Package created", { description: `${payload.name} · ${formatIDR(payload.priceIdr)}` });
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Packages & pricing"
        description="Reference pricing. Editing here updates what the customer billing page lists."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Pricing" }]}
        actions={<Button variant="primary" leadingIcon={<Plus size={14} />} onClick={openCreate}>Add package</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.packages.map((pkg) => (
          <Card key={pkg.id} className={cn("flex flex-col", pkg.recommended && "border-flame/35 bg-flame/[0.04]")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold text-warm">{pkg.name}</p>
                <p className="mt-0.5 text-[11.5px] text-ash">{pkg.description}</p>
              </div>
              <StatusPill tone={pkg.enabled ? "active" : "revoked"}>{pkg.enabled ? "enabled" : "hidden"}</StatusPill>
            </div>

            <p className="mt-4 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-warm">
              {formatIDR(pkg.priceIdr)}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ash">
              <Tag size={12} aria-hidden />
              {pkg.credits.toLocaleString("en-US")} credits
            </p>

            {pkg.recommended ? (
              <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-md border border-flame/30 bg-flame/10 px-2 py-0.5 text-[10.5px] text-flame">
                <Check size={11} aria-hidden /> Recommended badge
              </p>
            ) : null}

            <div className="mt-auto flex gap-2 pt-4">
              <Button size="sm" variant="secondary" leadingIcon={<Pencil size={12} />} onClick={() => openEdit(pkg)} full>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  dispatch({ type: "upsertPackage", pkg: { ...pkg, enabled: !pkg.enabled } });
                  toast(pkg.enabled ? "Package hidden" : "Package enabled", { description: pkg.name, variant: "info" });
                }}
              >
                {pkg.enabled ? "Disable" : "Enable"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <h3 className="text-[14px] font-semibold text-warm">Credit rules</h3>
        <p className="mt-1 text-[12px] leading-6 text-ash">
          Token rates are shown per model on the catalogue page. Any per-token charge displayed to users is labelled
          "Reference pricing" — changes apply to new top-ups only.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            { label: "Default grant", value: "Rp 25.000" },
            { label: "Top-up options", value: "Rp 25k / 50k / 100k" },
            { label: "Billing mode", value: "Manual verification" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-ash/15 bg-warm/[0.02] px-3 py-2.5">
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-dim">{item.label}</p>
              <p className="mt-1 text-[12.5px] text-warm">{item.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit package" : "Add package"}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submit}>{editingId ? "Save package" : "Create package"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Package name" required>
            {(id) => <TextInput id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Price (IDR)" required>
              {(id) => <TextInput id={id} type="number" value={form.priceIdr} onChange={(event) => setForm({ ...form, priceIdr: event.target.value })} />}
            </Field>
            <Field label="Credit allowance" required>
              {(id) => <TextInput id={id} type="number" value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} />}
            </Field>
          </div>
          <Field label="Description">
            {(id) => <Textarea id={id} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}
          </Field>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[12.5px] text-warm/90">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="size-3.5 accent-[#E7893C]" />
              Enabled for users
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-warm/90">
              <input type="checkbox" checked={form.recommended} onChange={(event) => setForm({ ...form, recommended: event.target.checked })} className="size-3.5 accent-[#E7893C]" />
              Show recommended badge
            </label>
          </div>
          {error ? <p className="text-[11.5px] text-[#e08a5f]">{error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
