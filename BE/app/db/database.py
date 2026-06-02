"""SQLAlchemy engine + Session + Base + get_db().

Driver-agnostic: SQLite for local dev, PostgreSQL (psycopg3) in production.
The active database is chosen purely by DATABASE_URL — no code change needed.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings


def _normalize_db_url(url: str) -> str:
    """Normalize a DATABASE_URL so it always uses a driver we ship.

    Render (and Heroku-style providers) hand out `postgres://...` or
    `postgresql://...`, but SQLAlchemy 2.0 maps the bare `postgresql://`
    scheme to psycopg2 — which we don't install.  Force the psycopg3
    driver so the same URL works whether it comes from Render or .env.
    SQLite URLs are left untouched.
    """
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalize_db_url(settings.database_url)
_is_sqlite = DATABASE_URL.startswith("sqlite")

# SQLite needs check_same_thread=False (one connection across threads).
# Postgres needs pool_pre_ping so dropped connections (Render idles them)
# are recycled instead of raising on the next request.
engine_kwargs = {"future": True}
if _is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 1800   # recycle conns older than 30 min

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)

Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a SQLAlchemy session and closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
