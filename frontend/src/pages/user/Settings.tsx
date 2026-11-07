import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, RotateCcw, Save, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Field, Select, TextInput } from "@/components/common/Field";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Switch } from "@/components/common/Switch";
import { useToast } from "@/components/common/Toast";
import { useStore } from "@/data/store";

export default function UserSettingsPage() {
  const { state, currentUser, dispatch, setPrefs, resetWorkspace, logout } = useStore();
  const { toast } = useToast();
  const navigate = useNavigate();
  const user = currentUser ?? state.users[0];
  const [alias, setAlias] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [resetOpen, setResetOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Profile, notification and interface preferences for this account."
        breadcrumb={[{ label: "Workspace", to: "/app/overview" }, { label: "Settings" }]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Profile"
            description="Local identity used across the workspace."
            action={<UserRound size={16} className="text-ash" aria-hidden />}
          />
          <div className="mt-4 space-y-3">
            <Field label="Display name" required>
              {(id) => <TextInput id={id} value={alias} onChange={(event) => setAlias(event.target.value)} />}
            </Field>
            <Field label="Email" hint="Used for receipts and security notices." error={!emailValid ? "Enter a valid email format." : undefined}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Save size={13} />}
                disabled={alias.trim().length < 2 || !emailValid}
                onClick={() => {
                  dispatch({ type: "updateUser", id: user.id, patch: { name: alias.trim(), email } });
                  toast("Profile updated", { description: "Saved to your workspace." });
                }}
              >
                Save profile
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Interface preferences" description="Applied immediately across the app." />
          <div className="mt-4 space-y-4">
            <Field label="Interface language" hint="Placeholder selector — the UI copy stays English in this trial.">
              {(id) => (
                <Select
                  id={id}
                  value={state.prefs.language}
                  onChange={(event) => {
                    setPrefs({ language: event.target.value as "en" | "id" });
                    toast("Language preference saved", { description: "Interface copy is English only for now.", variant: "info" });
                  }}
                >
                  <option value="en">English (default)</option>
                  <option value="id">Bahasa Indonesia (placeholder)</option>
                </Select>
              )}
            </Field>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-ash/15 px-3 py-3">
              <div>
                <p className="text-[13px] font-medium text-warm">Reduced motion</p>
                <p className="mt-0.5 text-[11.5px] leading-5 text-ash">
                  Stops signal dots, pulses and page transitions. The OS-level preference is also respected.
                </p>
              </div>
              <Switch
                checked={state.prefs.reducedMotion}
                onChange={(next) => setPrefs({ reducedMotion: next })}
                label="Toggle reduced motion"
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-ash/15 px-3 py-3">
              <div>
                <p className="text-[13px] font-medium text-warm">Compact tables</p>
                <p className="mt-0.5 text-[11.5px] leading-5 text-ash">Tighter row spacing in dense data views.</p>
              </div>
              <Switch
                checked={state.prefs.compactTables}
                onChange={(next) => setPrefs({ compactTables: next })}
                label="Toggle compact tables"
              />
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-4 border-[#c4633a]/25">
        <CardHeader
          title="Danger zone"
          description="Resets and session actions. All local, all reversible by design."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" size="sm" leadingIcon={<RotateCcw size={13} />} onClick={() => setResetOpen(true)}>
            Reset workspace data
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<LogOut size={13} />} onClick={() => setLogoutOpen(true)}>
            Sign out
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-dim">
          Resetting removes keys, users and edits created here, then restores the baseline workspace.
        </p>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        title="Reset workspace data?"
        description="Every change made in this workspace will be discarded."
        confirmLabel="Reset workspace"
        destructive
        onConfirm={() => {
          resetWorkspace();
          toast("Workspace reset", { description: "Baseline restored.", variant: "warning" });
        }}
        onClose={() => setResetOpen(false)}
      />

      <ConfirmDialog
        open={logoutOpen}
        title="Sign out?"
        description="You will need your email and password to sign back in."
        confirmLabel="Log out"
        onConfirm={() => {
          logout();
          navigate("/login");
        }}
        onClose={() => setLogoutOpen(false)}
      />
    </div>
  );
}
