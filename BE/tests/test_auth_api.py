"""이메일 회원가입/로그인 API — 엔드투엔드 (TestClient)."""
import uuid


def _unique():
    s = uuid.uuid4().hex[:8]
    return f"u_{s}@example.com", f"nick_{s}"


def test_signup_returns_token_and_user(client):
    email, nick = _unique()
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["user"]["email"] == email
    assert body["user"]["nickname"] == nick


def test_login_succeeds_with_correct_password(client):
    email, nick = _unique()
    client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick})
    r = client.post("/users/login", json={"email": email, "password": "abc12345"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


def test_login_fails_with_wrong_password(client):
    email, nick = _unique()
    client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick})
    r = client.post("/users/login", json={"email": email, "password": "wrongpass1"})
    assert r.status_code == 401


def test_signup_rejects_weak_password(client):
    email, nick = _unique()
    # 숫자 없는 비밀번호 → 422 (스키마 복잡도 검증)
    r = client.post("/users/signup", json={"email": email, "password": "abcdefgh", "nickname": nick})
    assert r.status_code == 422


def test_duplicate_email_conflicts(client):
    email, nick = _unique()
    client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick})
    _, nick2 = _unique()
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick2})
    assert r.status_code == 409


def test_check_nickname_reports_taken(client):
    email, nick = _unique()
    client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick})
    r = client.get("/users/check-nickname", params={"nickname": nick})
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_me_requires_auth(client):
    assert client.get("/auth/me").status_code == 401


def test_me_returns_current_user_with_token(client):
    email, nick = _unique()
    token = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": nick}).json()["access_token"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["email"] == email
