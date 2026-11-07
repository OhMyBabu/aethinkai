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

const numberFmt = new Intl.NumberFormat("en-US");
export function formatNumber(value: number): string {
  return numberFmt.format(Math.round(value));
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
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

export function daysAgo(n: number, from = new Date("2026-11-04T09:00:00+07:00")): string {
  return new Date(from.getTime() - n * 86400000).toISOString();
}

export function relativeTime(iso: string, now = new Date("2026-11-04T09:00:00+07:00")): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatShortDate(iso);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}
