#!/usr/bin/env python3
"""Admin TOTP — enroll / confirm / disable a second factor from the server shell.

    ./gateway/.venv/bin/python gateway/scripts/admin_totp.py status [email]
    ./gateway/.venv/bin/python gateway/scripts/admin_totp.py enroll [email]
    ./gateway/.venv/bin/python gateway/scripts/admin_totp.py confirm [email] 123456
    ./gateway/.venv/bin/python gateway/scripts/admin_totp.py disable [email]

`enroll` only stores a *pending* secret and prints the otpauth:// URI — the factor is
not active until a valid code is confirmed, so a botched enrollment cannot lock you out.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db, totp  # noqa: E402

DEFAULT = "admin@aethink.ai"


def arg(i: int, fallback: str | None = None) -> str:
    return sys.argv[i] if len(sys.argv) > i else (fallback or "")


async def main() -> int:
    cmd = arg(1, "status")
    email = arg(2, DEFAULT) if cmd != "confirm" else arg(2, DEFAULT)
    if cmd == "confirm":
        email, code = arg(2, DEFAULT), arg(3, "")

    await db.init_pool()
    try:
        row = await db.pool().fetchrow(
            """SELECT id, email, role, totp_secret, totp_enabled, totp_confirmed_at
                 FROM users WHERE lower(email) = lower($1)""", email)
        if row is None:
            print(f"user tidak ada: {email}")
            return 2

        if cmd == "status":
            print(f"{row['email']} ({row['role']})")
            print(f"  2FA aktif : {'ya' if row['totp_enabled'] else 'belum'}")
            print(f"  secret    : {'ada' if row['totp_secret'] else 'belum dibuat'}"
                  f"{' (pending, belum dikonfirmasi)' if row['totp_secret'] and not row['totp_enabled'] else ''}")
            if row["totp_confirmed_at"]:
                print(f"  sejak     : {row['totp_confirmed_at'].isoformat()}")
            return 0

        if cmd == "enroll":
            secret = totp.new_secret()
            await db.pool().execute(
                """UPDATE users SET totp_secret = $2, totp_enabled = false,
                          totp_confirmed_at = NULL, totp_last_step = NULL
                    WHERE id = $1""", row["id"], secret)
            print("Secret (masukkan manual ke Google Authenticator / Authy / 1Password):")
            print(f"  {secret}")
            print("\nAtau import lewat URI ini:")
            print(f"  {totp.provisioning_uri(secret, row['email'])}")
            print("\nLalu konfirmasi dengan kode 6 digit yang muncul:")
            print(f"  ./gateway/.venv/bin/python gateway/scripts/admin_totp.py confirm {row['email']} <KODE>")
            return 0

        if cmd == "confirm":
            if not row["totp_secret"]:
                print("belum ada secret — jalankan `enroll` dulu")
                return 2
            counter = totp.verify(row["totp_secret"], code)
            if counter is None:
                print("kode salah / kedaluwarsa. Coba kode berikutnya.")
                return 1
            await db.pool().execute(
                """UPDATE users SET totp_enabled = true, totp_confirmed_at = now(),
                          totp_last_step = $2 WHERE id = $1""", row["id"], counter)
            print(f"✅ 2FA aktif untuk {row['email']}. Login sekarang butuh password + kode.")
            return 0

        if cmd == "disable":
            await db.pool().execute(
                """UPDATE users SET totp_enabled = false, totp_secret = NULL,
                          totp_confirmed_at = NULL, totp_last_step = NULL WHERE id = $1""",
                row["id"])
            print(f"⚠️  2FA dimatikan untuk {row['email']} — login cukup password.")
            return 0

        print(__doc__)
        return 2
    finally:
        await db.close_pool()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
