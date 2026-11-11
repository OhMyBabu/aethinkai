import { useEffect, useRef } from "react";

type Status = "connecting" | "live" | "offline";

type Handlers = {
  onRows?: (rows: Array<Record<string, unknown>>) => void;
  onSummary?: (summary: Record<string, unknown>) => void;
  onStatus?: (status: Status) => void;
};

const TOKEN_KEY = "aethinkai-gw-token";
const SSE_TIMEOUT = 3500;
const POLL_MS = 2500;

/**
 * Live feed for dashboards.
 *
 * Tries server-sent events first (instant push). Cloudflare quick tunnels
 * buffer `text/event-stream`, so if no frame arrives within a few seconds we
 * fall back to a 2.5s JSON poll on /api/live/poll/*, same payloads, same
 * handlers, no reload for the user.
 */
export function connectLive(channel: "me" | "admin", handlers: Handlers): () => void {
  const token = typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
  if (!token) return () => undefined;

  let source: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: number | null = null;
  let pollTimer: number | null = null;
  let watchdog: number | null = null;
  let cursor: string | null = null;
  let mode: "sse" | "poll" = "sse";

  const teardownSse = () => {
    if (watchdog) window.clearTimeout(watchdog);
    source?.close();
    source = null;
  };

  // ------------------------------------------------------------------ polling
  const poll = async () => {
    if (closed) return;
    try {
      const url = new URL(`/api/live/poll/${channel}`, window.location.origin);
      url.searchParams.set("token", token);
      if (cursor) url.searchParams.set("since", cursor);
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`poll ${response.status}`);
      const data = (await response.json()) as {
        rows?: Array<Record<string, unknown>>;
        summary?: Record<string, unknown>;
        server_time?: string;
      };
      if (data.server_time) cursor = data.server_time;
      if (data.rows?.length) handlers.onRows?.(data.rows);
      if (data.summary) handlers.onSummary?.(data.summary);
      handlers.onStatus?.("live");
      attempt = 0;
    } catch {
      attempt += 1;
      handlers.onStatus?.("offline");
    } finally {
      if (!closed) pollTimer = window.setTimeout(poll, Math.min(15_000, POLL_MS * (attempt ? 2 : 1)));
    }
  };

  const startPolling = () => {
    if (mode === "poll" || closed) return;
    mode = "poll";
    teardownSse();
    void poll();
  };

  // ---------------------------------------------------------------------- SSE
  const openSse = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    source = new EventSource(`/api/live/${channel}?token=${encodeURIComponent(token)}`);

    watchdog = window.setTimeout(() => {
      // nothing arrived, proxy is buffering, switch to polling
      startPolling();
    }, SSE_TIMEOUT);

    source.addEventListener("ready", () => {
      if (watchdog) window.clearTimeout(watchdog);
      attempt = 0;
      handlers.onStatus?.("live");
    });

    source.addEventListener("requests", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { rows?: Array<Record<string, unknown>> };
        if (payload.rows?.length) handlers.onRows?.(payload.rows);
      } catch {
        /* malformed frame */
      }
    });

    source.addEventListener("summary", (event) => {
      try {
        handlers.onSummary?.(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        /* malformed frame */
      }
    });

    source.onerror = () => {
      teardownSse();
      if (closed) return;
      attempt += 1;
      if (attempt >= 2) {
        startPolling();
        return;
      }
      retryTimer = window.setTimeout(openSse, 800);
    };
  };

  openSse();

  return () => {
    closed = true;
    teardownSse();
    if (retryTimer) window.clearTimeout(retryTimer);
    if (pollTimer) window.clearTimeout(pollTimer);
  };
}

/** Subscribe once per page; handler identity may change freely. */
export function useLive(channel: "me" | "admin", handlers: Handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    return connectLive(channel, {
      onRows: (rows) => ref.current.onRows?.(rows),
      onSummary: (summary) => ref.current.onSummary?.(summary),
      onStatus: (status) => ref.current.onStatus?.(status),
    });
  }, [channel, enabled]);
}
