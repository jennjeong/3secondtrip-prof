"""저장한 일정 — 본인만 보고 고치고 지울 수 있다."""


def _login(client, tag):
    r = client.post("/users/signup", json={"email": f"sc-{tag}@qa-local.dev", "password": "Sc-test-pass-1!", "nickname": f"sc{tag}"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


TRIP = {"city": "도쿄", "days": [{"date": "2026-12-07", "activities": [{"name": "센소지", "memo": "개인 메모"}]}]}


def test_owner_round_trip(client):
    me = _login(client, "o1")
    s = client.post("/schedules", json={"title": "도쿄", "schedule_data": TRIP, "is_saved": True}, headers=me).json()
    assert client.patch(f"/schedules/{s['id']}", json={"title": "도쿄 가족여행"}, headers=me).json()["title"] == "도쿄 가족여행"
    assert client.delete(f"/schedules/{s['id']}/save", headers=me).json()["is_saved"] is False
    assert client.post(f"/schedules/{s['id']}/save", headers=me).json()["is_saved"] is True


def test_other_user_cannot_touch_schedule(client):
    me = _login(client, "p1")
    other = _login(client, "p2")
    s = client.post("/schedules", json={"title": "내 일정", "schedule_data": TRIP, "is_saved": True}, headers=me).json()
    url = f"/schedules/{s['id']}"
    assert client.get(url, headers=other).status_code == 404
    assert client.patch(url, json={"title": "남이 고침"}, headers=other).status_code == 404
    assert client.delete(url, headers=other).status_code == 404
    assert all(x["id"] != s["id"] for x in client.get("/schedules", headers=other).json())
    assert client.get(url).status_code in (401, 403)
