import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env("DATABASE_URL", "postgresql://aethink:CHANGE_ME@127.0.0.1:5432/aethink")
UPSTREAM_BASE = _env("UPSTREAM_BASE_URL", "http://127.0.0.1:20128/v1").rstrip("/")
PEER_TOKEN_FILE = _env("NINEROUTER_PEER_TOKEN_FILE", "/root/services/.9router-peer")
PEER_TOKEN = _env("NINEROUTER_PEER_TOKEN") or (
    Path(PEER_TOKEN_FILE).read_text().strip() if Path(PEER_TOKEN_FILE).exists() else ""
)
USD_IDR = float(_env("USD_IDR", "16250"))
KEY_PREFIX_ROOT = "sk-aeth_"
HOLD_TTL_SECONDS = int(_env("HOLD_TTL_SECONDS", "300"))
UPSTREAM_TIMEOUT = float(_env("UPSTREAM_TIMEOUT", "300"))
