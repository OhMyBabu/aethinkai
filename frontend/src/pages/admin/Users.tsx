import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Plus, RefreshCw, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { DataTable, type Column } from "@/components/common/DataTable";
import { SearchInput } from "@/components/common/SearchInput";
import { FilterSelect } from "@/components/common/FilterSelect";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { Modal } from "@/components/common/Modal";
import { Drawer } from "@/components/common/Drawer";
import { Field, TextInput } from "@/components/common/Field";
import { useToast } from "@/components/common/Toast";
import { adminCreateUser, adminCredit, adminUsers, type GwAdminUser } from "@/lib/gw";
import { formatDate, formatIDR, formatNumber } from "@/lib/format";

const randomPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return `Aeth-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join("")}!`;
};

export default function AdminUsersPage() {
  const { toast } = useToast();

  const [users, setUsers] = useState<GwAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const [detail, setDetail] = useState<GwAdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", credit: "0" });
  const [formError, setFormError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; password: string } | null>(null);

  const [crediting, setCrediting] = useState<GwAdminUser | null>(null);
  const [creditAmount, setCreditAmount] = useState("50000");
  const [creditError, setCreditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminUsers();
      setUsers(data.users);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      users
        .filter((user) => (status === "all" ? true : user.status === status))
        .filter((user) => user.email.toLowerCase().includes(query.toLowerCase())),
    [users, status, query],
  );

  const openCreate = () => {
    setForm({ email: "", password: randomPassword(), credit: "0" });
    setFormError(null);
    setCreating(true);
  };

  const submitCreate = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setFormError("Email tidak valid.");
    if (form.password.length < 8) return setFormError("Password minimal 8 karakter.");
    setBusy(true);
    try {
      await adminCreateUser({
        email: form.email.trim(),
        password: form.password,
        credit_idr: Number(form.credit) || 0,
      });
      setInvite({ email: form.email.trim(), password: form.password });
      setCreating(false);
      toast("User dibuat", { description: form.email.trim() });
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCredit = async () => {
    if (!crediting) return;
    const amount = Number(creditAmount);
    if (!amount || amount <= 0) return setCreditError("Nominal harus lebih dari 0.");
    setBusy(true);
    try {
      const res = await adminCredit(crediting.id, amount, "topup manual admin");
      toast("Saldo ditambah", { description: `${crediting.email} → ${formatIDR(res.balance_idr)}` });
      setCrediting(null);
      await load();
    } catch (err) {
      setCreditError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<Column<GwAdminUser>> = [
    {
      key: "user",
      header: "User",
      sortValue: (row) => row.email,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-warm">{row.email.split("@")[0]}</p>
          <p className="mt-0.5 truncate text-[11px] text-ash">{row.email}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <StatusPill tone={row.status === "active" ? "active" : "suspended"}>{row.status}</StatusPill>
      ),
    },
    {
      key: "role",
      header: "Role",
      hideBelow: "sm",
      render: (row) => <span className="text-ash">{row.role}</span>,
    },
    {
      key: "balance",
      header: "Saldo",
      align: "right",
      sortValue: (row) => Number(row.balance_micro),
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums text-warm/90">{formatIDR(Number(row.balance_micro) / 1_000_000)}</span>
      ),
    },
    {
      key: "keys",
      header: "Keys",
      align: "center",
      hideBelow: "md",
      render: (row) => <span className="text-ash">{formatNumber(Number(row.keys))}</span>,
    },
    {
      key: "requests",
      header: "Requests",
      align: "right",
      hideBelow: "md",
      sortValue: (row) => Number(row.requests),
      render: (row) => <span className="tabular-nums text-ash">{formatNumber(Number(row.requests))}</span>,
    },
    {
      key: "joined",
      header: "Joined",
      hideBelow: "lg",
      sortValue: (row) => row.created_at,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatDate(row.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>
            View
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Coins size={12} />}
            onClick={() => {
              setCreditAmount("50000");
              setCreditError(null);
              setCrediting(row);
            }}
          >
            Saldo
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Semua akun gateway: saldo, key, dan pemakaian, langsung dari Postgres."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Users" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void load()} disabled={loading} leadingIcon={<RefreshCw size={14} />}>
              Refresh
            </Button>
            <Button variant="primary" leadingIcon={<Plus size={14} />} onClick={openCreate}>
              Add user
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="mb-4 border-[#c4633a]/40 bg-[#c4633a]/10 p-4 text-[13px] text-[#e79c78]">{error}</Card>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-ash/12 px-5 py-4">
          <SearchInput value={query} onChange={setQuery} placeholder="Search email…" className="w-full sm:w-72" />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ]}
          />
          <p className="ml-auto text-[11.5px] text-ash">
            {rows.length} of {users.length} users
          </p>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          pageSize={8}
          caption="All users"
          empty={
            <EmptyState
              icon={loading ? Users : Search}
              title={loading ? "Memuat user…" : "Belum ada user"}
              description={loading ? "Sebentar." : "Tambah user pertama lewat tombol Add user."}
            />
          }
        />
      </Card>

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.email ?? "User"}
        description={detail ? `${detail.role} · ${detail.status}` : undefined}
        footer={
          detail ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Coins size={13} />}
              onClick={() => {
                setCreditAmount("50000");
                setCreditError(null);
                setCrediting(detail);
                setDetail(null);
              }}
            >
              Tambah saldo
            </Button>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-3 text-[13px]">
            {[
              ["Email", detail.email],
              ["Role", detail.role],
              ["Status", detail.status],
              ["Plan", detail.plan],
              ["Saldo", formatIDR(Number(detail.balance_micro) / 1_000_000)],
              ["API keys", formatNumber(Number(detail.keys))],
              ["Requests", formatNumber(Number(detail.requests))],
              ["Joined", formatDate(detail.created_at)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 border-b border-ash/10 pb-2">
                <span className="text-ash">{label}</span>
                <span className="truncate text-warm">{value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add user"
        description="Password awal ditampilkan sekali, kirim ke user, minta segera diganti."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submitCreate()} disabled={busy}>
              {busy ? "Creating…" : "Create user"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Email" error={formError ?? undefined} required>
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                type="email"
                value={form.email}
                onChange={(event) => {
                  setForm({ ...form, email: event.target.value });
                  setFormError(null);
                }}
                placeholder="user@domain.com"
                autoFocus
              />
            )}
          </Field>
          <Field label="Password awal" required>
            {(id) => (
              <TextInput
                id={id}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            )}
          </Field>
          <Field label="Saldo awal (Rp)">
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                value={form.credit}
                onChange={(event) => setForm({ ...form, credit: event.target.value.replace(/[^0-9]/g, "") })}
              />
            )}
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(invite)}
        onClose={() => setInvite(null)}
        title="Account created"
        description="Kredensial ini hanya tampil sekarang."
        size="sm"
        footer={
          <Button size="sm" onClick={() => setInvite(null)}>
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-ash/15 bg-[#141518] p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ash">Email</p>
            <p className="mt-1 font-mono text-[12.5px] text-warm">{invite?.email}</p>
            <p className="mt-3 text-[10px] uppercase tracking-[0.14em] text-ash">Temporary password</p>
            <p className="mt-1 font-mono text-[12.5px] text-warm">{invite?.password}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!invite) return;
              navigator.clipboard?.writeText(`${invite.email} / ${invite.password}`).catch(() => undefined);
              toast("Credentials copied", { description: invite.email, variant: "info" });
            }}
          >
            Copy credentials
          </Button>
          <p className="text-[11.5px] leading-5 text-ash">
            Password disimpan sebagai hash PBKDF2 di gateway, tidak bisa ditampilkan lagi.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(crediting)}
        onClose={() => setCrediting(null)}
        title="Tambah saldo"
        description={crediting?.email}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCrediting(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submitCredit()} disabled={busy}>
              {busy ? "Menyimpan…" : "Tambah saldo"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[25000, 50000, 100000].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCreditAmount(String(value))}
                aria-pressed={Number(creditAmount) === value}
                className={`rounded-xl border px-2 py-2 text-[12px] tabular-nums transition ${
                  Number(creditAmount) === value
                    ? "border-flame/50 bg-flame/10 text-warm"
                    : "border-ash/20 text-ash hover:text-warm"
                }`}
              >
                {formatIDR(value)}
              </button>
            ))}
          </div>
          <Field label="Nominal (Rp)" error={creditError ?? undefined} required>
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                inputMode="numeric"
                value={creditAmount}
                onChange={(event) => {
                  setCreditAmount(event.target.value.replace(/[^0-9]/g, ""));
                  setCreditError(null);
                }}
                onFocus={(event) => { const el = event.currentTarget; if (!el.value || el.value === "0") el.select(); }}
              />
            )}
          </Field>
          <p className="text-[11.5px] leading-5 text-ash">
            Masuk ke <span className="font-mono">balances</span> dan tercatat sebagai{" "}
            <span className="font-mono">topup</span> di ledger user.
          </p>
        </div>
      </Modal>
    </div>
  );
}
