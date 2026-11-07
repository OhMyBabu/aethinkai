"""Dev seed: user + api key + prices + balance. Prints the raw API key once."""

import asyncio
import hashlib
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402


def new_key() -> tuple[str, str, str]:
    raw = "sk-aeth_" + secrets.token_hex(24)
    return raw, raw[:16], hashlib.sha256(raw.encode()).hexdigest()


async def main() -> None:
    await db.init_pool()
    p = db.pool()

    user_id = "u_dev_0001"
    await p.execute(
        """
        INSERT INTO users(id, email, password_hash, role, plan, status)
        VALUES ($1,$2,$3,'admin','pro','active')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        """,
        user_id, "dev@aethink.ai", "seed-not-a-login",
    )
    uid = await p.fetchval("SELECT id FROM users WHERE email = $1", "dev@aethink.ai")

    await p.execute(
        "INSERT INTO balances(user_id, balance_micro) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING",
        uid, 50_000 * 1_000_000,
    )
    # Wallet invariant: keep ledger == balance (see seed_admin.py).
    led = int(await p.fetchval(
        "SELECT coalesce(sum(amount_micro),0) FROM ledger_entries WHERE user_id=$1", uid))
    bal = int(await p.fetchval("SELECT balance_micro FROM balances WHERE user_id=$1", uid))
    if bal != led:
        await p.execute(
            """INSERT INTO ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
               VALUES ($1,$2,'opening',$3,$4,'seed','opening balance')""",
            db.new_id(), uid, bal - led, bal,
        )

    await p.execute("DELETE FROM api_keys WHERE user_id = $1", uid)
    raw, prefix, digest = new_key()
    await p.execute(
        """
        INSERT INTO api_keys(id, user_id, prefix, hash, name)
        VALUES ($1,$2,$3,$4,'dev-gateway')
        """,
        db.new_id(), uid, prefix, digest,
    )

    prices = [
        ("mk/claude-fable-5", "Claude Fable 5", 2_000, 8_000, 500),
        ("mk/deepseek-v4-flash-0731", "DeepSeek V4 Flash", 2_000, 8_000, 500),
        ("mk/glm-5-3", "GLM 5.3", 2_500, 9_000, 600),
        ("mk/kimi-k3", "Kimi K3", 3_000, 12_000, 800),
    ]
    for model_id, name, pin, pout, pcached in prices:
        await p.execute(
            """
            INSERT INTO model_prices(model_id, display_name, price_in_idr, price_out_idr, price_cached_idr, updated_by)
            VALUES ($1,$2,$3,$4,$5,'seed')
            ON CONFLICT (model_id) DO UPDATE
              SET price_in_idr = EXCLUDED.price_in_idr,
                  price_out_idr = EXCLUDED.price_out_idr,
                  price_cached_idr = EXCLUDED.price_cached_idr
            """,
            model_id, name, pin, pout, pcached,
        )

    await p.execute("INSERT INTO fx_rates(usd_idr) VALUES ($1)", 16_250)
    pathlib_path = __import__("pathlib").Path(__file__).resolve().parent.parent / ".devkey"
    pathlib_path.write_text(raw)
    pathlib_path.chmod(0o600)
    print("API_KEY written to .devkey (len %d)" % len(raw))
    print("USER_ID=" + str(uid))
    await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
