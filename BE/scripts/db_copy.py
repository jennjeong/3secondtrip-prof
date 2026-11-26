"""DB 를 통째로 다른 DB 로 복사한다(백업·이사용).

Render 무료 Postgres 는 만든 지 30일 뒤 만료되므로, 만료 전에
  - 내 컴퓨터의 SQLite 파일로 백업하거나
  - 새 Postgres(새 Render DB, Neon, Supabase 등)로 옮길 때 쓴다.

주소는 환경 변수로만 받고 화면에 찍지 않는다.
  SOURCE_DB_URL  복사할 DB(예: Render 의 External Database URL)
  TARGET_DB_URL  받을 DB. 비우면 BE/data/backup-<날짜>.sqlite3 에 백업한다.

실행(BE 폴더에서):
  SOURCE_DB_URL='...' .venv/bin/python scripts/db_copy.py
  SOURCE_DB_URL='...' TARGET_DB_URL='...' .venv/bin/python scripts/db_copy.py

값은 그대로 옮긴다(암호화된 개인정보도 암호문 그대로). 새 서버에서 읽으려면
DB_ENCRYPTION_KEY 를 지금 서버와 같은 값으로 두어야 한다.
받을 DB 에 이미 행이 있는 표가 있으면 덮어쓰지 않고 멈춘다.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path

from sqlalchemy import MetaData, Table, create_engine, func, inspect, select, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _norm(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _engine(url: str):
    kw = {"future": True}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kw)


def _model_metadata():
    from app.db.database import Base
    import app.models  # noqa: F401
    from app.models import (user, trip, schedule, booking, roadmap, blog, review, feedback, survey,  # noqa: F401
                            trip_place, password_reset, feedback_attachment, local_course, event_count,
                            landmark_image, shared_trip)
    return Base.metadata


def copy_db(source_url: str, target_url: str, out=print) -> dict:
    src, dst = _engine(_norm(source_url)), _engine(_norm(target_url))
    meta = _model_metadata()
    meta.create_all(bind=dst)                       # 받을 쪽 표를 앱 모델 그대로 만든다

    src_names = set(inspect(src).get_table_names())
    dst_names = set(inspect(dst).get_table_names())
    order = [t.name for t in meta.sorted_tables]    # 외래 키 순서
    order += sorted(src_names - set(order))         # 모델에 없는 표도 함께 옮긴다
    counts = {}
    with src.connect() as sc, dst.begin() as dc:
        for name in order:
            if name not in src_names:
                continue
            s_tab = Table(name, MetaData(), autoload_with=src)
            if name not in dst_names and name not in meta.tables:
                s_tab.metadata.create_all(bind=dc)
            d_tab = Table(name, MetaData(), autoload_with=dc)
            if dc.execute(select(func.count()).select_from(d_tab)).scalar():
                raise SystemExit(f"받을 DB 의 '{name}' 표가 비어 있지 않아 멈췄어요. 빈 DB 로 다시 해 주세요.")
            cols = [c.name for c in s_tab.columns if c.name in d_tab.c]
            rows = [dict(r._mapping) for r in sc.execute(select(*[s_tab.c[c] for c in cols]))]
            for i in range(0, len(rows), 500):
                dc.execute(d_tab.insert(), rows[i:i + 500])
            counts[name] = len(rows)
            out(f"  {name}: {len(rows)}행")
        if dst.dialect.name == "postgresql":         # 다음 id 가 겹치지 않게 순번을 맞춘다
            for name in counts:
                d_tab = Table(name, MetaData(), autoload_with=dc)
                pk = [c for c in d_tab.primary_key.columns]
                if len(pk) == 1 and pk[0].autoincrement in (True, "auto") and counts[name]:
                    dc.execute(text(f"SELECT setval(pg_get_serial_sequence('\"{name}\"', '{pk[0].name}'), "
                                    f"(SELECT MAX(\"{pk[0].name}\") FROM \"{name}\"))"))
    # 옮긴 뒤 양쪽 행 수가 같은지 확인
    with src.connect() as sc, dst.connect() as dc:
        for name, n in counts.items():
            m = dc.execute(select(func.count()).select_from(Table(name, MetaData(), autoload_with=dc))).scalar()
            if m != n:
                raise SystemExit(f"'{name}' 행 수가 달라요: 원본 {n}, 복사본 {m}")
    return counts


def main() -> None:
    source = os.environ.get("SOURCE_DB_URL", "").strip()
    if not source:
        raise SystemExit("SOURCE_DB_URL 을 넣어 주세요(Render DB 화면의 External Database URL).")
    target = os.environ.get("TARGET_DB_URL", "").strip()
    if not target:
        path = ROOT / "data" / f"backup-{dt.datetime.now():%Y%m%d-%H%M}.sqlite3"
        path.parent.mkdir(parents=True, exist_ok=True)
        target = f"sqlite:///{path}"
        print(f"백업 파일: {path}")
    counts = copy_db(source, target)
    print(f"끝났어요: 표 {len(counts)}개, 모두 {sum(counts.values())}행. 원본과 행 수가 같아요.")


if __name__ == "__main__":
    main()
