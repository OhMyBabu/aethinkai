# Pricing audit — AethinkAI

Tanggal: 2026-11-07 · Kurs gateway `USD_IDR = 16.250`

## Metode

1. Harga jual diambil langsung dari tabel `model_prices` (yang benar-benar ditagih
   `cost_micro()` di `gateway/app/main.py`), bukan dari dokumen.
2. Modal upstream **belum terbaca dari server ini**: kartu harga 9Router
   (`/api/pricing`) menjawab `401 Unauthorized` untuk API key, dan ledger SQLite
   `usageHistory` hanya ada di box relay (`43.173.36.225`), bukan di box gateway.
   Karena itu `usage_events.cost_usd` berisi 0 untuk **semua** 10 request yang tercatat
   dan dashboard menampilkan `margin 100%` — angka itu palsu dan sudah diperbaiki:
   summary kini mengirim `cost_known: false` dan UI menulis "modal belum tercatat".
3. Sebagai pembanding yang bisa diaudit, dipakai **harga pasar terendah** per model
   (sumber publik, tanggal akses 2026-11-07). Semua margin di bawah = margin terhadap
   patokan pasar itu, bukan terhadap relay.

## Harga pasar pembanding

| Model | Input /1M | Output /1M | Sumber |
|---|---:|---:|---|
| claude-fable-5 | $10.00 | $50.00 | platform.claude.com/docs/en/about-claude/pricing |
| kimi-k3 | $0.153 | $10.15 | openrouter.ai/moonshotai/kimi-k3 (Relace); Bedrock $3/$15 |
| glm-5.3 | $0.60 | $2.80 | openrouter.ai/z-ai/glm-5.3 (Inceptron); aipricing.guru $1.40/$4.40 |
| glm-5.3-flash | $0.0451 | $0.4082 | openrouter.ai/z-ai/glm-5.3-flash (weighted) |
| deepseek-v4.1-flash | $0.15 | $0.60 | DeepSeek list; openrouter termurah $0.006/$0.50 |
| deepseek-v4.1-flash-1017 | $0.15 | $0.60 | DeepSeek/DeepInfra list |
| deepseek-v4-flash-0731 | $0.119 | $0.238 | openrouter.ai/deepseek/deepseek-v4-flash-0731 |

## Temuan per model (harga jual sekarang)

| Model | Jual in (Rp) | Modal pasar in (Rp) | Margin in | Jual out (Rp) | Modal pasar out (Rp) | Margin out | Margin blended 70/30 |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude-fable-5 | 96.500 | 162.500 | **−41%** | 482.500 | 812.500 | **−41%** | **−68,4%** |
| kimi-k3 | 40.600 | 2.486 | +94% | 203.000 | 164.938 | +19% | +42,7% |
| glm-5.3 | 1.140 | 9.750 | **−755%** | 22.750 | 45.500 | **−100%** | **−168,6%** |
| glm-5.3-flash | 700 | 733 | **−5%** | 2.350 | 6.633 | **−182%** | **−109,5%** |
| deepseek-v4.1-flash-1017 | 2.400 | 2.438 | −2% | 9.750 | 9.750 | 0% | −0,6% |
| deepseek-v4.1-flash | 570 | 2.438 | **−328%** | 8.125 | 9.750 | −20% | **−63,3%** |
| deepseek-v4-flash-0731 | 2.275 | 1.934 | +15% | 4.875 | 3.868 | +21% | +17,7% |

**5 dari 7 model dijual di bawah harga pasar.** Paling parah `glm-5.3`
(jual input Rp1.140 vs modal pasar Rp9.750 — 8,5x di bawah modal) dan
`deepseek-v4.1-flash` (4,3x di bawah modal di sisi input).
`claude-fable-5` dijual 59% dari harga resmi Anthropic ($5,94 vs $10 per 1M input).

Volumenya masih 10 request, jadi kerugian nominal belum berarti — tapi setiap
token yang laku di harga ini menambah defisit, dan `claude-fable-5` adalah yang
paling mahal per request.

## Harga saran (modal pasar × 1,35, dibulatkan)

| Model | in sekarang | in saran | out sekarang | out saran |
|---|---:|---:|---:|---:|
| claude-fable-5 | 96.500 | **219.000** | 482.500 | **1.097.000** |
| kimi-k3 | 40.600 | 3.400 ⚠ | 203.000 | 223.000 |
| glm-5.3 | 1.140 | **13.200** | 22.750 | **61.000** |
| glm-5.3-flash | 700 | 1.000 | 2.350 | **9.000** |
| deepseek-v4.1-flash-1017 | 2.400 | 3.300 | 9.750 | 13.200 |
| deepseek-v4.1-flash | 570 | **3.300** | 8.125 | 13.200 |
| deepseek-v4-flash-0731 | 2.275 | 2.600 | 4.875 | 5.200 |

⚠ `kimi-k3` input saran lebih murah dari harga sekarang: input di pasar memang murah
($0.153) sementara output yang mahal. Jangan turunkan harga input-nya — selisihnya
kecil dan menurunkan harga publik memicu perang harga; cukup naikkan output.

## Rekomendasi

1. **Jangan naikkan harga sebelum modal relay terbaca.** Semua angka di atas memakai
   patokan pasar; kalau relay memberi harga lebih murah (route `ky/`, `cn/`, `tb/`,
   `ur/*:free`), naik sebesar tabel ini bisa membuat harga tidak kompetitif.
2. **Ambil kartu harga relay**: butuh password dashboard 9Router atau
   `sqlite3 /root/.9router/db/data.sqlite "select model, cost, promptTokens, completionTokens from usageHistory where timestamp > datetime('now','-7 day')"`
   yang dijalankan di box relay. Dengan itu `price_audit.py` bisa memakai modal riil.
3. **Minimal 1,35× modal, dibulatkan ke atas**, kecuali model loss-leader yang
   disengaja — dan kalau disengaja, catat di `model_prices.display_name`/note supaya
   tidak terbaca sebagai bug.
4. **Jangan pernah jual di bawah 1,0×**: `glm-5.3` dan `deepseek-v4.1-flash` sekarang
   di bawah itu di sisi input, artinya prompt panjang (vision, PDF, dokumen) rugi
   paling besar justru di beban yang paling sering dipakai.

## Alat

```bash
cd gateway && ./.venv/bin/python scripts/price_audit.py --json audit.json
```

Mencetak ceiling USD/1M per model (harga jual dikonversi ke USD) — angka modal
maksimum sebelum model itu rugi, plus jumlah route upstream dan route `:free` yang
tersedia untuk model tersebut.
