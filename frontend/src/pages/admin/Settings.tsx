import { useEffect, useState } from "react";
import { AlertTriangle, Palette, RotateCcw, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { publicModels } from "@/lib/gw";
import { useToast } from "@/components/common/Toast";
import { useStore } from "@/data/store";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { Switch } from "@/components/common/Switch";

export default function AdminSettingsPage() {
  const { state, setPrefs, resetWorkspace } = useStore();
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [modelCount, setModelCount] = useState<number | null>(null);

  // the catalogue lives in the gateway, not in the UI store — ask it instead of counting seeds
  useEffect(() => {
    let alive = true;
    publicModels()
      .then((data) => alive && setModelCount(data.data.length))
      .catch(() => alive && setModelCount(null));
    return () => {
      alive = false;
    };
  }, []);
  const [confirmText, setConfirmText] = useState("");

  return (
    <div>
      <PageHeader
        title="Admin settings"
        description="Brand surface, interface preferences and workspace maintenance."
        breadcrumb={[{ label: "Admin", to: "/admin/overview" }, { label: "Settings" }]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Brand identity" description="The palette every page renders with." action={<Palette size={16} className="text-ash" aria-hidden />} />
          <div className="mt-4 flex items-center gap-4 rounded-xl border border-ash/15 bg-warm/[0.02] p-3">
            <BrandLogo size={40} />
            <div>
              <p className="text-[14px] font-semibold text-warm">AethinkAI Gateway</p>
              <p className="mt-0.5 text-[11.5px] text-ash">Production · OpenAI-compatible · English UI</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-[11.5px]">
            {[
              ["Charcoal", "#18191B"],
              ["Warm white", "#FAF8F4"],
              ["Gray", "#85888B"],
              ["Burnt orange", "#9C542F"],
              ["Orange", "#E7893C"],
            ].map(([label, hex]) => (
              <li key={hex} className="flex items-center justify-between rounded-lg border border-ash/12 px-2.5 py-1.5">
                <span className="flex items-center gap-2 text-ash">
                  <span className="size-3 rounded-sm border border-ash/30" style={{ background: hex }} aria-hidden />
                  {label}
                </span>
                <code className="font-mono text-[11px] text-warm/80">{hex}</code>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Interface preferences" description="Applies instantly to every page." action={<Sparkles size={16} className="text-ash" aria-hidden />} />
          <div className="mt-4 space-y-3">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-ash/15 px-3 py-3">
              <span>
                <span className="block text-[13px] font-medium text-warm">Reduced motion</span>
                <span className="mt-0.5 block text-[11.5px] leading-5 text-ash">
                  Halts signal dots, pulses, count-ups and page transitions.
                </span>
              </span>
              <Switch
                checked={state.prefs.reducedMotion}
                label="Toggle reduced motion"
                onChange={(next) => {
                  setPrefs({ reducedMotion: next });
                  toast(next ? "Motion reduced" : "Motion restored", { variant: "info" });
                }}
              />
            </label>

            <label className="flex items-start justify-between gap-4 rounded-xl border border-ash/15 px-3 py-3">
              <span>
                <span className="block text-[13px] font-medium text-warm">Compact tables</span>
                <span className="mt-0.5 block text-[11.5px] leading-5 text-ash">Denser rows for data-heavy views.</span>
              </span>
              <Switch
                checked={state.prefs.compactTables}
                label="Toggle compact tables"
                onChange={(next) => setPrefs({ compactTables: next })}
              />
            </label>

          </div>
        </Card>
      </div>

      <Card className="mt-4 border-[#c4633a]/30">
        <CardHeader
          title="Danger zone"
          description="Reset returns users, models, keys and usage to the baseline. This cannot be undone."
          action={<AlertTriangle size={16} className="text-[#e08a5f]" aria-hidden />}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="danger" leadingIcon={<RotateCcw size={13} />} onClick={() => setResetOpen(true)}>
            Reset workspace data
          </Button>
          <span className="text-[11.5px] text-ash">
            {state.users.length} users · {modelCount ?? "—"} model (live) · {state.apiKeys.length} keys · {state.usage.length} requests
          </span>
        </div>
      </Card>

      <Modal
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setConfirmText("");
        }}
        title="Reset workspace data"
        description="Type RESET to confirm. Every change made in this workspace is discarded."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              disabled={confirmText !== "RESET"}
              onClick={() => {
                resetWorkspace();
                setResetOpen(false);
                setConfirmText("");
                toast("Workspace reset", { description: "Baseline restored across all pages.", variant: "warning" });
              }}
            >
              Reset everything
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] leading-6 text-ash">
            Users, models, keys, ledger entries and activity created here will be removed. Keys are regenerated from the
            baseline.
          </p>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="RESET"
            aria-label="Type RESET to confirm"
            className="w-full rounded-xl border border-ash/25 bg-[#141518] px-3 py-2 text-sm tracking-[0.2em] text-warm focus:border-flame/60 focus:outline-none focus:ring-2 focus:ring-flame/20"
          />
        </div>
      </Modal>

    </div>
  );
}
