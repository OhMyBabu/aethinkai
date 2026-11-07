"""9Router upstream client (loopback peer auth)."""

import json
import os
import time
from typing import Any, AsyncIterator

import httpx

from .config import PEER_TOKEN, UPSTREAM_BASE, UPSTREAM_KEY, UPSTREAM_TIMEOUT  # noqa: F401


def headers() -> dict[str, str]:
    h = {"Content-Type": "application/json", "x-9r-real-ip": "127.0.0.1"}
    if UPSTREAM_KEY:
        # remote relay: standard OpenAI bearer auth
        h["Authorization"] = f"Bearer {UPSTREAM_KEY}"
    if PEER_TOKEN:
        h["x-9r-peer-token"] = PEER_TOKEN
    return h


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=UPSTREAM_BASE, timeout=httpx.Timeout(UPSTREAM_TIMEOUT, connect=10.0))


async def list_models() -> dict[str, Any]:
    """Upstream catalogue, cached briefly.

    The relay answers ~1.2k models in several seconds; every dashboard panel and
    every `/v1/models` call hit it, which made an admin Overview wait 7 s before
    it could paint. A short TTL cache keeps the screens instant without serving
    a catalogue that is minutes stale.
    """
    import time as _time

    global _models_cache
    now = _time.monotonic()
    if _models_cache and now - _models_cache[0] < MODELS_TTL:
        return _models_cache[1]

    async with client() as c:
        r = await c.get("/models", headers=headers())
        r.raise_for_status()
        data = r.json()
    _models_cache = (now, data)
    return data


_models_cache: tuple[float, dict[str, Any]] | None = None
MODELS_TTL = float(os.environ.get("UPSTREAM_MODELS_TTL", "60") or 60)


async def stream_chat(payload: dict[str, Any]) -> AsyncIterator[bytes]:
    async with client() as c:
        async with c.stream("POST", "/chat/completions", json=payload, headers=headers()) as r:
            if r.status_code >= 400:
                body = await r.aread()
                raise UpstreamError(r.status_code, body)
            async for chunk in r.aiter_bytes():
                yield chunk


async def chat(payload: dict[str, Any]) -> tuple[int, bytes]:
    async with client() as c:
        r = await c.post("/chat/completions", json=payload, headers=headers())
        return r.status_code, r.content


class UpstreamError(Exception):
    def __init__(self, status: int, body: bytes):
        self.status = status
        self.body = body
        super().__init__(f"upstream {status}: {body[:200]!r}")


def parse_sse_usage(raw: bytes) -> dict[str, Any]:
    """Pull the last JSON chunk carrying `usage` out of an SSE body."""
    usage: dict[str, Any] = {}
    model = None
    for line in raw.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        data = line[5:].strip()
        if not data or data == b"[DONE]":
            continue
        try:
            obj = json.loads(data)
        except Exception:
            continue
        if obj.get("model"):
            model = obj["model"]
        if obj.get("usage"):
            usage = obj["usage"]
    if model:
        usage["_model"] = model
    return usage


def looks_like_sse(body: bytes) -> bool:
    head = body[:1200].lstrip()
    if head.startswith(b"{") and b'"choices"' in head:
        return False
    return b"data:" in head


def parse_completion(body: bytes) -> dict[str, Any]:
    """Upstream may return a JSON object followed by `data: [DONE]`, or a pure SSE stream."""
    text = body.decode("utf-8", "ignore").strip()
    if text.startswith("{"):
        try:
            obj, _ = json.JSONDecoder().raw_decode(text)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    if b"data:" in body:
        return aggregate_sse(body)
    return {}


def aggregate_sse(body: bytes) -> dict[str, Any]:
    """Collapse an SSE stream into one OpenAI-shaped completion (upstream streams even when asked not to)."""
    parts: list[str] = []
    usage: dict[str, Any] = {}
    model = None
    cid = None
    finish = None
    created = 0
    for line in body.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        data = line[5:].strip()
        if not data or data == b"[DONE]":
            continue
        try:
            obj = json.loads(data)
        except Exception:
            continue
        cid = obj.get("id") or cid
        model = obj.get("model") or model
        created = obj.get("created") or created
        for ch in obj.get("choices") or []:
            delta = ch.get("delta") or {}
            if isinstance(delta.get("content"), str):
                parts.append(delta["content"])
            if ch.get("finish_reason"):
                finish = ch["finish_reason"]
        if obj.get("usage"):
            usage = obj["usage"]
    return {
        "id": cid or "chatcmpl-aggregated",
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "".join(parts)},
            "finish_reason": finish or "stop",
        }],
        "usage": usage,
    }


