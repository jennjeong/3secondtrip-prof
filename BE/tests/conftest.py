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


class _Client(TestClient):
    """예전 테스트의 `/users/signup` 한 번 호출을 '가입 + 이메일 인증'으로 이어 준다.

    가입은 이제 202(인증 대기)이고 토큰은 인증 뒤에 나온다. 동의 항목(agree_*)이 없는 예전 형식의
    요청이면 동의를 넣어 가입하고, 개발 환경 응답의 dev_code 로 바로 인증해 인증 응답(토큰 포함)을 돌려준다.
    가입·인증 자체를 시험하는 테스트는 agree_* 를 넣어 보내면 이 도우미를 거치지 않는다.
    """
    def post(self, url, *a, **kw):
        body = kw.get("json")
        if url == "/users/signup" and isinstance(body, dict) and "agree_terms" not in body:
            r = super().post(url, json={**body, "agree_terms": True, "agree_privacy": True, "agree_age": True})
            if r.status_code != 202:
                return r
            code = r.json().get("dev_code")
            return super().post("/users/verify-email", json={"email": body["email"], "code": code})
        return super().post(url, *a, **kw)


@pytest.fixture()
def client():
    """FastAPI TestClient (startup 이벤트 포함)."""
    with _Client(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_auth_limits():
    """가입·로그인·인증 요청 제한은 테스트마다 새로 — 여러 테스트가 같은 IP(testclient)로 가입한다."""
    from app.routers import users
    for lim in (users._signup_limit, users._login_limit, users._verify_limit):
        lim._hits.clear(); lim._all.clear()
    yield
