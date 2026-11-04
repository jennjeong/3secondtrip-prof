"""이용 통계 API — 정해진 이벤트만 받고 조회는 관리자만."""
import uuid

from app.db.database import SessionLocal
from app.models.user import User
from app.routers import events


def _signup(client):
    s = uuid.uuid4().hex[:8]
    email = f"e_{s}@example.com"
    r = client.post("/users/signup", json={"email": email, "password": "abc12345", "nickname": f"e_{s}"})
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_known_event_counts_and_unknown_is_rejected(client):
    events._limit._hits.clear()
    events._limit._all.clear()
    assert client.post("/api/events", json={"name": "trip_created"}).status_code == 204
    assert client.post("/api/events", json={"name": "trip_created"}).status_code == 204
    assert client.post("/api/events", json={"name": "anything_else"}).status_code == 422


def test_summary_requires_admin(client):
    assert client.get("/api/events/summary").status_code in (401, 403)
    email, headers = _signup(client)
    assert client.get("/api/events/summary", headers=headers).status_code == 403
    with SessionLocal() as db:
        db.query(User).filter(User.email == email).update({"is_admin": True})
        db.commit()
    assert client.get("/api/events/summary", headers=headers).status_code == 200
