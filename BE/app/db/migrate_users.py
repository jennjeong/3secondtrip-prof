"""One-shot SQLite migration for the User table.

SQLAlchemy create_all() doesn't add new columns to existing tables.
This script adds the new columns introduced by the redesigned backend
(password_hash, name, phone, birth_date, email_normalized) when they
are missing.  Safe to run multiple times — checks PRAGMA table_info first.

Usage:
    cd backend
    python -m app.db.migrate_users
"""
from sqlalchemy import text
from app.db.database import engine

NEW_COLS = {
    "password_hash":    "VARCHAR(255)",
    "name":             "VARCHAR(80)",
    "phone":            "VARCHAR(30)",
    "birth_date":       "DATE",
    "email_normalized": "VARCHAR(255)",
}


def run() -> None:
    with engine.connect() as conn:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()}
        if not cols:
            print("[migrate_users] users table not found — run the server once first to create it.")
            return
        for name, ddl in NEW_COLS.items():
            if name in cols:
                continue
            print(f"[migrate_users] adding column users.{name} {ddl}")
            conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
        # Backfill email_normalized from email
        if "email_normalized" in NEW_COLS:
            conn.execute(text("UPDATE users SET email_normalized = lower(trim(email)) WHERE email IS NOT NULL AND (email_normalized IS NULL OR email_normalized = '')"))
        # Index on email_normalized
        try:
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_norm ON users(email_normalized)"))
        except Exception:
            pass
        conn.commit()
    print("[migrate_users] done")


if __name__ == "__main__":
    run()
