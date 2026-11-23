"""운영 요약 — 관리자만 볼 수 있고, 이벤트 개수로 비율을 만든다."""
from app.db.database import SessionLocal
from app.models.user import User
from app.routers import events


def _signup(client, tag):
    r = client.post("/users/signup", json={"email": f"ops-{tag}@qa-local.dev", "password": "Ops-test-pass-1!", "nickname": f"ops{tag}"})
    assert r.status_code == 200, r.text
    return r.json()


def _admin_headers(client, tag):
    me = _signup(client, tag)
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == me["user"]["id"]).first()
        u.is_admin = True
        db.commit()
    finally:
        db.close()
    return {"Authorization": f"Bearer {me['access_token']}"}


def test_ops_requires_admin(client):
    me = _signup(client, "u1")
    r = client.get("/admin/ops", headers={"Authorization": f"Bearer {me['access_token']}"})
    assert r.status_code in (401, 403)


def test_ops_summary_counts(client):
    events._limit._hits.clear()
    events._limit._all.clear()
    h = _admin_headers(client, "a1")
    before = client.get("/admin/ops", headers=h).json()
    names = (["trip_generate_start"] * 4 + ["trip_generate_done"] * 3 + ["trip_generate_fail"]
             + ["gen_price_estimated"] * 2 + ["gen_price_live", "api_fail_places", "trip_save_fail"])
    for name in names:
        assert client.post("/api/events", json={"name": name}).status_code == 204
    after = client.get("/admin/ops", headers=h).json()
    g0, g1 = before["generation"], after["generation"]
    assert g1["started"] - g0["started"] == 4
    assert g1["failed"] - g0["failed"] == 1
    assert after["provider_failures"]["places"] - before["provider_failures"]["places"] == 1
    assert after["save"]["failed"] - before["save"]["failed"] == 1
    assert set(after["config"]) == {"places", "maps_browser_key", "live_flights_hotels", "ai_summary"}
    # 키 값 자체는 절대 내려가지 않는다
    assert all(isinstance(v, bool) for v in after["config"].values())


def test_unknown_event_rejected(client):
    events._limit._hits.clear()
    events._limit._all.clear()
    assert client.post("/api/events", json={"name": "city_tokyo"}).status_code == 422
