"""Rate limiting primitives.

Two different problems, two different shapes:

* **RPM on /v1** — per API key, sliding 60s window, must be cheap and lock-free per request.
* **Brute force on credential endpoints** — per identity *and* per IP, with escalating lockout,
  because "wrong key" floods must not reload the DB on every guess.

Everything is in-process: the gateway is a single uvicorn worker. If it ever scales out, swap the
deques for Redis counters (same interface).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque

WINDOW = 60.0


class SlidingWindow:
    """Fixed-capacity sliding window: `allow(key, limit)` -> (ok, remaining, reset_in)."""

    def __init__(self) -> None:
        self._hits: dict[str, Deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window: float = WINDOW) -> tuple[bool, int, float]:
        if limit <= 0:
            return True, 0, 0.0
        now = time.monotonic()
        q = self._hits[key]
        cutoff = now - window
        while q and q[0] <= cutoff:
            q.popleft()
        reset = round(window - (now - q[0]), 1) if q else window
        if len(q) >= limit:
            return False, 0, max(reset, 0.1)
        q.append(now)
        return True, limit - len(q), max(reset, 0.1)

    def count(self, key: str, window: float = WINDOW) -> int:
        q = self._hits.get(key)
        if not q:
            return 0
        cutoff = time.monotonic() - window
        while q and q[0] <= cutoff:
            q.popleft()
        return len(q)

    def sweep(self, max_keys: int = 20_000) -> None:
        if len(self._hits) <= max_keys:
            return
        cutoff = time.monotonic() - 300
        for key in [k for k, q in self._hits.items() if not q or q[-1] < cutoff]:
            self._hits.pop(key, None)


class Lockout:
    """Escalating block for credential guessing, tracked per identity and per IP.

    fail() -> banned_seconds (0 = still allowed). check() -> remaining ban seconds.
    """

    IDENTITY_STEPS = ((5, 60), (10, 900), (20, 3600))  # attempts -> block seconds
    IP_STEPS = ((20, 300), (50, 1800))  # IP is shared behind NAT: higher bar, shorter blocks

    def __init__(self) -> None:
        self._fails: dict[str, Deque[float]] = defaultdict(deque)
        self._banned_until: dict[str, float] = {}

    def check(self, *keys: str) -> int:
        now = time.monotonic()
        until = 0.0
        for k in keys:
            until = max(until, self._banned_until.get(k, 0.0))
        return int(until - now) if until > now else 0

    def fail(self, seconds: int = 900, *keys: str) -> int:
        now = time.monotonic()
        window = seconds
        ban = 0
        for k in keys:
            q = self._fails[k]
            while q and q[0] < now - window:
                q.popleft()
            q.append(now)
            steps = self.IP_STEPS if k.startswith("ip:") else self.IDENTITY_STEPS
            for attempts, block in steps:
                if len(q) >= attempts:
                    ban = max(ban, block)
            if ban:
                self._banned_until[k] = now + ban
        return ban

    def reset(self, *keys: str) -> None:
        for k in keys:
            self._fails.pop(k, None)
            self._banned_until.pop(k, None)


rpm = SlidingWindow()
signup = SlidingWindow()
auth_lock = Lockout()
