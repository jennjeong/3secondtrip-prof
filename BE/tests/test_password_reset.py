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


# ── 비밀번호를 바꾸면 다른 기기의 로그인이 끊긴다 ──────────────────────
def _login(client, email, pw):
    r = client.post("/users/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _me(client, token):
    return client.get("/users/me", headers={"Authorization": f"Bearer {token}"})


def test_reset_signs_out_other_devices(client, monkeypatch):
    email = _signup(client)
    phone = _login(client, email, "abc12345")
    laptop = _login(client, email, "abc12345")
    assert _me(client, phone).status_code == 200
    token = _issue(client, email, monkeypatch)
    assert client.post("/users/password-reset/confirm", json={"token": token, "password": "newpass99"}).status_code == 200
    for old in (phone, laptop):
        r = _me(client, old)
        assert r.status_code == 401
        assert r.json()["detail"] == "token_revoked"
    fresh = _login(client, email, "newpass99")
    assert _me(client, fresh).status_code == 200


def test_old_token_without_version_still_works_until_reset(client, monkeypatch):
    """배포 전에 발급된(tv 없는) 토큰은 배포만으로 끊기지 않는다."""
    from app.core.security import create_access_token
    email = _signup(client)
    uid = _me(client, _login(client, email, "abc12345")).json()["id"]
    legacy = create_access_token(user_id=uid)          # tv 없음
    assert _me(client, legacy).status_code == 200
    token = _issue(client, email, monkeypatch)
    client.post("/users/password-reset/confirm", json={"token": token, "password": "newpass99"})
    assert _me(client, legacy).status_code == 401


def test_revoked_token_is_guest_on_optional_routes(client, monkeypatch):
    """로그인이 선택인 API(피드백 등)에서는 옛 토큰을 비회원으로 취급한다."""
    email = _signup(client)
    old = _login(client, email, "abc12345")
    token = _issue(client, email, monkeypatch)
    client.post("/users/password-reset/confirm", json={"token": token, "password": "newpass99"})
    from app.routers import feedback
    feedback._create_limit._hits.clear(); feedback._create_limit._all.clear()
    r = client.post("/feedback", json={"feedback_type": "etc", "content": "c"}, headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 201
    assert r.json()["user_id"] is None
