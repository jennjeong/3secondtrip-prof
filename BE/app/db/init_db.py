"""SQLite 초기화 — 데이터 디렉토리 보장 + 모든 테이블 생성 + 시드."""
import os
from urllib.parse import urlparse

from app.core.config import settings
from app.db.database import Base, engine

# 모델 import — Base.metadata 에 등록되도록
from app.models import user, trip, schedule, booking, roadmap, blog, review, feedback, survey, trip_place   # noqa: F401


def _ensure_sqlite_dir() -> None:
    url = settings.database_url
    if not url.startswith("sqlite"):
        return
    # sqlite:///./data/x.sqlite3 → ./data/x.sqlite3
    path = url.split("///", 1)[1] if "///" in url else url
    dir_ = os.path.dirname(path)
    if dir_:
        os.makedirs(dir_, exist_ok=True)


def init_db() -> None:
    _ensure_sqlite_dir()
    Base.metadata.create_all(bind=engine)
    # ── Auto-migrate older DBs that lack newer columns ──
    try:
        from app.db.migrate_admin_flag import ensure_admin_columns
        ensure_admin_columns()
    except Exception as e:
        import logging; logging.getLogger('init_db').warning('admin-col migrate skipped: %s', e)
    # Seed popular roadmaps if empty
    try:
        from app.db.seed import seed_roadmaps_if_empty
        seed_roadmaps_if_empty()
    except Exception as e:                                          # pragma: no cover
        # Seeding is best-effort — never block startup
        import logging; logging.getLogger("init_db").warning("seed skipped: %s", e)
