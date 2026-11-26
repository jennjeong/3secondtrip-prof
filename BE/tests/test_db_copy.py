"""DB 복사 도구: 원본의 모든 행이 그대로 옮겨지고, 비어 있지 않은 DB 에는 덮어쓰지 않는다."""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from db_copy import copy_db  # noqa: E402


def _make_source(path: Path) -> None:
    from sqlalchemy import create_engine
    from db_copy import _model_metadata
    eng = create_engine(f"sqlite:///{path}")
    _model_metadata().create_all(bind=eng)
    con = sqlite3.connect(path)
    cols = [r[1] for r in con.execute("PRAGMA table_info(local_courses)")]
    assert "title" in cols
    con.execute("CREATE TABLE extra_notes (id INTEGER PRIMARY KEY, body TEXT)")
    con.executemany("INSERT INTO extra_notes (id, body) VALUES (?, ?)", [(1, "가"), (2, "나")])
    con.commit(); con.close()


def test_copy_all_rows_and_refuse_non_empty(tmp_path):
    src, dst = tmp_path / "src.sqlite3", tmp_path / "dst.sqlite3"
    _make_source(src)
    counts = copy_db(f"sqlite:///{src}", f"sqlite:///{dst}", out=lambda *_: None)
    assert counts["extra_notes"] == 2
    con = sqlite3.connect(dst)
    assert con.execute("SELECT body FROM extra_notes ORDER BY id").fetchall() == [("가",), ("나",)]
    con.close()
    with pytest.raises(SystemExit):
        copy_db(f"sqlite:///{src}", f"sqlite:///{dst}", out=lambda *_: None)
