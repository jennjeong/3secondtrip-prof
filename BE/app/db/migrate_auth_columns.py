"""Auto-migration: 이메일 인증·약관 동의 칸을 예전 users 표에 더한다.

칸을 처음 더할 때, 이미 있던 계정은 인증된 것으로 본다(이 기능 전에 가입해 쓰던 사람이 갑자기 막히지 않게).
"""
from sqlalchemy import inspect, text
from app.db.database import engine

COLS = [
    ("email_verified_at", "TIMESTAMP NULL"),
    ("terms_version", "VARCHAR(20) NULL"),
    ("privacy_version", "VARCHAR(20) NULL"),
    ("agreed_at", "TIMESTAMP NULL"),
]


def ensure_auth_columns() -> None:
    insp = inspect(engine)
    try:
        cols = {c["name"] for c in insp.get_columns("users")}
    except Exception:
        return
    missing = [(n, d) for n, d in COLS if n not in cols]
    if not missing:
        return
    with engine.begin() as conn:
        for name, ddl in missing:
            conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
            print(f"[migrate] added users.{name}")
        if any(n == "email_verified_at" for n, _ in missing):
            conn.execute(text("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL"))
            print("[migrate] existing users marked as email-verified")
