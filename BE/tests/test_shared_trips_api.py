"""함께 편집 API — 토큰, 충돌 방지, 입력 제한."""
import pytest

from app.routers import shared_trips


@pytest.fixture(autouse=True)
def _reset_limits():
    for lim in (shared_trips._create_limit, shared_trips._access_limit):
        lim._hits.clear()
        lim._all.clear()


TRIP = {"city": "도쿄", "days": [{"date": "2026-11-16", "activities": [{"name": "도쿄타워"}]}]}


def _create(client):
    r = client.post("/api/shared-trips", json={"data": TRIP})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_read_update(client):
    t = _create(client)
    assert len(t["token"]) == 43
    assert client.get(f"/api/shared-trips/{t['token']}").json()["data"] == TRIP
    changed = {**TRIP, "city": "오사카"}
    r = client.put(f"/api/shared-trips/{t['token']}", json={"data": changed, "version": 1})
    assert r.status_code == 200
    assert r.json()["version"] == 2


def test_stale_version_cannot_overwrite(client):
    t = _create(client)
    url = f"/api/shared-trips/{t['token']}"
    assert client.put(url, json={"data": TRIP, "version": 1}).status_code == 200
    r = client.put(url, json={"data": {**TRIP, "city": "덮어쓰기"}, "version": 1})
    assert r.status_code == 409
    assert client.get(url).json()["data"]["city"] == "도쿄"


def test_data_is_encrypted_at_rest(client):
    from sqlalchemy import text
    from app.db.database import engine
    t = _create(client)
    with engine.connect() as c:
        raw = c.execute(text("SELECT data_json FROM shared_trips WHERE token=:t"), {"t": t["token"]}).scalar()
    assert "도쿄타워" not in raw


@pytest.mark.parametrize("token", ["x", "../../etc/passwd", "a" * 44, "A" * 43])
def test_bad_or_unknown_token_is_404(client, token):
    assert client.get(f"/api/shared-trips/{token}").status_code == 404


@pytest.mark.parametrize("data", [
    {},
    {"days": []},
    {"days": "x"},
    {"days": [{"activities": "x"}]},
    {"days": [{"activities": []}] * 32},
    {"days": [{"activities": []}], "memo": "x" * 200_001},
])
def test_invalid_shapes_are_rejected(client, data):
    assert client.post("/api/shared-trips", json={"data": data}).status_code == 422


def test_create_is_rate_limited(client):
    codes = [client.post("/api/shared-trips", json={"data": TRIP}).status_code for _ in range(6)]
    assert codes == [201] * 5 + [429]
