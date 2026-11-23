"""로그인 상태에서 비밀번호 변경 · 모든 기기에서 로그아웃."""
import uuid

import pytest


@pytest.fixture(autouse=True)
def _reset_limiter():
    from app.routers import users
    users._change_limit._hits.clear(); users._change_limit._all.clear()
    yield


def _signup(client):
    s = uuid.uuid4().hex[:8]
    email = f"a_{s}@example.com"
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": f"n_{s}"})
    assert r.status_code == 200, r.text
    return email, r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _login(client, email, pw):
    return client.post("/users/login", json={"email": email, "password": pw})


def test_change_password_keeps_this_device_and_signs_out_others(client):
    email, phone = _signup(client)
    laptop = _login(client, email, "abc12345").json()["access_token"]
    r = client.post("/users/me/password", json={"current_password": "abc12345", "new_password": "newpass99"}, headers=_h(phone))
    assert r.status_code == 200, r.text
    new_phone = r.json()["access_token"]
    assert client.get("/users/me", headers=_h(new_phone)).status_code == 200
    for old in (phone, laptop):
        r = client.get("/users/me", headers=_h(old))
        assert r.status_code == 401 and r.json()["detail"] == "token_revoked"
    assert _login(client, email, "abc12345").status_code == 401
    assert _login(client, email, "newpass99").status_code == 200


def test_wrong_current_password_rejected(client):
    _, t = _signup(client)
    r = client.post("/users/me/password", json={"current_password": "wrong999x", "new_password": "newpass99"}, headers=_h(t))
    assert r.status_code == 400
    assert client.get("/users/me", headers=_h(t)).status_code == 200   # 실패하면 로그인 유지


def test_same_password_rejected(client):
    _, t = _signup(client)
    r = client.post("/users/me/password", json={"current_password": "abc12345", "new_password": "abc12345"}, headers=_h(t))
    assert r.status_code == 400


def test_weak_new_password_rejected(client):
    _, t = _signup(client)
    r = client.post("/users/me/password", json={"current_password": "abc12345", "new_password": "short"}, headers=_h(t))
    assert r.status_code == 422


def test_change_requires_login(client):
    r = client.post("/users/me/password", json={"current_password": "abc12345", "new_password": "newpass99"})
    assert r.status_code == 401


def test_social_account_cannot_change_password(client):
    from app.core.security import create_access_token
    from app.db.database import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    try:
        s = uuid.uuid4().hex[:8]
        u = User(provider="google", provider_user_id=f"g_{s}", email=f"g_{s}@example.com", nickname=f"g_{s}")
        db.add(u); db.commit(); db.refresh(u)
        t = create_access_token(user_id=u.id, token_version=0)
    finally:
        db.close()
    r = client.post("/users/me/password", json={"current_password": "x", "new_password": "newpass99"}, headers=_h(t))
    assert r.status_code == 400


def test_change_is_rate_limited(client):
    _, t = _signup(client)
    codes = [client.post("/users/me/password", json={"current_password": "wrong999x", "new_password": "newpass99"}, headers=_h(t)).status_code for _ in range(7)]
    assert 429 in codes


def test_logout_all_signs_out_every_device(client):
    email, a = _signup(client)
    b = _login(client, email, "abc12345").json()["access_token"]
    assert client.post("/users/me/logout-all", headers=_h(a)).status_code == 200
    for t in (a, b):
        assert client.get("/users/me", headers=_h(t)).status_code == 401
    # 비밀번호는 그대로라 다시 로그인할 수 있다
    fresh = _login(client, email, "abc12345").json()["access_token"]
    assert client.get("/users/me", headers=_h(fresh)).status_code == 200


def test_logout_all_requires_login(client):
    assert client.post("/users/me/logout-all").status_code == 401
