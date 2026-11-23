"""후기 수정 — 작성자만, 범위 검사."""


def _login(client, tag):
    r = client.post("/users/signup", json={"email": f"rv-{tag}@qa-local.dev", "password": "Rv-test-pass-1!", "nickname": tag})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_owner_can_update_review(client):
    me = _login(client, "a1")
    rv = client.post("/reviews", json={"rating": 4, "content": "좋아요", "is_public": False}, headers=me).json()
    r = client.patch(f"/reviews/{rv['id']}", json={"rating": 5, "content": "아주 좋아요", "is_public": True}, headers=me)
    assert r.status_code == 200
    assert r.json()["rating"] == 5 and r.json()["is_public"] is True
    assert client.patch(f"/reviews/{rv['id']}", json={"rating": 9}, headers=me).status_code == 422


def test_other_user_cannot_update_review(client):
    me = _login(client, "b1")
    other = _login(client, "b2")
    rv = client.post("/reviews", json={"rating": 3, "content": "보통"}, headers=me).json()
    assert client.patch(f"/reviews/{rv['id']}", json={"content": "남이 고침"}, headers=other).status_code == 404
