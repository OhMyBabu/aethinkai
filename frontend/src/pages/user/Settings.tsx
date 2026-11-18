import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Switch } from "@/components/common/Switch";
import { useStore } from "@/data/store";
import { me } from "@/lib/gw";

export default function UserSettingsPage() {
  const { state, setPrefs, logout } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    me()
      .then((data) => alive && setEmail(data.user.email))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <PageHeader title="Pengaturan" description="Akun dan preferensi tampilan di perangkat ini." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Akun" description="Identitas yang dipakai gateway untuk akun ini." />
          <dl className="mt-3 divide-y divide-white/[0.06] text-[13px]">
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ash">Email</dt>
              <dd className="text-warm">{email ?? "n/a"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ash">Paket</dt>
              <dd className="text-warm">{state.users.find((user) => user.id === state.currentUserId)?.plan ?? "n/a"}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12.5px] leading-5 text-ash">
            Untuk mengubah email atau password, hubungi admin gateway.
          </p>
        </Card>

        <Card>
          <CardHeader title="Tampilan" description="Tersimpan di browser ini." />
          <div className="mt-3 divide-y divide-white/[0.06]">
            <label className="flex items-start justify-between gap-4 py-3">
              <span>
                <span className="block text-[14px] font-medium text-warm">Kurangi animasi</span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-ash">
                  Menghentikan transisi halaman dan indikator berdenyut. Pengaturan sistem operasi juga dihormati.
                </span>
              </span>
              <Switch
                checked={state.prefs.reducedMotion}
                label="Kurangi animasi"
                onChange={(next) => setPrefs({ reducedMotion: next })}
              />
            </label>
            <label className="flex items-start justify-between gap-4 py-3">
              <span>
                <span className="block text-[14px] font-medium text-warm">Tabel ringkas</span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-ash">Baris lebih rapat untuk data yang padat.</span>
              </span>
              <Switch
                checked={state.prefs.compactTables}
                label="Tabel ringkas"
                onChange={(next) => setPrefs({ compactTables: next })}
              />
            </label>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Sesi" description="Keluar dari dashboard di browser ini." />
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setSignOutOpen(true)}>
            Keluar
          </Button>
        </div>
      </Card>

      <Modal
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Keluar dari dashboard?"
        description="Kamu perlu masuk lagi untuk membuka dashboard ini."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSignOutOpen(false)}>
              Batal
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setSignOutOpen(false);
                logout();
                navigate("/login", { replace: true });
              }}
            >
              Keluar
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-6 text-ash">API key dan saldo kamu tidak terpengaruh.</p>
      </Modal>
    </div>
  );
}
