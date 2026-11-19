import type {
  ActivityEntry,
  AIModel,
  ApiKey,
  CreditPackage,
  LedgerEntry,
  Preferences,
  UsageEntry,
  User,
} from "@/types";
import { SEED_PASSWORDS } from "@/lib/auth";

/**
 * Seed data for the local workspace store.
 *
 * Only the *chrome* is seeded here, the catalogue mirrors `model_prices` in the
 * gateway, packages mirror `PACKAGES` in `gateway/app/portal.py`, and the two
 * accounts mirror the rows created by `gateway/scripts/seed_admin.py`.
 * Usage, keys, ledger and activity start EMPTY on purpose: those are money and
 * traffic facts, they must come from the gateway, never from a fixture.
 */

const now = Date.now();

function account(
  id: string,
  name: string,
  email: string,
  role: User["role"],
  plan: string,
  credits: number,
  joinedDaysAgo: number,
): User {
  const seed = SEED_PASSWORDS[email];
  return {
    id,
    name,
    email,
    role,
    status: "active",
    credits,
    joinedAt: new Date(now - joinedDaysAgo * 86_400_000).toISOString(),
    plan,
    passwordHash: seed?.hash ?? "",
    salt: seed?.salt ?? "",
  };
}

export const SEED_USERS: User[] = [
  account("usr_admin", "Admin Aethink", "admin@aethink.ai", "admin", "Pro", 100_000, 42),
  account("usr_001", "Demo Buyer", "demo@aethink.ai", "user", "Starter", 25_000, 12),
];

/** Mirrors the priced rows in the gateway catalogue (IDR per 1M tokens). */
export const SEED_MODELS: AIModel[] = [
  {
    id: "claude-fable-5",
    displayName: "Claude Fable 5",
    modelId: "claude-fable-5",
    provider: "Anthropic",
    category: "Reasoning",
    description: "Rp 96.500 in · Rp 482.500 out per 1M token · cache Rp 22.000",
    contextWindow: 1_000_000,
    inputRate: 96_500,
    outputRate: 482_500,
    enabled: true,
    popularity: 100,
    capabilities: ["Vision", "Tools", "Reasoning", "PDF", "Search"],
  },
  {
    id: "kimi-k3",
    displayName: "Kimi K3",
    modelId: "kimi-k3",
    provider: "Kimi",
    category: "Reasoning",
    description: "Rp 40.600 in · Rp 203.000 out per 1M token · cache Rp 4.050",
    contextWindow: 1_000_000,
    inputRate: 40_600,
    outputRate: 203_000,
    enabled: true,
    popularity: 93,
    capabilities: ["Vision", "Tools", "Reasoning"],
  },
  {
    id: "glm-5.3",
    displayName: "GLM 5.3",
    modelId: "glm-5.3",
    provider: "GLM",
    category: "Reasoning",
    description: "Rp 1.140 in · Rp 22.750 out per 1M token · cache Rp 1.000",
    contextWindow: 1_000_000,
    inputRate: 1_140,
    outputRate: 22_750,
    enabled: true,
    popularity: 86,
    capabilities: ["Tools", "Reasoning"],
  },
  {
    id: "glm-5.3-flash",
    displayName: "GLM 5.3 Flash",
    modelId: "glm-5.3-flash",
    provider: "GLM",
    category: "Reasoning",
    description: "Rp 700 in · Rp 2.350 out per 1M token · cache Rp 490",
    contextWindow: 1_000_000,
    inputRate: 700,
    outputRate: 2_350,
    enabled: true,
    popularity: 79,
    capabilities: ["Tools", "Reasoning"],
  },
  {
    id: "deepseek-v4.1-flash-1017",
    displayName: "DeepSeek V4.1 Flash 1017",
    modelId: "deepseek-v4.1-flash-1017",
    provider: "DeepSeek",
    category: "Reasoning",
    description: "Rp 2.400 in · Rp 9.750 out per 1M token · cache Rp 240",
    contextWindow: 1_000_000,
    inputRate: 2_400,
    outputRate: 9_750,
    enabled: true,
    popularity: 72,
    capabilities: ["Vision", "Tools", "Reasoning"],
  },
  {
    id: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    modelId: "deepseek-v4.1-flash",
    provider: "DeepSeek",
    category: "Coding",
    description: "Rp 570 in · Rp 8.125 out per 1M token · cache Rp 163",
    contextWindow: 1_000_000,
    inputRate: 570,
    outputRate: 8_125,
    enabled: true,
    popularity: 65,
    capabilities: ["Tools", "Reasoning"],
  },
  {
    id: "deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    modelId: "deepseek-v4-flash-0731",
    provider: "DeepSeek",
    category: "Coding",
    description: "Rp 2.275 in · Rp 4.875 out per 1M token · cache Rp 200",
    contextWindow: 1_000_000,
    inputRate: 2_275,
    outputRate: 4_875,
    enabled: true,
    popularity: 58,
    capabilities: ["Tools"],
  },
];

/** Mirrors `PACKAGES` in gateway/app/portal.py, one source for bot + web. */
export const SEED_PACKAGES: CreditPackage[] = [
  {
    id: "pkg_starter",
    name: "Starter",
    priceIdr: 5_000,
    credits: 5_000,
    recommended: false,
    enabled: true,
    description: "60 rpm · cocok buat coba-coba & bot pribadi",
  },
  {
    id: "pkg_pro",
    name: "Pro",
    priceIdr: 25_000,
    credits: 25_000,
    recommended: true,
    enabled: true,
    description: "180 rpm · buat produk kecil & automation harian",
  },
  {
    id: "pkg_max",
    name: "Max",
    priceIdr: 100_000,
    credits: 100_000,
    recommended: false,
    enabled: true,
    description: "600 rpm · traffic tinggi, parallel request",
  },
];

export const SEED_API_KEYS: ApiKey[] = [];
export const SEED_USAGE: UsageEntry[] = [];
export const SEED_LEDGER: LedgerEntry[] = [];
export const SEED_ACTIVITY: ActivityEntry[] = [];

export const DEFAULT_PREFS: Preferences = {
  reducedMotion: false,
  language: "id",
  compactTables: false,
};
