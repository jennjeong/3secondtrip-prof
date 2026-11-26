"""Auto-migration: 함께 편집 일정에 보기 전용 링크(view_token) 칸을 더한다.

예전 행에는 새 보기 전용 토큰을 채워 넣는다(편집 링크는 그대로).
"""
import secrets

from sqlalchemy import inspect, text
from app.db.database import engine


def ensure_shared_trip_view_token() -> None:
    insp = inspect(engine)
    try:
        cols = {c["name"] for c in insp.get_columns("shared_trips")}
    except Exception:
        return
    with engine.begin() as conn:
        if "view_token" not in cols:
            conn.execute(text("ALTER TABLE shared_trips ADD COLUMN view_token VARCHAR(64) NULL"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_shared_trips_view_token ON shared_trips (view_token)"))
            print("[migrate] added shared_trips.view_token")
        rows = conn.execute(text("SELECT token FROM shared_trips WHERE view_token IS NULL")).scalars().all()
        for tok in rows:
            conn.execute(text("UPDATE shared_trips SET view_token = :v WHERE token = :t"),
                         {"v": secrets.token_urlsafe(32), "t": tok})
        if rows:
            print(f"[migrate] filled view_token for {len(rows)} shared trips")
