"""OAuth 프로필 매핑 + get_or_create_oauth_user upsert/백필."""
from datetime import date

from app.db.database import SessionLocal
from app.services import oauth_service as o
from app.services.user_service import get_or_create_oauth_user


def test_naver_map_user_parses_response_wrapper():
    sample = {"resultcode": "00", "response": {
        "id": "nv-1", "email": "a@b.com", "name": "홍길동",
        "nickname": "gil", "mobile": "010-1234-5678",
        "birthyear": "1995", "birthday": "03-21", "profile_image": "http://img",
    }}
    m = o.naver_map_user(sample)
    assert m["provider"] == "naver"
    assert m["provider_user_id"] == "nv-1"
    assert m["name"] == "홍길동"
    assert m["phone"] == "010-1234-5678"
    assert m["birth_date"] == date(1995, 3, 21)


def test_google_map_user_minimal():
    m = o.google_map_user({"sub": "g-1", "email": "x@y.com", "name": "Jane Doe", "given_name": "Jane"})
    assert m["provider"] == "google" and m["provider_user_id"] == "g-1"
    assert m["nickname"] == "Jane"


def test_oauth_upsert_creates_then_backfills():
    db = SessionLocal()
    try:
        # 1) 최초 생성 — email만
        u1 = get_or_create_oauth_user(db, provider="kakao", provider_user_id="k-100",
                                      email="kk@example.com", nickname="kkuser")
        assert u1.id is not None
        first_id = u1.id

        # 2) 같은 provider+id 재로그인 — 동일 유저 반환(중복 생성 X)
        u2 = get_or_create_oauth_user(db, provider="kakao", provider_user_id="k-100",
                                      name="새이름", phone="010-9999-8888")
        assert u2.id == first_id

        # 3) 이전에 비어있던 PII가 백필되어 암호화 저장 후 평문으로 복호화돼 읽힘
        assert u2.name == "새이름"
        assert u2.phone == "01099998888"   # normalize_phone가 하이픈 제거
    finally:
        db.close()
