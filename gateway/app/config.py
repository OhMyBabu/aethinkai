import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    """Populate os.environ from a key=value file without overriding real env."""
    try:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


# Scripts (seed_*, tests, tools) run without a shell wrapper, so load the same
# secret files the systemd/pm2 units use. Real environment always wins.
for _candidate in (
    os.environ.get("AETHINK_ENV_FILE", ""),
    str(BASE_DIR / ".env"),
    "/root/.secrets/aethink-db.env",
):
    if _candidate:
        _load_env_file(Path(_candidate))


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env("DATABASE_URL", "postgresql://aethink:CHANGE_ME@127.0.0.1:5432/aethink")
UPSTREAM_BASE = _env("UPSTREAM_BASE_URL", "http://127.0.0.1:20128/v1").rstrip("/")
# Remote 9Router relays authenticate with a normal API key (Bearer); a loopback
# instance authenticates with the peer token below. Both are supported.
UPSTREAM_KEY = _env("UPSTREAM_KEY")
PEER_TOKEN_FILE = _env("NINEROUTER_PEER_TOKEN_FILE", "/root/services/.9router-peer")
PEER_TOKEN = _env("NINEROUTER_PEER_TOKEN") or (
    Path(PEER_TOKEN_FILE).read_text().strip() if Path(PEER_TOKEN_FILE).exists() else ""
)
USD_IDR = float(_env("USD_IDR", "16250"))
KEY_PREFIX_ROOT = "sk-aeth_"
HOLD_TTL_SECONDS = int(_env("HOLD_TTL_SECONDS", "300"))
UPSTREAM_TIMEOUT = float(_env("UPSTREAM_TIMEOUT", "300"))
