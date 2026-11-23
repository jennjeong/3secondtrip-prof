"""후기·블로그 — 새로고침·재전송으로 같은 글이 두 번 저장되지 않는다."""
import uuid


def _h(client):
    s = uuid.uuid4().hex[:8]
    r = client.post("/users/signup", json={"email": f"d_{s}@example.com", "password": "abc12345", "nickname": f"d_{s}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_review_resend_returns_same(client):
    h = _h(client)
    body = {"rating": 5, "content": "좋았어요 " + uuid.uuid4().hex[:6], "concept_tags": [], "is_public": False, "city": "도쿄"}
    a = client.post("/reviews", json=body, headers=h)
    b = client.post("/reviews", json=body, headers=h)
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    assert b.headers.get("X-Duplicate") == "1"


def test_different_review_is_new(client):
    h = _h(client)
    a = client.post("/reviews", json={"rating": 5, "content": "A", "is_public": False, "city": "도쿄"}, headers=h)
    b = client.post("/reviews", json={"rating": 4, "content": "A", "is_public": False, "city": "도쿄"}, headers=h)
    assert a.json()["id"] != b.json()["id"]


def test_blog_resend_returns_same(client):
    h = _h(client)
    body = {"title": "도쿄 " + uuid.uuid4().hex[:6], "tags": [], "body": "본문이 스무 자를 넘는 블로그 글입니다.", "visibility": "private"}
    a = client.post("/blogs", json=body, headers=h)
    b = client.post("/blogs", json=body, headers=h)
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]


def test_other_user_same_text_is_separate(client):
    body = {"rating": 5, "content": "같은 문장", "is_public": False, "city": "도쿄"}
    a = client.post("/reviews", json=body, headers=_h(client))
    b = client.post("/reviews", json=body, headers=_h(client))
    assert a.json()["id"] != b.json()["id"]
