"""출시 점검 — 남의 여행·일정·장소는 404, 보기 전용 링크는 읽기만, Idempotency-Key 로 중복 생성 방지."""
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.db.database import engine
from app.routers import shared_trips


@pytest.fixture(autouse=True)
def _reset_shared_limits():
    for lim in (shared_trips._create_limit, shared_trips._access_limit):
        lim._hits.clear()
        lim._all.clear()


def _login(client, tag):
    tag = f"{tag}{uuid.uuid4().hex[:6]}"
    r = client.post("/users/signup", json={"email": f"oi-{tag}@qa-local.dev", "password": "Oi-test-pass-1!", "nickname": f"oi{tag}"[:20]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _key():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _count(table, where="1=1", **params):
    with engine.connect() as c:
        return c.execute(text(f"SELECT COUNT(*) FROM {table} WHERE {where}"), params).scalar()


TRIP = {"title": "도쿄", "destination_city": "도쿄", "start_date": "2026-12-07", "end_date": "2026-12-09"}
SCHED = {"startDate": "2026-12-07", "endDate": "2026-12-09",
         "days": [{"date": "2026-12-07", "activities": [{"name": "센소지"}]}]}
PLACE = {"day_number": 1, "place_order": 1, "place_name": "센소지", "latitude": 35.71, "longitude": 139.79}
SHARED = {"city": "도쿄", "days": [{"date": "2026-11-16", "activities": [{"name": "도쿄타워"}]}]}


# ── 1. 소유권: 남의 자원은 없는 것과 같다(404) ─────────────────────────
def test_other_user_cannot_touch_trip(client):
    me, other = _login(client, "t1"), _login(client, "t2")
    t = client.post("/trips", json=TRIP, headers=me).json()
    url = f"/trips/{t['id']}"
    assert client.get(url, headers=other).status_code == 404
    assert client.patch(url, json={"title": "남이 고침"}, headers=other).status_code == 404
    assert client.delete(url, headers=other).status_code == 404
    assert all(x["id"] != t["id"] for x in client.get("/trips", headers=other).json())
    assert client.get(url, headers=me).json()["title"] == "도쿄"


def test_other_user_cannot_touch_schedule_or_link_my_trip(client):
    me, other = _login(client, "s1"), _login(client, "s2")
    t = client.post("/trips", json=TRIP, headers=me).json()
    s = client.post("/schedules", json={"title": "내 일정", "trip_id": t["id"], "schedule_data": SCHED}, headers=me).json()
    url = f"/schedules/{s['id']}"
    assert client.get(url, headers=other).status_code == 404
    assert client.patch(url, json={"title": "x"}, headers=other).status_code == 404
    assert client.delete(url, headers=other).status_code == 404
    assert client.post(f"{url}/save", headers=other).status_code == 404
    assert client.delete(f"{url}/save", headers=other).status_code == 404
    # 남의 여행 id 에 일정을 이을 수 없다
    r = client.post("/schedules", json={"title": "끼어들기", "trip_id": t["id"]}, headers=other)
    assert r.status_code == 404


def test_other_user_cannot_touch_trip_places(client):
    me, other = _login(client, "p1"), _login(client, "p2")
    t = client.post("/trips", json=TRIP, headers=me).json()
    p = client.post("/api/trip-places", json={**PLACE, "trip_id": t["id"]}, headers=me).json()
    url = f"/api/trip-places/{p['id']}"
    missing = client.patch("/api/trip-places/999999", json={"place_name": "x"}, headers=other)
    r = client.patch(url, json={"place_name": "남이 고침"}, headers=other)
    assert r.status_code == 404 and r.json() == missing.json()   # 있는지 없는지 문구로도 모름
    assert client.delete(url, headers=other).status_code == 404
    assert client.get(f"/api/trip-places?trip_id={t['id']}", headers=other).status_code == 404
    assert client.post("/api/trip-places", json={**PLACE, "trip_id": t["id"], "place_order": 2}, headers=other).status_code == 404
    assert client.post("/api/trip-places/bulk", json=[{**PLACE, "trip_id": t["id"]}], headers=other).status_code == 404
    rows = client.get(f"/api/trip-places?trip_id={t['id']}", headers=me).json()
    assert [x["place_name"] for x in rows] == ["센소지"]


# ── 보기 전용 공유 링크 ─────────────────────────────────────────────
def test_view_only_share_token_cannot_put_or_delete(client):
    created = client.post("/api/shared-trips", json={"data": SHARED}).json()
    edit, view = created["token"], created["view_token"]
    assert view and view != edit
    assert client.get(f"/api/shared-trips/{edit}").json()["view_token"] == view

    r = client.get(f"/api/shared-trips/{view}")
    assert r.status_code == 200
    body = r.json()
    assert body["read_only"] is True and body["token"] == view and body["view_token"] is None
    assert edit not in r.text   # 보기 전용 링크로는 편집 토큰을 알 수 없다

    assert client.put(f"/api/shared-trips/{view}", json={"data": {**SHARED, "city": "x"}, "version": 1}).status_code == 403
    assert client.delete(f"/api/shared-trips/{view}", headers={"X-Manage-Key": created["manage_key"]}).status_code == 403
    assert client.get(f"/api/shared-trips/{edit}").json()["data"]["city"] == "도쿄"
    # 편집 링크는 여전히 고칠 수 있다
    assert client.put(f"/api/shared-trips/{edit}", json={"data": SHARED, "version": 1}).status_code == 200


# ── 2. Idempotency-Key ───────────────────────────────────────────
def test_same_key_twice_creates_one_trip(client):
    me = _login(client, "i1")
    k = _key()
    a = client.post("/trips", json=TRIP, headers={**me, **k})
    b = client.post("/trips", json=TRIP, headers={**me, **k})
    assert a.status_code == b.status_code == 201
    assert a.json() == b.json()
    assert b.headers.get("Idempotent-Replayed") == "true"
    assert _count("trips", "user_id = :u", u=a.json()["user_id"]) == 1


def test_same_key_different_body_is_409(client):
    me = _login(client, "i2")
    k = _key()
    assert client.post("/trips", json=TRIP, headers={**me, **k}).status_code == 201
    r = client.post("/trips", json={**TRIP, "title": "다른 여행"}, headers={**me, **k})
    assert r.status_code == 409


def test_no_key_creates_two_rows(client):
    me = _login(client, "i3")
    a = client.post("/trips", json=TRIP, headers=me).json()
    b = client.post("/trips", json=TRIP, headers=me).json()
    assert a["id"] != b["id"]
    s1 = client.post("/schedules", json={"title": "x", "schedule_data": SCHED}, headers=me).json()
    s2 = client.post("/schedules", json={"title": "x", "schedule_data": SCHED}, headers=me).json()
    assert s1["id"] != s2["id"]
    assert _count("schedules", "user_id = :u", u=a["user_id"]) == 2


def test_same_key_is_per_user(client):
    me, other = _login(client, "i4"), _login(client, "i5")
    k = _key()
    a = client.post("/trips", json=TRIP, headers={**me, **k}).json()
    b = client.post("/trips", json=TRIP, headers={**other, **k}).json()
    assert a["id"] != b["id"] and b["user_id"] != a["user_id"]


def test_schedule_create_and_save_are_idempotent(client):
    me = _login(client, "i6")
    k = _key()
    body = {"title": "도쿄", "schedule_data": SCHED}
    a = client.post("/schedules", json=body, headers={**me, **k})
    b = client.post("/schedules", json=body, headers={**me, **k})
    assert a.status_code == b.status_code == 201 and a.json() == b.json()
    assert _count("schedules", "user_id = :u", u=a.json()["user_id"]) == 1
    assert client.post("/schedules", json={**body, "title": "다름"}, headers={**me, **k}).status_code == 409

    sid = a.json()["id"]
    k2 = _key()
    s1 = client.post(f"/schedules/{sid}/save", headers={**me, **k2})
    s2 = client.post(f"/schedules/{sid}/save", headers={**me, **k2})
    assert s1.status_code == s2.status_code == 200 and s1.json() == s2.json()
    assert s1.json()["is_saved"] is True
    # 같은 키를 다른 일정 저장에 쓰면 409
    other_sid = client.post("/schedules", json=body, headers=me).json()["id"]
    assert client.post(f"/schedules/{other_sid}/save", headers={**me, **k2}).status_code == 409


def test_bulk_trip_places_is_idempotent(client):
    me = _login(client, "i7")
    t = client.post("/trips", json=TRIP, headers=me).json()
    items = [{**PLACE, "trip_id": t["id"]}, {**PLACE, "trip_id": t["id"], "place_order": 2, "place_name": "도쿄타워"}]
    k = _key()
    a = client.post("/api/trip-places/bulk", json=items, headers={**me, **k})
    b = client.post("/api/trip-places/bulk", json=items, headers={**me, **k})
    assert a.status_code == b.status_code == 201 and a.json() == b.json()
    assert _count("trip_places", "trip_id = :t", t=t["id"]) == 2
    assert client.post("/api/trip-places/bulk", json=items[:1], headers={**me, **k}).status_code == 409


def test_shared_trip_create_is_idempotent(client):
    k = _key()
    before = _count("shared_trips")
    a = client.post("/api/shared-trips", json={"data": SHARED}, headers=k)
    b = client.post("/api/shared-trips", json={"data": SHARED}, headers=k)
    assert a.status_code == b.status_code == 201
    assert a.json() == b.json()          # 같은 토큰·관리 키
    assert _count("shared_trips") == before + 1
    assert client.post("/api/shared-trips", json={"data": {**SHARED, "city": "오사카"}}, headers=k).status_code == 409
    c = client.post("/api/shared-trips", json={"data": SHARED})
    assert c.json()["token"] != a.json()["token"]


def test_failed_request_does_not_burn_the_key(client):
    me = _login(client, "i8")
    k = _key()
    assert client.post("/schedules/999999/save", headers={**me, **k}).status_code == 404
    sid = client.post("/schedules", json={"title": "x"}, headers=me).json()["id"]
    # 실패한 요청은 키를 남기지 않으므로 같은 키로 다시 시도할 수 있다
    assert client.post(f"/schedules/{sid}/save", headers={**me, **k}).status_code == 200
    k2 = _key()
    assert client.post("/schedules/999999/save", headers={**me, **k2}).status_code == 404
    assert _count("idempotency_keys", "key = :k", k=k2["Idempotency-Key"]) == 0


def test_expired_key_creates_again(client):
    me = _login(client, "i9")
    k = _key()
    a = client.post("/trips", json=TRIP, headers={**me, **k}).json()
    with engine.begin() as c:
        c.execute(text("UPDATE idempotency_keys SET created_at = :t WHERE key = :k"),
                  {"t": datetime.utcnow() - timedelta(hours=25), "k": k["Idempotency-Key"]})
    b = client.post("/trips", json=TRIP, headers={**me, **k}).json()
    assert a["id"] != b["id"]


@pytest.mark.parametrize("bad", ["", "x" * 129, "한글키"])
def test_bad_key_is_rejected(client, bad):
    me = _login(client, "ib")
    r = client.post("/trips", json=TRIP, headers={**me, "Idempotency-Key": bad.encode("utf-8")})
    assert r.status_code == 400


def test_key_of_128_chars_is_accepted(client):
    me = _login(client, "ic")
    r = client.post("/trips", json=TRIP, headers={**me, "Idempotency-Key": "k" * 128})
    assert r.status_code == 201


def test_cors_allows_idempotency_header(client):
    r = client.options("/trips", headers={"Origin": "capacitor://localhost", "Access-Control-Request-Method": "POST",
                                          "Access-Control-Request-Headers": "Idempotency-Key"})
    assert r.status_code == 200
    assert "idempotency-key" in r.headers.get("access-control-allow-headers", "").lower()


# ── 3. 일정 날짜는 여행 기간 안 ───────────────────────────────────────
def test_schedule_days_must_be_inside_trip_dates(client):
    me = _login(client, "d1")
    bad = {**SCHED, "days": [{"date": "2026-12-10", "activities": []}]}
    assert client.post("/schedules", json={"schedule_data": bad}, headers=me).status_code == 422
    t = client.post("/trips", json=TRIP, headers=me).json()
    outside = {"days": [{"date": "2026-12-20", "activities": []}]}
    assert client.post("/schedules", json={"trip_id": t["id"], "schedule_data": outside}, headers=me).status_code == 422
    s = client.post("/schedules", json={"trip_id": t["id"], "schedule_data": SCHED}, headers=me).json()
    assert client.patch(f"/schedules/{s['id']}", json={"schedule_data": outside}, headers=me).status_code == 422
    # 날짜가 없는 예전 형식은 그대로 저장된다
    assert client.post("/schedules", json={"trip_id": t["id"], "schedule_data": {"days": [{"activities": []}]}}, headers=me).status_code == 201


def test_trip_dates_must_be_in_order(client):
    h = _login(client, "dt")
    bad = {**TRIP, "start_date": "2026-12-10", "end_date": "2026-12-07"}
    assert client.post("/trips", json=bad, headers=h).status_code == 422
    tid = client.post("/trips", json=TRIP, headers=h).json()["id"]
    r = client.patch(f"/trips/{tid}", json={"start_date": "2026-12-20"}, headers=h)
    assert r.status_code == 422
    assert "출발일" in r.text
    assert client.get(f"/trips/{tid}", headers=h).json()["start_date"] == "2026-12-07"


def test_place_order_clash_is_409_not_500(client):
    h = _login(client, "po")
    tid = client.post("/trips", json=TRIP, headers=h).json()["id"]
    rows = client.post("/api/trip-places/bulk", json=[{**PLACE, "trip_id": tid}, {**PLACE, "trip_id": tid, "place_order": 2, "place_name": "우에노"}], headers=h).json()
    r = client.patch(f"/api/trip-places/{rows[1]['id']}", json={"place_order": 1}, headers=h)
    assert r.status_code == 409
    assert client.patch(f"/api/trip-places/{rows[1]['id']}", json={"place_order": 0}, headers=h).status_code == 422
    assert client.patch(f"/api/trip-places/{rows[1]['id']}", json={"place_order": 3}, headers=h).status_code == 200


def test_trip_data_rejects_bad_times_and_day_order():
    import pytest
    from app.schemas.trip_data_validation import validate_trip_data
    base = {"startDate": "2026-12-01", "endDate": "2026-12-03"}
    bad = [
        {**base, "days": [{"date": "2026-12-01", "activities": [{"name": "a", "time": "25:99"}]}]},
        {**base, "days": [{"date": "2026-12-01"}, {"date": "2026-12-01"}]},
        {**base, "days": [{"date": "2026-12-02"}, {"date": "2026-12-01"}]},
        {**base, "days": [{"date": None}] * 4},
    ]
    for d in bad:
        with pytest.raises(ValueError):
            validate_trip_data(d)
    validate_trip_data({**base, "days": [{"date": "2026-12-01", "activities": [{"name": "a", "time": "9:05"}, {"name": "b", "time": ""}]},
                                          {"date": "2026-12-02"}]})


def test_resave_after_delete_creates_a_new_row_not_a_ghost(client):
    """저장 → 삭제 → 같은 내용 다시 저장(같은 키): 지워진 일정의 옛 응답을 돌려주면 안 된다."""
    me = _login(client, "i9")
    k = _key()
    body = {"title": "도쿄", "schedule_data": SCHED}
    a = client.post("/schedules", json=body, headers={**me, **k}).json()
    assert client.delete(f"/schedules/{a['id']}", headers=me).status_code == 204
    b = client.post("/schedules", json=body, headers={**me, **k})
    # 새로 만들었다(옛 응답 재생 아님) — 시험용 SQLite 는 지운 번호를 다시 쓸 수 있어 번호 대신 재생 표시와 실제 존재를 본다
    assert b.status_code == 201 and "Idempotent-Replayed" not in b.headers
    assert client.get(f"/schedules/{b.json()['id']}", headers=me).status_code == 200
    t = client.post("/trips", json=TRIP, headers={**me, **k}).json()
    assert client.delete(f"/trips/{t['id']}", headers=me).status_code in (200, 204)
    t2 = client.post("/trips", json=TRIP, headers={**me, **k})
    assert t2.status_code == 201 and "Idempotent-Replayed" not in t2.headers
    assert client.get(f"/trips/{t2.json()['id']}", headers=me).status_code == 200
    # 지우지 않았으면 같은 키 재시도는 여전히 처음 응답을 그대로 돌려준다
    again = client.post("/trips", json=TRIP, headers={**me, **k})
    assert again.headers.get("Idempotent-Replayed") == "true" and again.json()["id"] == t2.json()["id"]


def test_legacy_share_link_without_view_token_keeps_working(client):
    """보기 전용 링크가 생기기 전 만든 함께 편집 링크: 그대로 편집되고, 시작 시 보기 전용 토큰이 채워진다."""
    from app.db.migrate_shared_trip_view_token import ensure_shared_trip_view_token
    r = client.post("/api/shared-trips", json={"data": SHARED})
    assert r.status_code in (200, 201), r.text
    tok = r.json()["token"]
    with engine.begin() as c:
        c.execute(text("UPDATE shared_trips SET view_token = NULL WHERE token = :t"), {"t": tok})
    ensure_shared_trip_view_token()
    got = client.get(f"/api/shared-trips/{tok}").json()
    assert got.get("read_only") in (False, None) and got["view_token"]
    v = client.get(f"/api/shared-trips/{got['view_token']}").json()
    assert v["read_only"] is True and v["data"] == got["data"]
    assert client.put(f"/api/shared-trips/{got['view_token']}", json={"data": SHARED, "version": v["version"]}).status_code == 403
    assert client.put(f"/api/shared-trips/{tok}", json={"data": SHARED, "version": got["version"]}).status_code == 200
