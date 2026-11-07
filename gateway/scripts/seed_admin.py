"""Create/reset the admin account and a customer account. Writes creds to .admin (0600)."""

import asyncio
import secrets
import sys
from pathlib import Path

sys.path.insert(0, "/root/projects/aethinkai-gateway")

from app import auth, db  # noqa: E402

ADMIN_EMAIL = "admin@aethink.ai"
CUSTOMER_EMAIL = "demo@aethink.ai"


async def upsert(email: str, role: str, plan: str, balance_idr: int) -> str:
    password = secrets.token_urlsafe(12)
    p = db.pool()
    row = await p.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if row is None:
        uid = db.new_id()
        await p.execute(
            """INSERT INTO users(id, email, password_hash, role, plan, status)
               VALUES ($1,$2,$3,$4,$5,'active')""",
            uid, email, auth.hash_password(password), role, plan,
        )
    else:
        uid = str(row["id"])
        await p.execute(
            "UPDATE users SET password_hash = $2, role = $3, status = 'active' WHERE id = $1",
            uid, auth.hash_password(password), role,
        )
    await p.execute(
        """INSERT INTO balances(user_id, balance_micro) VALUES ($1,$2)
           ON CONFLICT (user_id) DO UPDATE SET balance_micro = EXCLUDED.balance_micro, updated_at = now()""",
        uid, balance_idr * 1_000_000,
    )
    return password


async def main() -> None:
    await db.init_pool()
    admin_pw = await upsert(ADMIN_EMAIL, "admin", "pro", 100_000)
    cust_pw = await upsert(CUSTOMER_EMAIL, "customer", "free", 25_000)
    out = Path("/root/projects/aethinkai-gateway/.admin")
    out.write_text(f"admin {ADMIN_EMAIL} {admin_pw}\ncustomer {CUSTOMER_EMAIL} {cust_pw}\n")
    out.chmod(0o600)
    print("credentials written to .admin")
    await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
