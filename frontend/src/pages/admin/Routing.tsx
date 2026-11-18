import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Switch } from "@/components/common/Switch";
import { StatusPill } from "@/components/common/StatusPill";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState } from "@/components/common/EmptyState";
import {
  adminRoutes,
  createModelRoute,
  deleteModelRoute,
  patchModelRoute,
  toggleModelFallback,
  upstreamCatalogue,
  type GwRoute,
  type GwRouterModel,
} from "@/lib/gw";

function ctx(tokens?: number | null) {
  if (!tokens) return "n/a";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

type Group = {
  modelId: string;
  publicId: string;
  displayName: string;
  fallbackEnabled: boolean;
  contextWindow: number | null;
  maxOutput: number | null;
  routes: GwRoute[];
};

export default function AdminRoutingPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("model") ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<Group | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerRows, setPickerRows] = useState<GwRouterModel[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await adminRoutes();
    const map = new Map<string, Group>();
    data.routes.forEach((route) => {
      const entry =
        map.get(route.model_id) ??
        {
          modelId: route.model_id,
          publicId: route.public_id || route.model_id.split("/").pop() || route.model_id,
          displayName: route.display_name || route.model_id,
          fallbackEnabled: route.fallback_enabled ?? true,
          contextWindow: route.context_window ?? null,
          maxOutput: route.max_output ?? null,
          routes: [],
        };
      entry.routes.push(route);
      map.set(route.model_id, entry);
    });
    setGroups(Array.from(map.values()).sort((a, b) => a.publicId.localeCompare(b.publicId)));
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  useEffect(() => {
    if (!pickerFor) return;
    setPickerLoading(true);
    const timer = setTimeout(() => {
      upstreamCatalogue(pickerQuery)
        .then((data) => setPickerRows(data.models))
        .catch(() => setPickerRows([]))
        .finally(() => setPickerLoading(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [pickerFor, pickerQuery]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) =>
      `${group.publicId} ${group.displayName} ${group.modelId} ${group.routes
        .map((r) => r.upstream_model)
        .join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [groups, query]);

  const run = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addRoute = async (model: GwRouterModel) => {
    if (!pickerFor) return;
    const nextPriority =
      (pickerFor.routes.reduce((max, r) => Math.max(max, r.priority), 0) || 0) + 10;
    await run(`add:${model.id}`, async () => {
      await createModelRoute({
        model_id: pickerFor.modelId,
        upstream_model: model.id,
        priority: nextPriority,
      });
      setPickerFor(null);
      setPickerQuery("");
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Admin" }, { label: "Model Routing" }]}
        title="Model routing"
        description="Ini sisi belakang etalase: provider mana yang melayani tiap model. Urutan route = urutan percobaan; kalau yang pertama mati, yang berikutnya ambil alih tanpa pembeli sadar. Harga & status tayang ada di Katalog."
        actions={
          <div className="w-full max-w-[280px]">
            <SearchInput value={query} onChange={setQuery} placeholder="Cari model / provider…" />
          </div>
        }
      />

      {error ? (
        <div className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
          {error}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="Belum ada route"
          description="Jalankan sync_model_aliases.py atau tambah route dari dashboard 9Router untuk mulai."
        />
      ) : null}

      <div className="space-y-4">
        {visible.map((group) => (
          <Card key={group.modelId}>
            <CardHeader
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] text-warm">{group.publicId}</span>
                  <span className="text-[12px] text-ash">{group.displayName}</span>
                  <StatusPill tone={group.routes.some((r) => r.active) ? "success" : "error"}>
                    {group.routes.filter((r) => r.active).length} aktif
                  </StatusPill>
                </div>
              }
              description={
                <span className="text-[12px] text-ash">
                  context {ctx(group.contextWindow)} · output {ctx(group.maxOutput)} · {group.routes.length} route
                </span>
              }
              action={
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-[12px] text-ash">
                    Fallback
                    <Switch
                      checked={group.fallbackEnabled}
                      label="fallback"
                      onChange={(enabled: boolean) =>
                        void run(`fb:${group.modelId}`, () => toggleModelFallback(group.modelId, enabled))
                      }
                    />
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setPickerFor(group);
                      setPickerQuery("");
                    }}
                  >
                    <Plus size={13} /> Route
                  </Button>
                </div>
              }
            />

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-ash/15 text-[12px] text-dim">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">Route upstream</th>
                    <th className="py-2 pr-3 font-medium">Provider</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {group.routes
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((route, index) => (
                      <tr key={route.id} className="border-b border-ash/10 last:border-0">
                        <td className="py-2.5 pr-3 font-mono text-ash">{route.priority}</td>
                        <td className="py-2.5 pr-3 font-mono text-warm">{route.upstream_model}</td>
                        <td className="py-2.5 pr-3 text-ash">{route.provider_label || "n/a"}</td>
                        <td className="py-2.5 pr-3">
                          <StatusPill tone={route.active ? "success" : "neutral"}>
                            {route.active ? (index === 0 ? "primary" : "fallback") : "off"}
                          </StatusPill>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Switch
                              checked={route.active}
                              label="aktif"
                              onChange={(active: boolean) =>
                                void run(`r:${route.id}`, () => patchModelRoute(route.id, { active }))
                              }
                            />
                            <button
                              type="button"
                              aria-label="Naikkan prioritas"
                              disabled={busy === `r:${route.id}` || route.priority <= 1}
                              onClick={() =>
                                void run(`r:${route.id}`, () =>
                                  patchModelRoute(route.id, {
                                    priority: Math.max(1, route.priority - 10),
                                  }),
                                )
                              }
                              className="rounded-md border border-ash/20 p-1 text-ash hover:border-flame/40 hover:text-flame disabled:opacity-40"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="Turunkan prioritas"
                              disabled={busy === `r:${route.id}`}
                              onClick={() =>
                                void run(`r:${route.id}`, () =>
                                  patchModelRoute(route.id, { priority: route.priority + 10 }),
                                )
                              }
                              className="rounded-md border border-ash/20 p-1 text-ash hover:border-flame/40 hover:text-flame disabled:opacity-40"
                            >
                              <ArrowDown size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="Hapus route"
                              disabled={busy === `r:${route.id}`}
                              onClick={() => void run(`r:${route.id}`, () => deleteModelRoute(route.id))}
                              className="rounded-md border border-ash/20 p-1 text-ash hover:border-bad/50 hover:text-bad disabled:opacity-40"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={Boolean(pickerFor)}
        onClose={() => setPickerFor(null)}
        title={pickerFor ? `Tambah route · ${pickerFor.publicId}` : "Tambah route"}
        description="Pilih route dari katalog router. Route baru masuk sebagai cadangan; naikkan prioritas kalau mau jadi primary."
      >
        <div className="space-y-3">
          <SearchInput value={pickerQuery} onChange={setPickerQuery} placeholder="cari model router…" />
          {pickerLoading ? <p className="text-[12px] text-ash">memuat…</p> : null}
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
            {pickerRows.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={busy === `add:${row.id}`}
                onClick={() => void addRoute(row)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-ash/15 px-3 py-2 text-left transition hover:border-flame/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] text-warm">{row.id}</span>
                  <span className="block text-[12px] text-ash">
                    {row.provider} · ctx {ctx(row.context_window)} · out {ctx(row.max_output)}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-ash">
                  {row.in_use ? "sudah dipakai" : "tambah"}
                </span>
              </button>
            ))}
            {!pickerLoading && pickerRows.length === 0 ? (
              <p className="text-[12px] text-ash">Tidak ada model yang cocok.</p>
            ) : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
