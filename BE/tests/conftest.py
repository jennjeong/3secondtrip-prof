"""Pytest 공용 설정 — 실제 dev DB를 건드리지 않도록 격리한다.

app.core.config 의 Settings 는 import 시점에 lru_cache 로 한 번만 로드되므로,
**어떤 app 모듈을 import 하기 전에** 환경변수를 먼저 세팅해야 한다.  그래서
이 파일 최상단(테스트 수집 전에 가장 먼저 import 됨)에서 env 를 덮어쓴다.
"""
import os
import tempfile

from cryptography.fernet import Fernet

# ── 1) app import 이전에 환경 격리 ──────────────────────────────────
_TMP = tempfile.NamedTemporaryFile(prefix="tst_test_", suffix=".sqlite3", delete=False)
_TMP.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP.name}"
os.environ["DB_ENCRYPTION_KEY"] = Fernet.generate_key().decode("ascii")
os.environ["JWT_SECRET"] = "test-secret-key-at-least-32-characters-long-0123456789"
os.environ["APP_ENV"] = "test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.database import Base, engine  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    """세션 시작 시 임시 DB에 스키마 생성, 끝나면 파일 삭제."""
    Base.metadata.create_all(bind=engine)
    init_db()
    yield
    try:
        os.unlink(_TMP.name)
    except OSError:
        pass


@pytest.fixture()
def client():
    """FastAPI TestClient (startup 이벤트 포함)."""
    with TestClient(app) as c:
        yield c
