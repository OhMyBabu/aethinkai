const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const idrCompact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatIDR(value: number): string {
  return idr.format(value).replace(/\u00a0/g, " ");
}

export function formatIDRCompact(value: number): string {
  return `Rp ${idrCompact.format(value)}`.replace(/\u00a0/g, " ");
}

const numberFmt = new Intl.NumberFormat("id-ID");
export function formatNumber(value: number): string {
  return numberFmt.format(Math.round(value));
}

/** 943400 -> "943,4K", 48200000 -> "48,2M". K/M/B stay English because that is how tokens are quoted. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      const text = new Intl.NumberFormat("id-ID", { maximumFractionDigits: abs >= size * 100 ? 0 : 1 }).format(scaled);
      return `${text}${suffix}`;
    }
  }
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

const shortDateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Jakarta",
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return shortDateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${shortDateFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso))}`;
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function daysAgo(n: number, from = new Date()): string {
  return new Date(from.getTime() - n * 86400000).toISOString();
}

export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "n/a";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "n/a";
  const mins = Math.round((now.getTime() - then) / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} mnt lalu`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return formatShortDate(iso);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}
