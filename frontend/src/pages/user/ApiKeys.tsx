import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchInput } from "@/components/common/SearchInput";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Field, TextInput } from "@/components/common/Field";
import { useToast } from "@/components/common/Toast";
import { createKey as gwCreateKey, listKeys, renameKey as gwRenameKey, revokeKey as gwRevokeKey, type GwKey } from "@/lib/gw";
import type { ApiKey } from "@/types";
import { formatDate, relativeTime } from "@/lib/format";

function toRow(key: GwKey): ApiKey {
  return {
    id: key.id,
    userId: "",
    name: key.name,
    maskedKey: `${key.prefix}${"•".repeat(12)}`,
    status: key.revoked_at ? "revoked" : "active",
    createdAt: key.created_at,
    lastUsedAt: key.last_used_at ?? undefined,
    allowedModels: [],
  } as ApiKey;
}

export default function UserApiKeysPage() {
  const { toast } = useToast();

  const [rows, setRows] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<ApiKey | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listKeys();
      setRows(data.keys.map(toRow));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const keys = useMemo(
    () => rows.filter((key) => `${key.name} ${key.maskedKey}`.toLowerCase().includes(query.toLowerCase())),
    [rows, query],
  );

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast("Copied to clipboard", { description: "Paste it into your client configuration." });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Clipboard unavailable", { description: "Copy manually from the field.", variant: "warning" });
    }
  };

  const createKey = async () => {
    if (name.trim().length < 3) {
      setError("Give the key a name of at least 3 characters.");
      return;
    }
    setCreating(true);
    try {
      const res = await gwCreateKey(name.trim());
      setRevealed(res.key);
      setError(null);
      setCreateOpen(false);
      setName("");
      toast("API key created", { description: "Shown once. It will be masked after you close the dialog." });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const columns: Array<Column<ApiKey>> = [
    {
      key: "name",
      header: "Name",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-warm">{row.name}</p>
          <p className="mt-0.5 font-mono text-[10.5px] text-ash">{row.maskedKey}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => <StatusPill tone={row.status === "active" ? "active" : "revoked"}>{row.status}</StatusPill>,
    },
    {
      key: "created",
      header: "Created",
      hideBelow: "md",
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="text-ash">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "used",
      header: "Last used",
      hideBelow: "sm",
      render: (row) => (
        <span className="text-ash">{row.lastUsedAt ? relativeTime(row.lastUsedAt) : "Never"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="relative flex justify-end">
          <button
            type="button"
            aria-label={`Actions for ${row.name}`}
            aria-expanded={menuFor === row.id}
            onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
            className="grid size-11 place-items-center rounded-xl text-ash transition active:scale-95 active:bg-warm/[0.08] hover:bg-warm/[0.06] hover:text-warm sm:size-9 sm:rounded-lg"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuFor === row.id ? (
            <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-xl border border-ash/20 bg-[#1b1c1f] shadow-xl">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-warm/90 hover:bg-warm/[0.05]"
                onClick={() => {
                  setRenaming(row);
                  setRenameValue(row.name);
                  setMenuFor(null);
                }}
              >
                <Pencil size={12} aria-hidden /> Rename
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-warm/90 hover:bg-warm/[0.05]"
                onClick={() => {
                  copy(row.maskedKey);
                  setMenuFor(null);
                }}
              >
                <Copy size={12} aria-hidden /> Copy identifier
              </button>
              <button
                type="button"
                disabled={row.status === "revoked"}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#e08a5f] hover:bg-[#c4633a]/10 disabled:opacity-40"
                onClick={() => {
                  setRevoking(row);
                  setMenuFor(null);
                }}
              >
                <Trash2 size={12} aria-hidden /> Revoke key
              </button>
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="API Keys"
        description="Keys live in the gateway. Anything you create here is immediately usable and visible to admin."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "API Keys" }]}
        actions={
          <Button variant="primary" leadingIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
        }
      />

      {loadError ? (
        <Card className="mb-4 border-[#c4633a]/40 bg-[#c4633a]/10 p-4 text-[13px] text-[#e79c78]">{loadError}</Card>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ash/12 px-5 py-4">
          <div>
            <h3 className="text-[14px] font-semibold text-warm">Workspace keys</h3>
            <p className="mt-0.5 text-[12px] text-ash">
              {rows.filter((key) => key.status === "active").length} active · {rows.length} total
            </p>
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Search keys…" className="w-full sm:w-60" />
        </div>

        {!loading && rows.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create your first key to start sending requests."
            action={
              <Button variant="primary" size="sm" leadingIcon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>
                Create API key
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={keys}
            rowKey={(row) => row.id}
            pageSize={8}
            caption="API keys"
            empty={
              <EmptyState
                icon={Search}
                title="No keys match that search"
                description="Try another name or clear the search field."
              />
            }
          />
        )}
      </Card>

      <p className="mt-3 text-[11px] leading-5 text-dim">
        {loading ? "Memuat key dari gateway…" : "Key disimpan sebagai hash di gateway — nilai penuh hanya tampil sekali saat dibuat."}
      </p>

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setError(null);
        }}
        title="Create API key"
        description="The key value is displayed once after creation."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void createKey()} disabled={creating}>
              {creating ? "Creating…" : "Create key"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Key name" error={error ?? undefined} required>
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => event.key === "Enter" && void createKey()}
                placeholder="e.g. Production router"
                autoFocus
              />
            )}
          </Field>
          <p className="text-[11.5px] leading-5 text-ash">
            Key berlaku untuk semua model yang aktif di katalog. Batasi per model belum didukung gateway.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(revealed)}
        onClose={() => setRevealed(null)}
        title="Your new API key"
        description="Copy it now — this value is shown only once."
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
              Done
            </Button>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => revealed && copy(revealed)}
            >
              {copied ? "Copied" : "Copy key"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-ash/20 bg-[#121316] p-3">
            <code className="flex-1 break-all font-mono text-[12px] text-warm">{revealed}</code>
          </div>
          <p className="rounded-lg border border-flame/25 bg-flame/[0.07] px-3 py-2 text-[11.5px] leading-5 text-flame">
            Sudah aktif di gateway. Pakai sebagai <span className="font-mono">Authorization: Bearer …</span> ke base URL
            gateway.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename key"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const current = renaming;
                const next = renameValue.trim();
                setRenaming(null);
                if (!current || next.length < 3) return;
                void gwRenameKey(current.id, next)
                  .then(() => {
                    toast("Key renamed", { description: next });
                    return load();
                  })
                  .catch((err: Error) => toast("Gagal rename", { description: err.message, variant: "warning" }));
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Key name" required>
          {(id) => (
            <TextInput
              id={id}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              autoFocus
            />
          )}
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revoke this key?"
        description={`${revoking?.name ?? "This key"} stops working immediately at the gateway.`}
        confirmLabel="Revoke key"
        destructive
        onConfirm={() => {
          const current = revoking;
          setRevoking(null);
          if (!current) return;
          void gwRevokeKey(current.id)
            .then(() => {
              toast("Key revoked", { description: current.name, variant: "warning" });
              return load();
            })
            .catch((err: Error) => toast("Gagal revoke", { description: err.message, variant: "warning" }));
        }}
        onClose={() => setRevoking(null)}
      >
        <p className="text-[13px] leading-6 text-ash">
          Key langsung ditolak gateway (<span className="font-mono">401</span>). Baris tetap ada di tabel dengan status{" "}
          <strong className="text-warm">revoked</strong> untuk audit.
        </p>
      </ConfirmDialog>
    </div>
  );
}
