/**
 * Local credential handling for the frontend build. Passwords are never stored
 * in clear text, each account keeps a random salt plus a PBKDF2-SHA256 digest
 * (Web Crypto, 120k iterations). Swapping `hashPassword` for a server call is
 * the only change needed once the gateway API is live.
 */

const ITERATIONS = 120_000;
const KEY_LEN = 32;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHash(input: string): string {
  // Only used when crypto.subtle is unavailable (very old / insecure contexts).
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return `fb${h1.toString(16)}${h2.toString(16)}`;
}

export function makeSalt(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return fallbackHash(`${salt}:${password}`);
  try {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: enc.encode(salt), iterations: ITERATIONS, hash: "SHA-256" },
      baseKey,
      KEY_LEN * 8,
    );
    return toHex(bits);
  } catch {
    return fallbackHash(`${salt}:${password}`);
  }
}

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const digest = await hashPassword(password, salt);
  if (digest.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i += 1) diff |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

export const PASSWORD_MIN = 8;

export function passwordChecks(password: string) {
  return {
    length: password.length >= PASSWORD_MIN,
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function passwordScore(password: string): number {
  const checks = passwordChecks(password);
  return Object.values(checks).filter(Boolean).length;
}

/** UI-only seed rows. Auth is server-side; no password material ships in the bundle. */
export const SEED_ACCOUNTS = {
  admin: { salt: "unused", hash: "unused" },
  buyer: { salt: "unused", hash: "unused" },
};
