"""랜드마크 이미지 API — DB 캐시와 생성 제한."""

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.landmark_image import LandmarkImage
from app.routers import images

PNG = b"\x89PNG-fake"


def _clear(city):
    with SessionLocal() as db:
        db.query(LandmarkImage).filter(LandmarkImage.city == city).delete()
        db.commit()


def test_unknown_city_is_rejected_without_generating(client, monkeypatch):
    async def boom(city):
        raise AssertionError("must not generate")
    monkeypatch.setattr(images, "_generate", boom)
    monkeypatch.setattr(settings, "openai_api_key", "test")
    assert client.get("/api/images/landmark/임의의도시").status_code == 404


def test_known_city_without_key_returns_503(client, monkeypatch):
    _clear("도쿄")
    monkeypatch.setattr(settings, "openai_api_key", "")
    assert client.get("/api/images/landmark/도쿄").status_code == 503


def test_image_is_generated_once_then_served_from_db(client, monkeypatch):
    _clear("파리")
    calls = []

    async def fake(city):
        calls.append(city)
        return PNG
    monkeypatch.setattr(images, "_generate", fake)
    monkeypatch.setattr(settings, "openai_api_key", "test")

    for _ in range(2):
        r = client.get("/api/images/landmark/파리")
        assert r.status_code == 200
        assert r.content == PNG
        assert r.headers["content-type"] == "image/png"
    assert calls == ["파리"]


def test_cached_image_is_served_without_key(client, monkeypatch):
    _clear("서울")
    with SessionLocal() as db:
        db.add(LandmarkImage(city="서울", content=PNG))
        db.commit()
    monkeypatch.setattr(settings, "openai_api_key", "")
    assert client.get("/api/images/landmark/서울").content == PNG


def test_generation_error_does_not_leak_details(client, monkeypatch):
    _clear("제주")

    async def boom(city):
        raise RuntimeError("secret-provider-detail")
    monkeypatch.setattr(images, "_generate", boom)
    monkeypatch.setattr(settings, "openai_api_key", "test")
    r = client.get("/api/images/landmark/제주")
    assert r.status_code == 503
    assert "secret-provider-detail" not in r.text
