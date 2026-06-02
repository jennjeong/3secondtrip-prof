"""Auto-migration: add is_admin / is_active columns to existing users table."""
from sqlalchemy import inspect, text
from app.db.database import engine


def ensure_admin_columns() -> None:
    """ALTER TABLE users ADD COLUMN is_admin/is_active if missing.

    Works on both SQLite (DEFAULT 0/1) and Postgres (DEFAULT FALSE/TRUE).
    On a fresh Postgres DB this is a no-op — create_all already makes the
    columns; it only fires when upgrading an older SQLite DB in place.
    """
    insp = inspect(engine)
    try:
        cols = {c["name"] for c in insp.get_columns("users")}
    except Exception:
        return  # users table doesn't exist yet — create_all will handle it

    is_pg = engine.dialect.name == "postgresql"
    false_lit, true_lit = ("FALSE", "TRUE") if is_pg else ("0", "1")

    to_add = []
    if "is_admin" not in cols:
        to_add.append(("is_admin",  f"BOOLEAN NOT NULL DEFAULT {false_lit}"))
    if "is_active" not in cols:
        to_add.append(("is_active", f"BOOLEAN NOT NULL DEFAULT {true_lit}"))
    if not to_add:
        return

    with engine.begin() as conn:
        for col_name, col_def in to_add:
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}"))
                print(f"[migrate] added users.{col_name}")
            except Exception as e:
                print(f"[migrate] failed to add users.{col_name}: {e}")
