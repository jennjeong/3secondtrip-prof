"""로드맵 API — 좋아요 수는 작성자가 조작할 수 없다."""
import uuid


def _auth(client):
    s = uuid.uuid4().hex[:8]
    r = client.post("/users/signup", json={"email": f"r_{s}@example.com", "password": "abc12345", "nickname": f"r_{s}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_public_list_returns_seeded_roadmaps(client):
    r = client.get("/roadmaps?limit=50")
    assert r.status_code == 200
    assert {"도쿄", "파리"} <= {x["city"] for x in r.json()}


def test_likes_cannot_be_set_on_create_or_update(client):
    h = _auth(client)
    r = client.post("/roadmaps", json={"title": "t", "city": "도쿄", "likes": 999999}, headers=h)
    assert r.status_code == 201
    assert r.json()["likes"] == 0
    r = client.patch(f"/roadmaps/{r.json()['id']}", json={"likes": 999999}, headers=h)
    assert r.status_code == 200
    assert r.json()["likes"] == 0
