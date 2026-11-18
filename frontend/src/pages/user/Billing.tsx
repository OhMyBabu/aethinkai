import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Coins, QrCode, RefreshCw } from "lucide-react";
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
  topup: "top-up",
  charge: "pemakaian",
  hold_release: "pengembalian",
  opening: "saldo awal",
  grant: "bonus",
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
            note: entry.note ?? "n/a",
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
  const toppedUp = useMemo(() => ledger.filter((r) => r.type === "top-up").reduce((sum, r) => sum + r.amount, 0), [ledger]);

  const columns: Array<Column<Row>> = [
    {
      key: "date",
      header: "Tanggal",
      sortValue: (row) => row.at,
      render: (row) => <span className="whitespace-nowrap text-ash">{formatDateTime(row.at)}</span>,
    },
    {
      key: "type",
      header: "Jenis",
      render: (row) => (
        <StatusPill tone={row.amount < 0 ? "neutral" : "success"} dot={false}>
          {row.type}
        </StatusPill>
      ),
    },
    {
      key: "amount",
      header: "Jumlah",
      align: "right",
      sortValue: (row) => row.amount,
      render: (row) => (
        <span className={cn("tabular-nums", row.amount < 0 ? "text-bad" : "text-warm")}>
          {row.amount < 0 ? "−" : "+"}
          {formatIDR(Math.abs(row.amount))}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Saldo akhir",
      align: "right",
      hideBelow: "sm",
      render: (row) => <span className="tabular-nums text-ash">{formatIDR(row.balanceAfter)}</span>,
    },
    {
      key: "note",
      header: "Catatan",
      hideBelow: "md",
      render: (row) => <span className="text-ash">{row.note}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Saldo & tagihan"
        description="Saldo prepaid dalam Rupiah, dipotong per request sesuai harga model."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={13} />} onClick={load} disabled={loading}>
              Muat ulang
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="mb-4 border-bad/40 bg-bad/10 p-4 text-[13px] text-bad">{error}</Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <div>
            <div className="flex items-center gap-2 text-[12px] text-ash">
              Saldo
            </div>
            <p className="mt-3 text-[34px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-warm sm:text-[40px]">
              {formatIDR(balance)}
            </p>
            <p className="mt-2 text-[12px] text-ash">
              {profile?.user.email ?? "n/a"}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                { label: "Terpakai", value: formatIDR(spent) },
                { label: "Top-up", value: formatIDR(toppedUp) },
                { label: "Mutasi", value: String(ledger.length) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-white/8 px-3 py-2">
                  <p className="text-[12px] text-dim">{item.label}</p>
                  <p className="mt-1 truncate text-[13px] tabular-nums text-warm">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Tambah saldo"
            description="Top-up lewat QRIS, dari e-wallet atau m-banking apa pun. Saldo masuk otomatis setelah pembayaran terverifikasi."
            action={<QrCode size={16} className="text-ash" aria-hidden />}
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a
              href="https://t.me/AethinkBot"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-flame px-4 text-[13.5px] font-medium text-[#1a1305] transition-colors hover:bg-[#f09a52]"
            >
              Beli lewat bot Telegram <ArrowUpRight size={14} aria-hidden />
            </a>
            <a
              href="/login"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/12 px-4 text-[13.5px] text-warm transition-colors hover:bg-white/[0.06]"
            >
              Buka portal pembeli
            </a>
          </div>
          <p className="mt-3 text-[12.5px] leading-5 text-ash">
            Akun ini dibuat admin dengan email. Kalau saldo perlu ditambah manual, hubungi admin; setiap penambahan
            langsung tercatat di riwayat di bawah.
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-0">
        <div className="border-b border-white/8 px-5 py-4">
          <h3 className="text-[14px] font-semibold text-warm">Riwayat saldo</h3>
          <p className="mt-0.5 text-[12.5px] text-ash">Setiap perubahan saldo, terbaru di atas.</p>
        </div>
        <DataTable
          columns={columns}
          rows={ledger}
          rowKey={(row) => row.id}
          pageSize={8}
          caption="Riwayat saldo"
          empty={
            <EmptyState
              icon={Coins}
              title={loading ? "Memuat ledger…" : "Belum ada mutasi"}
              description={loading ? "Sebentar." : "Top-up dan pemakaian akan muncul di sini."}
            />
          }
        />
      </Card>
    </div>
  );
}
