"""One-shot migration — widen PII columns + (re-)encrypt existing values.

SQLite can\'t ALTER COLUMN TYPE/LENGTH directly, so we:
  1. Read all rows
  2. Drop and recreate the users table with the new schema
  3. Re-insert rows, encrypting any plaintext PII

Safe to run multiple times — already-encrypted rows are detected by their
Fernet "gAAAAA" prefix and skipped.

Usage:
    cd backend
    python -m app.db.migrate_encrypt_pii
"""
import logging

from sqlalchemy import text

from app.core.crypto import encrypt_str, is_encrypted
from app.db.database import engine, SessionLocal

logger = logging.getLogger("migrate_encrypt_pii")
logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")


def _column_info(conn):
    return {row[1]: row for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()}


def _needs_widening(conn) -> bool:
    cols = _column_info(conn)
    if not cols:
        return False
    # name was VARCHAR(80), phone VARCHAR(30), birth_date DATE — all too small for Fernet.
    # We detect via a width check on a representative column.
    schema_sql = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=\'users\'")
    ).fetchone()
    if not schema_sql:
        return False
    sql = schema_sql[0]
    return ("name VARCHAR(80)" in sql or "phone VARCHAR(30)" in sql or "birth_date DATE" in sql)


def run() -> None:
    db = SessionLocal()
    try:
        with engine.begin() as conn:
            if not _needs_widening(conn):
                logger.info("users table already has wide PII columns — nothing to do.")
                return

            logger.info("Rebuilding users table with widened PII columns...")
            # Snapshot existing data
            rows = conn.execute(text("SELECT * FROM users")).fetchall()
            col_names = list(_column_info(conn).keys())
            logger.info("  read %d rows / %d columns", len(rows), len(col_names))

            # Detach old indexes that reference users
            for idx_row in conn.execute(text("SELECT name FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'users\'")).fetchall():
                conn.execute(text(f"DROP INDEX IF EXISTS {idx_row[0]}"))

            conn.execute(text("DROP TABLE users"))
            # Recreate from model
            from app.db.database import Base
            from app.models import user as _u   # noqa
            Base.metadata.tables["users"].create(bind=conn)
            logger.info("  table recreated with EncryptedString/EncryptedDate columns")

            # Re-insert, encrypting PII on the way in
            for r in rows:
                d = dict(zip(col_names, r))
                # The SQLAlchemy TypeDecorator handles encryption on write, but
                # only if we go through the ORM.  For raw SQL we pre-encrypt.
                if d.get("name") and not is_encrypted(d["name"]):
                    d["name"] = encrypt_str(d["name"])
                if d.get("phone") and not is_encrypted(d["phone"]):
                    d["phone"] = encrypt_str(d["phone"])
                if d.get("birth_date") and not is_encrypted(str(d["birth_date"])):
                    d["birth_date"] = encrypt_str(str(d["birth_date"])[:10])
                # Filter to known columns
                from app.models.user import User
                model_cols = {c.name for c in User.__table__.columns}
                d = {k: v for k, v in d.items() if k in model_cols}
                placeholders = ", ".join(f":{k}" for k in d)
                cols_sql = ", ".join(d.keys())
                conn.execute(text(f"INSERT INTO users ({cols_sql}) VALUES ({placeholders})"), d)
            logger.info("  re-inserted %d rows with encrypted PII", len(rows))

        logger.info("✅ migration complete")
    finally:
        db.close()


if __name__ == "__main__":
    run()
