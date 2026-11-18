import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import { Switch } from "@/components/common/Switch";
import { useStore } from "@/data/store";
import { me, publicModels } from "@/lib/gw";

export default function AdminSettingsPage() {
  const { state, setPrefs } = useStore();
  const [email, setEmail] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    me()
      .then((data) => alive && setEmail(data.user.email))
      .catch(() => undefined);
    publicModels()
      .then((data) => alive && setModelCount(data.data.length))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <PageHeader title="Pengaturan" description="Sesi admin dan preferensi tampilan di perangkat ini." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sesi admin" description="Akun operator yang sedang masuk." />
          <dl className="mt-3 divide-y divide-white/[0.06] text-[13px]">
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ash">Email</dt>
              <dd className="text-warm">{email ?? "n/a"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-ash">Model di katalog publik</dt>
              <dd className="num text-warm">{modelCount ?? "n/a"}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12.5px] leading-5 text-ash">
            Harga, paket, routing, dan fallback diatur di menu Katalog. Perubahan langsung berlaku di gateway.
          </p>
        </Card>

        <Card>
          <CardHeader title="Tampilan" description="Tersimpan di browser ini." />
          <div className="mt-3 divide-y divide-white/[0.06]">
            <label className="flex items-start justify-between gap-4 py-3">
              <span>
                <span className="block text-[14px] font-medium text-warm">Kurangi animasi</span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-ash">
                  Menghentikan transisi halaman dan indikator berdenyut.
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
    </div>
  );
}
