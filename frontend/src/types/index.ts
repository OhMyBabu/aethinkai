export type Role = "user" | "admin";

export type ModelCategory = "Reasoning" | "Coding" | "Multimodal";

export type Provider = "DeepSeek" | "Qwen" | "GLM" | "Kimi" | "Anthropic";

export interface AIModel {
  id: string;
  displayName: string;
  modelId: string;
  provider: Provider;
  category: ModelCategory;
  description: string;
  contextWindow: number;
  inputRate: number;
  outputRate: number;
  enabled: boolean;
  popularity: number;
  capabilities: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "suspended";
  credits: number;
  joinedAt: string;
  plan: string;
  /** PBKDF2-SHA256 digest; empty means the account has no local password yet. */
  passwordHash: string;
  salt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked";
  allowedModels: string[];
}

export interface UsageEntry {
  id: string;
  userId: string;
  modelId: string;
  keyId: string;
  at: string;
  inputTokens: number;
  outputTokens: number;
  status: "success" | "error";
  latencyMs: number;
  cost: number;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  at: string;
  type: "topup" | "spend" | "grant" | "refund";
  amount: number;
  balanceAfter: number;
  note: string;
}

export interface CreditPackage {
  id: string;
  name: string;
  priceIdr: number;
  credits: number;
  recommended: boolean;
  enabled: boolean;
  description: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
}

export interface Preferences {
  reducedMotion: boolean;
  language: "en" | "id";
  compactTables: boolean;
}

export interface AppState {
  version: number;
  role: Role | null;
  currentUserId: string | null;
  users: User[];
  models: AIModel[];
  apiKeys: ApiKey[];
  usage: UsageEntry[];
  ledger: LedgerEntry[];
  packages: CreditPackage[];
  activity: ActivityEntry[];
  prefs: Preferences;
}

export type Range = 7 | 30 | 90;

export interface SeriesPoint {
  date: string;
  label: string;
  requests: number;
  tokens: number;
  errors: number;
  cost: number;
}
