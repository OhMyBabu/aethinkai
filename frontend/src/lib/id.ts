export function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function makeSecret(): string {
  let out = "";
  for (let i = 0; i < 40; i += 1) {
    out += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
  }
  return `aeth_sk_${out}`;
}

export function maskSecret(secret: string): string {
  const visibleHead = secret.slice(0, 13);
  return `${visibleHead}${"•".repeat(12)}${secret.slice(-4)}`;
}
