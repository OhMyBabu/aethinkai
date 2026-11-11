import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, RefreshCw, Search, ShieldOff } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { DataTable, type Column } from "@/components/common/DataTable";
import { SearchInput } from "@/components/common/SearchInput";
import { FilterSelect } from "@/components/common/FilterSelect";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/common/Button";
import { useToast } from "@/components/common/Toast";
import { adminKeys, adminRevokeKey, type GwAdminKey } from "@/lib/gw";
import { formatDate, formatIDR, relativeTime } from "@/lib/format";

type Row = {
  id: string;
  email: string;
  name: string;
  maskedKey: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  requests: number;
  costMicro: number;
};

const toRow = (k: GwAdminKey): Row => ({
  id: k.id,
  email: k.email,
  name: k.name,
  maskedKey: `${k.prefix}${"•".repeat(12)}`,
  status: k.revoked_at ? "revoked" : "active",
  createdAt: k.created_at,
  lastUsedAt: k.last_used_at,
  requests: Number(k.requests ?? 0),
  costMicro: Number(k.cost_micro ?? 0),
});

export default function AdminApiKeysPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [revoking, setRevoking] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminKeys();
      setRows(data.keys.map(toRow));
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

  const filtered = useMemo(
    () =>
      rows
        .filter((row) => (status === "all" ? true : row.status === status))
        .filter((row) => `${row.name} ${row.email} ${row.maskedKey}`.toLowerCase().includes(query.toLowerCase())),
    [rows, status, query],
  );

  const columns: Array<Column<Row>> = [
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.email,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-warm">{row.email.split("@")[0]}</p>
          <p className="mt-0.5 truncate text-[11px] text-ash">{row.email}</p>
        </div>
      ),
    },
    {
      key: "label",
      header: "Key label",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-warm/90">{row.name}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ash">{row.maskedKey}</p>
        </div>
      ),
    },
    {
      key: "requests",
      header: "Requests",
      align: "right",
      hideBelow: "sm",
      sortValue: (row) => row.requests,
      render: (row) => (
        <div className="text-right">
          <p className="text-warm/90">{row.requests.toLocaleString("id-ID")}</p>
          <p className="text-[10.5px] text-ash">{formatIDR(row.costMicro / 1_000_000)}</p>
        </div>
      ),
    },
    {
      key: "created",
      header: "Created",
      hideBelow: "md",
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "used",
      header: "Last used",
      hideBelow: "lg",
      render: (row) => (
        <span className="text-ash">{row.lastUsedAt ? relativeTime(row.lastUsedAt) : "Never"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => <StatusPill tone={row.status === "active" ? "active" : "revoked"}>{row.status}</StatusPill>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button
          size="sm"
          variant="danger"
          disabled={row.status === "revoked"}
          leadingIcon={<ShieldOff size={12} />}
          onClick={() => setRevoking(row)}
        >
          Revoke
        </Button>
      ),
    },
  ];

  const activeCount = rows.filter((row) => row.status === "active").length;

  return (
    <div>
      <PageHeader
        title="Customer API keys"
        description="Setiap key yang dibuat user langsung tercatat di sini, lengkap dengan pemakaian dan biaya."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "API Keys" }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone="active">{activeCount} active</StatusPill>
            <Button variant="ghost" onClick={() => void load()} disabled={loading} leadingIcon={<RefreshCw size={14} />}>
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="mb-4 border-[#c4633a]/40 bg-[#c4633a]/10 p-4 text-[13px] text-[#e79c78]">{error}</Card>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-ash/12 px-5 py-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari email, label, atau prefix…"
            className="w-full sm:w-80"
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "revoked", label: "Revoked" },
            ]}
          />
          <p className="ml-auto text-[11.5px] text-ash">{filtered.length} keys</p>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          pageSize={10}
          caption="All API keys"
          empty={
            <EmptyState
              icon={loading ? KeyRound : Search}
              title={loading ? "Memuat dari gateway…" : "Belum ada key"}
              description={loading ? "Sebentar." : "Key yang dibuat user akan muncul di sini otomatis."}
            />
          }
        />
      </Card>

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revoke this customer key?"
        description={`${revoking?.name ?? "Key"} · ${revoking?.email ?? ""}`}
        confirmLabel="Revoke key"
        destructive
        onConfirm={() => {
          const current = revoking;
          setRevoking(null);
          if (!current) return;
          void adminRevokeKey(current.id)
            .then(() => {
              toast("Key revoked", { description: `${current.name} langsung ditolak gateway.`, variant: "warning" });
              return load();
            })
            .catch((err: Error) => toast("Gagal revoke", { description: err.message, variant: "warning" }));
        }}
        onClose={() => setRevoking(null)}
      >
        <p className="text-[13px] leading-6 text-ash">
          Key langsung ditolak gateway. User melihat status <strong className="text-warm">revoked</strong> di halaman
          API Keys miliknya.
        </p>
      </ConfirmDialog>
    </div>
  );
}
