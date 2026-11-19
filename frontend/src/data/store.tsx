import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { SEED_ACCOUNTS } from "@/lib/auth";
import type { ActivityEntry, AppState, Preferences, Role, User } from "@/types";

/**
 * UI identity + preferences only. Every number the product shows (balance, usage, models, keys)
 * comes from the gateway (`@/lib/gw`, `@/lib/portal`); this store never invents any. The
 * collections on AppState stay empty unless a page fills them from a live response.
 */

const STORAGE_KEY = "aethinkai-ui-state";
const VERSION = 2;

const DEFAULT_PREFS: Preferences = { reducedMotion: false, language: "id", compactTables: false };

function seedUsers(): User[] {
  const admin = SEED_ACCOUNTS.admin;
  const buyer = SEED_ACCOUNTS.buyer;
  return [
    {
      id: "usr_admin",
      name: "Gateway admin",
      email: "admin@aethink.ai",
      role: "admin",
      status: "active",
      credits: 0,
      joinedAt: "2026-01-01T00:00:00.000Z",
      plan: "Operator",
      passwordHash: admin.hash,
      salt: admin.salt,
    },
    {
      id: "usr_001",
      name: "Alya",
      email: "alya@aethink.ai",
      role: "user",
      status: "active",
      credits: 0,
      joinedAt: "2026-01-01T00:00:00.000Z",
      plan: "Pro",
      passwordHash: buyer.hash,
      salt: buyer.salt,
    },
  ];
}

function freshState(): AppState {
  return {
    version: VERSION,
    role: null,
    currentUserId: null,
    users: seedUsers(),
    models: [],
    apiKeys: [],
    usage: [],
    ledger: [],
    packages: [],
    activity: [] as ActivityEntry[],
    prefs: { ...DEFAULT_PREFS },
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    if (parsed.version !== VERSION || !Array.isArray(parsed.users)) return freshState();
    return { ...freshState(), ...parsed, prefs: { ...DEFAULT_PREFS, ...parsed.prefs } };
  } catch {
    return freshState();
  }
}

type Action =
  | { type: "signIn"; userId: string }
  | { type: "signUp"; user: User }
  | { type: "logout" }
  | { type: "updateUser"; id: string; patch: Partial<User> }
  | { type: "setPrefs"; patch: Partial<Preferences> }
  | { type: "reset" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "signIn": {
      const user = state.users.find((u) => u.id === action.userId);
      if (!user) return state;
      return { ...state, currentUserId: user.id, role: user.role };
    }
    case "signUp":
      return {
        ...state,
        users: [...state.users, action.user],
        currentUserId: action.user.id,
        role: action.user.role,
      };
    case "logout":
      return { ...state, currentUserId: null, role: null };
    case "updateUser":
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.id ? { ...u, ...action.patch } : u)),
      };
    case "setPrefs":
      return { ...state, prefs: { ...state.prefs, ...action.patch } };
    case "reset":
      return { ...freshState(), prefs: state.prefs };
  }
}

interface StoreValue {
  state: AppState;
  currentUser: User | null;
  dispatch: (action: Action) => void;
  signIn: (userId: string) => void;
  signUp: (user: User, welcomeCredits?: number) => void;
  logout: () => void;
  setPrefs: (patch: Partial<Preferences>) => void;
  resetWorkspace: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode or full quota: the session still works, it just will not persist.
    }
  }, [state]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(state.prefs.reducedMotion);
  }, [state.prefs.reducedMotion]);

  const signIn = useCallback((userId: string) => dispatch({ type: "signIn", userId }), []);
  const signUp = useCallback(
    (user: User, welcomeCredits?: number) =>
      dispatch({ type: "signUp", user: welcomeCredits === undefined ? user : { ...user, credits: welcomeCredits } }),
    [],
  );
  const logout = useCallback(() => dispatch({ type: "logout" }), []);
  const setPrefs = useCallback((patch: Partial<Preferences>) => dispatch({ type: "setPrefs", patch }), []);
  const resetWorkspace = useCallback(() => dispatch({ type: "reset" }), []);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      currentUser: state.users.find((u) => u.id === state.currentUserId) ?? null,
      dispatch,
      signIn,
      signUp,
      logout,
      setPrefs,
      resetWorkspace,
    }),
    [state, signIn, signUp, logout, setPrefs, resetWorkspace],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export type { Role };
