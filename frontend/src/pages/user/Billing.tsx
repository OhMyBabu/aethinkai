import { useEffect, useMemo, useState } from "react";
import { Coins, CreditCard, Info, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { me, meLedger, type GwLedgerRow, type GwUser } from "@/lib/gw";
import { useLive } from "@/lib/live";
import { useRef } from "react";
import { formatDateTime, formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";

type Row = {
  id: string;
  at: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string;
};

const KIND_LABEL: Record<string, string> = {
  topup: "topup",
  charge: "spend",
  hold_release: "refund",
  opening: "opening",
};

export default function UserBillingPage() {
  const [profile, setProfile] = useState<{ user: GwUser; balance_idr: number } | null>(null);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastRefresh = useRef(0);

  const load = () => {
    setLoading(true);
    Promise.all([me(), meLedger(100)])
      .then(([p, l]) => {
        setProfile(p);
        setLedger(
          l.ledger.map((entry: GwLedgerRow) => ({
            id: entry.id,
            at: entry.created_at,
            type: KIND_LABEL[entry.kind] ?? entry.kind,
            amount: entry.amount_micro / 1_000_000,
            balanceAfter: entry.balance_after / 1_000_000,
            note: entry.note ?? "—",
          })),
        );
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Live: refresh wallet + ledger when the gateway reports new charge/topup.
  useLive("me", {
    onSummary: () => {
      if (Date.now() - lastRefresh.current < 5000) return;
      lastRefresh.current = Date.now();
      load();
    },
  });

  const balance = profile?.balance_idr ?? 0;
  const spent = useMemo(() => ledger.filter((r) => r.amount < 0).reduce((sum, r) => sum + Math.abs(r.amount), 0), [ledger]);
  const toppedUp = useMemo(() => ledger.filter((r) => r.type === "topup").reduce((sum, r) => sum + r.amount, 0), [ledger]);

  const columns: Array<Column<Row>> = [
    {
      key: "date",
      header: "Date",
      sortValue: (row) => row.at,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatDateTime(row.at)}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <StatusPill tone={row.type === "spend" ? "warning" : "active"} dot={false}>
          {row.type}
        </StatusPill>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (row) => row.amount,
      render: (row) => (
        <span className={cn("tabular-nums", row.amount < 0 ? "text-[#dfa183]" : "text-warm")}>
          {row.amount < 0 ? "−" : "+"}
          {formatIDR(Math.abs(row.amount))}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance after",
      align: "right",
      hideBelow: "sm",
      render: (row) => <span className="tabular-nums text-ash">{formatIDR(row.balanceAfter)}</span>,
    },
    {
      key: "note",
      header: "Note",
      hideBelow: "md",
      render: (row) => <span className="text-ash">{row.note}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Credits & Billing"
        description="Saldo prepaid dalam Rupiah, dipotong per request sesuai harga model."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "Billing" }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone="active">Credit balance</StatusPill>
            <Button variant="ghost" size="sm" leadingIcon={<RefreshCw size={13} />} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="mb-4 border-[#c4633a]/40 bg-[#c4633a]/10 p-4 text-[13px] text-[#e79c78]">{error}</Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-flame/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ash">
              <Coins size={13} aria-hidden /> Credit balance
            </div>
            <p className="mt-3 text-[34px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-warm sm:text-[40px]">
              {formatIDR(balance)}
            </p>
            <p className="mt-2 text-[12px] text-ash">
              {profile?.user.email ?? "—"} · prepaid Rupiah
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                { label: "Spent", value: formatIDR(spent) },
                { label: "Topped up", value: formatIDR(toppedUp) },
                { label: "Entries", value: String(ledger.length) },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-ash/15 bg-warm/[0.03] px-3 py-2">
                  <p className="text-[9.5px] uppercase tracking-[0.1em] text-dim">{item.label}</p>
                  <p className="mt-1 truncate text-[12.5px] tabular-nums text-warm">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Tambah saldo"
            description="Saldo ditambahkan oleh admin. Payment gateway masuk fase berikutnya."
            action={<CreditCard size={16} className="text-ash" aria-hidden />}
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[25000, 50000, 100000].map((value) => (
              <div
                key={value}
                className="rounded-xl border border-ash/15 bg-warm/[0.02] px-3 py-3 text-left opacity-60"
                aria-disabled
              >
                <span className="block text-[13px] font-semibold tabular-nums text-ash">{formatIDR(value)}</span>
                <span className="mt-0.5 block text-[10px] uppercase tracking-[0.1em] text-dim">belum aktif</span>
              </div>
            ))}
          </div>
          <Button variant="secondary" full className="mt-4" disabled>
            Payment gateway — fase berikutnya
          </Button>
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-flame/20 bg-flame/[0.06] px-3 py-2 text-[11px] leading-5 text-flame">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden /> Minta admin menambahkan saldo lewat{" "}
            <span className="font-mono">POST /api/admin/users/&#123;id&#125;/credit</span>. Setiap penambahan langsung
            tercatat di ledger ini.
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-0">
        <div className="border-b border-ash/12 px-5 py-4">
          <h3 className="text-[15px] font-semibold text-warm">Credit ledger</h3>
          <p className="mt-0.5 text-[12px] text-ash">Setiap perubahan saldo, terbaru di atas.</p>
        </div>
        <DataTable
          columns={columns}
          rows={ledger}
          rowKey={(row) => row.id}
          pageSize={8}
          caption="Credit ledger"
          empty={
            <EmptyState
              icon={Coins}
              title={loading ? "Memuat ledger…" : "Belum ada mutasi"}
              description={loading ? "Sebentar." : "Top up dari admin akan muncul di sini."}
            />
          }
        />
      </Card>
    </div>
  );
}
