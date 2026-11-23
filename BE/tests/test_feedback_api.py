"""피드백 — 화면이 보내는 필드, 스크린샷 첨부 제한, 관리자만 첨부 열람."""
import base64

import pytest

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _reset_limiter():
    from app.routers import feedback
    feedback._create_limit._hits.clear(); feedback._create_limit._all.clear()
    yield


def test_create_without_attachment(client):
    r = client.post("/feedback", json={"feedback_type": "bug", "title": "t", "content": "내용"})
    assert r.status_code == 201, r.text
    assert r.json()["has_attachment"] is False


def test_create_with_png(client):
    r = client.post("/feedback", json={"feedback_type": "design", "title": "t", "content": "c",
                                       "attachment_b64": base64.b64encode(PNG).decode(), "attachment_mime": "image/png"})
    assert r.status_code == 201, r.text
    assert r.json()["has_attachment"] is True


def test_rejects_wrong_magic(client):
    r = client.post("/feedback", json={"feedback_type": "bug", "content": "c",
                                       "attachment_b64": base64.b64encode(b"<svg>").decode(), "attachment_mime": "image/png"})
    assert r.status_code == 422


def test_rejects_svg_mime(client):
    r = client.post("/feedback", json={"feedback_type": "bug", "content": "c",
                                       "attachment_b64": base64.b64encode(PNG).decode(), "attachment_mime": "image/svg+xml"})
    assert r.status_code == 422


def test_rejects_too_large(client):
    big = PNG + b"\x00" * (701 * 1024)
    r = client.post("/feedback", json={"feedback_type": "bug", "content": "c",
                                       "attachment_b64": base64.b64encode(big).decode(), "attachment_mime": "image/png"})
    assert r.status_code in (413, 422)


def test_old_payload_shape_rejected(client):
    # 예전 화면이 보내던 모양 — content 가 없어 422 (화면은 이제 content 로 보낸다)
    r = client.post("/feedback", json={"type": "bug", "title": "t", "body": "b"})
    assert r.status_code == 422


def test_attachment_requires_admin(client):
    r = client.get("/feedback/1/attachment")
    assert r.status_code in (401, 403)


def test_rate_limited(client):
    codes = [client.post("/feedback", json={"feedback_type": "etc", "content": "c"}).status_code for _ in range(7)]
    assert 429 in codes
