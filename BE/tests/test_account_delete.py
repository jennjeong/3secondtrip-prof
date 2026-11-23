"""계정 삭제 — 확인 문구·비밀번호 확인, 데이터 삭제, 토큰 거절, 같은 이메일 재가입."""
import uuid

import pytest


@pytest.fixture(autouse=True)
def _reset_limiter():
    from app.routers import users
    users._change_limit._hits.clear(); users._change_limit._all.clear()
    yield


def _signup(client):
    s = uuid.uuid4().hex[:8]
    email = f"d_{s}@example.com"
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": f"d_{s}"})
    assert r.status_code == 200, r.text
    return email, r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_requires_exact_confirm_text(client):
    _, t = _signup(client)
    r = client.post("/users/me/delete", json={"confirm": "삭제", "password": "abc12345"}, headers=_h(t))
    assert r.status_code == 400
    assert client.get("/users/me", headers=_h(t)).status_code == 200


def test_requires_password_for_email_account(client):
    _, t = _signup(client)
    r = client.post("/users/me/delete", json={"confirm": "계정 삭제", "password": "wrong999"}, headers=_h(t))
    assert r.status_code == 400
    r = client.post("/users/me/delete", json={"confirm": "계정 삭제"}, headers=_h(t))
    assert r.status_code == 400
    assert client.get("/users/me", headers=_h(t)).status_code == 200


def test_delete_removes_user_data_and_revokes_tokens(client):
    email, t = _signup(client)
    rv = client.post("/reviews", json={"rating": 5, "content": "삭제 테스트 후기입니다.", "is_public": True, "city": "도쿄"}, headers=_h(t))
    assert rv.status_code in (200, 201), rv.text
    rid = rv.json()["id"]
    r = client.post("/users/me/delete", json={"confirm": "계정 삭제", "password": "abc12345"}, headers=_h(t))
    assert r.status_code == 200, r.text
    assert r.json()["deleted"]["reviews"] == 1
    assert client.get("/users/me", headers=_h(t)).status_code == 401
    assert client.post("/users/login", json={"email": email, "password": "abc12345"}).status_code == 401
    ids = [x["id"] for x in client.get("/reviews/recent").json()] if client.get("/reviews/recent").status_code == 200 else []
    assert rid not in ids
    # 같은 이메일로 다시 가입할 수 있다
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": "again_" + uuid.uuid4().hex[:6]})
    assert r.status_code == 200, r.text


def test_requires_login(client):
    assert client.post("/users/me/delete", json={"confirm": "계정 삭제"}).status_code == 401
