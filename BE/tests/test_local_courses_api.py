"""동네 사람이 쓴 코스 — 확인한 글만 공개되고, 남의 글은 고칠 수 없고, 개인정보는 나가지 않는다."""
import uuid

import pytest

from app.db.database import SessionLocal
from app.models.local_course import LocalCourse
from app.models.user import User
from app.routers import local_courses as mod


@pytest.fixture(autouse=True)
def _no_limits():
    for lim in (mod._write_limit, mod._report_limit):
        lim._hits.clear(); lim._all.clear()


def _auth(client, admin=False):
    s = uuid.uuid4().hex[:8]
    r = client.post("/users/signup", json={"email": f"lc_{s}@example.com", "password": "abc12345", "nickname": f"lc_{s}"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    if admin:
        db = SessionLocal()
        db.query(User).filter(User.id == r.json()["user"]["id"]).update({User.is_admin: True}); db.commit(); db.close()
    return h


def _body(**kw):
    return {"city": "서울", "country": "대한민국", "area": "망원동", "lived": "3~10년", "title": "망원동 느린 하루", "concept": "균형",
            "note": "주말 아침에 시장부터 들르면 한산해요.", "confirm_local": True,
            "days": [[{"time": "10:00", "name": "망원시장", "cat": "시장", "tip": "오전이 덜 붐벼요"}, {"time": "", "name": "한강공원", "cat": "산책"}]], **kw}


def _submit(client, h, **kw):
    r = client.post("/local-courses", json=_body(**kw), headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_only_reviewed_courses_are_public(client):
    h, a = _auth(client), _auth(client, admin=True)
    assert client.post("/local-courses", json=_body()).status_code == 401
    cid = _submit(client, h)
    ids = lambda: [c["id"] for c in client.get("/local-courses").json()]  # noqa: E731
    assert cid not in ids() and client.get(f"/local-courses/{cid}").status_code == 404
    assert client.get("/local-courses/mine", headers=h).json()[0]["status"] == "pending"
    assert client.patch(f"/admin/local-courses/{cid}", json={"status": "approved"}, headers=h).status_code == 403
    assert client.patch(f"/admin/local-courses/{cid}", json={"status": "approved"}, headers=a).status_code == 200
    assert cid in ids()
    pub = client.get(f"/local-courses/{cid}").json()
    assert pub["author"].startswith("lc_")
    assert not {"user_id", "email", "status", "review_note"} & set(pub)
    # 확인받은 뒤 고치면 다시 숨겨진다
    assert client.put(f"/local-courses/{cid}", json=_body(title="내용을 바꾼 글"), headers=h).json()["status"] == "pending"
    assert cid not in ids()


def test_others_cannot_edit_or_delete(client):
    h, other = _auth(client), _auth(client)
    cid = _submit(client, h)
    assert client.put(f"/local-courses/{cid}", json=_body(), headers=other).status_code == 404
    assert client.delete(f"/local-courses/{cid}", headers=other).status_code == 404
    assert client.delete(f"/local-courses/{cid}", headers=h).status_code == 204


def test_rejected_note_is_only_for_author(client):
    h, a = _auth(client), _auth(client, admin=True)
    cid = _submit(client, h)
    client.patch(f"/admin/local-courses/{cid}", json={"status": "rejected", "review_note": "장소를 더 적어 주세요"}, headers=a)
    assert client.get("/local-courses/mine", headers=h).json()[0]["review_note"] == "장소를 더 적어 주세요"
    assert client.get(f"/local-courses/{cid}").status_code == 404


@pytest.mark.parametrize("kw", [
    {"confirm_local": False}, {"lived": "외계"}, {"concept": "x"}, {"title": "짧"}, {"note": "짧아요"}, {"days": []},
    {"days": [[{"name": "한 곳", "cat": "식사"}]]},
    {"days": [[{"name": "가", "cat": "식사", "time": "25:00"}, {"name": "나", "cat": "식사"}]]},
    {"note": "자세한 건 https://spam.example 에서 확인하세요"}, {"note": "예약은 010-1234-5678 로 연락 주세요"},
    {"title": "문의 a@b.com 으로"}, {"status": "approved"}, {"user_id": 1},
])
def test_bad_input_is_rejected(client, kw):
    assert client.post("/local-courses", json=_body(**kw), headers=_auth(client)).status_code == 422


def test_hidden_characters_are_removed(client):
    h = _auth(client)
    client.post("/local-courses", json=_body(title="망원동‮ 하루​ 산책"), headers=h)
    assert client.get("/local-courses/mine", headers=h).json()[0]["title"] == "망원동 하루 산책"


def test_resend_is_not_duplicated_and_pending_is_capped(client):
    h = _auth(client)
    cid = _submit(client, h)
    r = client.post("/local-courses", json=_body(), headers=h)
    assert r.status_code == 200 and r.json()["id"] == cid
    for i in range(mod.MAX_PENDING - 1):
        mod._write_limit._hits.clear()
        _submit(client, h, title=f"다른 코스 {i}번")
    mod._write_limit._hits.clear()
    assert client.post("/local-courses", json=_body(title="너무 많은 글"), headers=h).status_code == 409


def test_report_counts_and_admin_sees_it(client):
    h, a = _auth(client), _auth(client, admin=True)
    cid = _submit(client, h)
    assert client.post(f"/local-courses/{cid}/report", json={"reason": "광고"}).status_code == 404   # 공개 전
    client.patch(f"/admin/local-courses/{cid}", json={"status": "approved"}, headers=a)
    assert client.post(f"/local-courses/{cid}/report", json={"reason": "광고"}).status_code == 202
    assert client.post(f"/local-courses/{cid}/report", json={"reason": "아무 말"}).status_code == 422
    row = next(c for c in client.get("/admin/local-courses", headers=a).json()["items"] if c["id"] == cid)
    assert row["reports"] == 1


def test_account_delete_removes_courses(client):
    h = _auth(client)
    cid = _submit(client, h)
    r = client.post("/users/me/delete", json={"confirm": "계정 삭제", "password": "abc12345"}, headers=h)
    assert r.status_code == 200 and r.json()["deleted"]["local_courses"] == 1
    db = SessionLocal()
    assert db.get(LocalCourse, cid) is None
    db.close()


def test_city_filter(client):
    h, a = _auth(client), _auth(client, admin=True)
    cid = _submit(client, h, city="강릉", title="강릉 바다 옆 하루")
    client.patch(f"/admin/local-courses/{cid}", json={"status": "approved"}, headers=a)
    assert [c["city"] for c in client.get("/local-courses?city=강릉").json()] == ["강릉"]