_PRICE_CACHE: dict[str, Any] = {"at": 0.0, "map": {}}


async def pricing_usd(ttl: int = 600) -> dict[str, tuple[float, float, float]]:
    """USD per 1M tokens keyed by `provider/model`, from the 9Router price card."""
    now = time.time()
    if _PRICE_CACHE["map"] and now - _PRICE_CACHE["at"] < ttl:
        return _PRICE_CACHE["map"]

    card: dict[str, Any] = {}
    try:
        async with client() as c:
            resp = await c.get("/api/pricing", headers=headers())
            if resp.status_code == 200:
                card = resp.json()
    except Exception:
        return _PRICE_CACHE["map"]

    table: dict[str, tuple[float, float, float]] = {}
    for provider, models in card.items():
        if not isinstance(models, dict):
            continue
        for model, price in models.items():
            if not isinstance(price, dict):
                continue
            table[f"{provider}/{model}"] = (
                float(price.get("input") or 0),
                float(price.get("output") or 0),
                float(price.get("cached") or 0),
            )
    if table:
        _PRICE_CACHE["map"] = table
        _PRICE_CACHE["at"] = now
    return _PRICE_CACHE["map"]

USAGE_DB = "/root/.9router/db/data.sqlite"


_BLEND_CACHE: dict[str, Any] = {"at": 0.0, "map": {}}


def blended_usd_per_1m() -> dict[str, float]:
    """USD per 1M tokens per model, derived from the upstream usage ledger (last 30 days).

    9Router does not expose its price card over loopback, but it does record the
    real cost of every request, so the blended rate is a faithful approximation.
    """
    now = time.time()
    if _BLEND_CACHE["map"] and now - _BLEND_CACHE["at"] < 600:
        return _BLEND_CACHE["map"]
    table: dict[str, float] = {}
    try:
        import sqlite3

        con = sqlite3.connect(f"file:{USAGE_DB}?mode=ro", uri=True, timeout=3)
        try:
            rows = con.execute(
                """
                SELECT model,
                       sum(cost) AS cost,
                       sum(coalesce(promptTokens,0) + coalesce(completionTokens,0)) AS tokens
                FROM usageHistory
                WHERE status = 'ok' AND julianday(timestamp) > julianday('now', '-30 days')
                GROUP BY model
                """
            ).fetchall()
            for model, cost, tokens in rows:
                if tokens and cost is not None and float(tokens) > 0:
                    table[str(model)] = float(cost) / float(tokens) * 1_000_000
        finally:
            con.close()
    except Exception:
        return _BLEND_CACHE["map"]
    if table:
        _BLEND_CACHE["map"] = table
        _BLEND_CACHE["at"] = now
    return _BLEND_CACHE["map"]


def upstream_cost(model_id: str, prompt_tokens: int, completion_tokens: int, window_seconds: int = 300) -> float | None:
    """Real USD cost for one request, read from the 9Router usage ledger.

    Token counts are unique enough inside a few-minute window, so the row that
    matches model + prompt + completion is the request we just served.
    """
    slug = model_id.split("/")[-1]
    try:
        import sqlite3

        con = sqlite3.connect(f"file:{USAGE_DB}?mode=ro", uri=True, timeout=3)
        try:
            rows = con.execute(
                """
                SELECT cost, coalesce(promptTokens,0) AS p, coalesce(completionTokens,0) AS c
                FROM usageHistory
                WHERE model = ?
                  AND julianday(timestamp) > julianday('now', ?)
                ORDER BY timestamp DESC LIMIT 25
                """,
                (slug, f"-{int(window_seconds)} seconds"),
            ).fetchall()
            # 9Router stores promptTokens WITHOUT the cached prefix, while the
            # provider reports prompt_tokens WITH it. Exact match therefore fails
            # on cached calls, so pick the closest row by completion tokens, then
            # smallest prompt delta.
            best = None
            for cost, p, c in rows:
                if cost is None:
                    continue
                if abs(int(c) - int(completion_tokens)) > 2:
                    continue
                delta = abs(int(p) - int(prompt_tokens))
                if best is None or delta < best[0]:
                    best = (delta, float(cost))
            if best is not None:
                return best[1]
        finally:
            con.close()
    except Exception:
        pass

    rate = blended_usd_per_1m().get(slug)
    if rate is None:
        return None
    return rate * (int(prompt_tokens) + int(completion_tokens)) / 1_000_000

