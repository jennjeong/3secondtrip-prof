"""비밀번호 재설정 — 1회용 링크, 만료, 재사용 방지, 가입 여부 비노출."""
import uuid
from datetime import datetime, timedelta

import pytest

from app.db.database import SessionLocal
from app.models.password_reset import PasswordReset
from app.services import password_reset_service as svc


@pytest.fixture(autouse=True)
def _reset_limiter():
    from app.routers import users
    users._reset_limit._hits.clear(); users._reset_limit._all.clear()
    yield


def _signup(client):
    s = uuid.uuid4().hex[:8]
    email = f"r_{s}@example.com"
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": f"n_{s}"})
    assert r.status_code == 200, r.text
    return email


def _issue(client, email, monkeypatch):
    """요청을 보내고, 로그에 남는 대신 발급된 토큰 원문을 가로챈다."""
    seen = {}
    real = svc.reset_link
    monkeypatch.setattr(svc, "reset_link", lambda t: seen.setdefault("token", t) and real(t))
    r = client.post("/users/password-reset/request", json={"email": email})
    assert r.status_code == 202, r.text
    return seen.get("token")


def test_feature_flag_on_in_test_env(client):
    assert client.get("/api/features").json()["password_reset"] is True


def test_unknown_email_gets_same_response(client, monkeypatch):
    assert _issue(client, "nobody-" + uuid.uuid4().hex[:6] + "@example.com", monkeypatch) is None


def test_full_reset_flow(client, monkeypatch):
    email = _signup(client)
    token = _issue(client, email, monkeypatch)
    assert token
    r = client.post("/users/password-reset/confirm", json={"token": token, "password": "newpass99"})
    assert r.status_code == 200, r.text
    assert client.post("/users/login", json={"email": email, "password": "abc12345"}).status_code == 401
    assert client.post("/users/login", json={"email": email, "password": "newpass99"}).status_code == 200
    # 같은 링크는 다시 쓸 수 없다
    r = client.post("/users/password-reset/confirm", json={"token": token, "password": "again999x"})
    assert r.status_code == 400


def test_new_request_invalidates_old_link(client, monkeypatch):
    email = _signup(client)
    old = _issue(client, email, monkeypatch)
    new = _issue(client, email, monkeypatch)
    assert old != new
    assert client.post("/users/password-reset/confirm", json={"token": old, "password": "newpass99"}).status_code == 400
    assert client.post("/users/password-reset/confirm", json={"token": new, "password": "newpass99"}).status_code == 200


def test_expired_link_rejected(client, monkeypatch):
    email = _signup(client)
    token = _issue(client, email, monkeypatch)
    db = SessionLocal()
    try:
        row = db.query(PasswordReset).filter(PasswordReset.token_hash == svc._hash(token)).first()
        row.expires_at = datetime.utcnow() - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()
    assert client.post("/users/password-reset/confirm", json={"token": token, "password": "newpass99"}).status_code == 400


def test_weak_password_rejected(client, monkeypatch):
    email = _signup(client)
    token = _issue(client, email, monkeypatch)
    assert client.post("/users/password-reset/confirm", json={"token": token, "password": "short"}).status_code == 422


def test_token_not_stored_in_plain(client, monkeypatch):
    email = _signup(client)
    token = _issue(client, email, monkeypatch)
    db = SessionLocal()
    try:
        assert db.query(PasswordReset).filter(PasswordReset.token_hash == token).first() is None
    finally:
        db.close()


def test_disabled_in_production_without_mail(client, monkeypatch):
    monkeypatch.setattr(svc.settings, "app_env", "production")
    monkeypatch.setattr(svc.settings, "resend_api_key", "")
    assert client.get("/api/features").json()["password_reset"] is False
    assert client.post("/users/password-reset/request", json={"email": "a@example.com"}).status_code == 503


def test_rate_limited(client):
    codes = [client.post("/users/password-reset/request", json={"email": "x@example.com"}).status_code for _ in range(7)]
    assert 429 in codes


@pytest.mark.parametrize("path", ["/auth/google/callback", "/auth/kakao/callback", "/auth/naver/callback", "/auth/apple/callback"])
def test_oauth_cancel_returns_to_app(client, path):
    r = client.get(path + "?error=access_denied&state=x", follow_redirects=False)
    assert r.status_code == 302
    assert "#login_error=cancelled" in r.headers["location"]


def test_oauth_bad_state_returns_to_app(client):
    r = client.get("/auth/google/callback?code=abc&state=forged", follow_redirects=False)
    assert r.status_code == 302
    assert "#login_error=state" in r.headers["location"]
