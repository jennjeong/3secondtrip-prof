"""Auto-migration: add is_admin / is_active columns to existing users table."""
from sqlalchemy import inspect, text
from app.db.database import engine


def ensure_admin_columns() -> None:
    """ALTER TABLE users ADD COLUMN is_admin/is_active if missing. SQLite-friendly."""
    insp = inspect(engine)
    try:
        cols = {c["name"] for c in insp.get_columns("users")}
    except Exception:
        return  # users table doesn't exist yet — create_all will handle it

    to_add = []
    if "is_admin" not in cols:
        to_add.append(("is_admin",  "BOOLEAN NOT NULL DEFAULT 0"))
    if "is_active" not in cols:
        to_add.append(("is_active", "BOOLEAN NOT NULL DEFAULT 1"))
    if not to_add:
        return

    with engine.begin() as conn:
        for col_name, col_def in to_add:
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}"))
                print(f"[migrate] added users.{col_name}")
            except Exception as e:
                print(f"[migrate] failed to add users.{col_name}: {e}")
