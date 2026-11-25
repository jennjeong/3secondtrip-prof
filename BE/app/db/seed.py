"""Popular roadmap seed — runs on startup, only if the table is empty."""
from app.db.database import SessionLocal
from app.models.roadmap import Roadmap

POPULAR = [
    dict(title="도쿄 동네 산책 3일",     city="도쿄",   country="일본",     concept="균형",     days=3, likes=1240, gradient="linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)"),
    dict(title="파리 동네 시장과 골목 4일",     city="파리",   country="프랑스",   concept="프리미엄", days=4, likes=980,  gradient="linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)"),
    dict(title="제주 마을길과 오름 3일",     city="제주",   country="대한민국", concept="힐링",     days=3, likes=870,  gradient="linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)"),
    dict(title="오사카 동네 먹부림 3일",      city="오사카", country="일본",     concept="가성비",   days=3, likes=760,  gradient="linear-gradient(135deg, #fcb69f 0%, #ffecd2 100%)"),
    dict(title="방콕 동네 시장과 골목 4일",        city="방콕",   country="태국",     concept="액티비티", days=4, likes=690,  gradient="linear-gradient(135deg, #2af598 0%, #009efd 100%)"),
    dict(title="서울 동네 골목 2일",          city="서울",   country="대한민국", concept="효율",     days=2, likes=640,  gradient="linear-gradient(135deg, #c471f5 0%, #fa71cd 100%)"),
    dict(title="뉴욕 동네 5일",      city="뉴욕",   country="미국",     concept="프리미엄", days=5, likes=590,  gradient="linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)"),
    dict(title="시드니 동네와 해변 4일",       city="시드니", country="호주",     concept="액티비티", days=4, likes=530,  gradient="linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)"),
]


def seed_roadmaps_if_empty() -> None:
    db = SessionLocal()
    try:
        if db.query(Roadmap).count() > 0:
            return
        for r in POPULAR:
            db.add(Roadmap(is_public=True, **r))
        db.commit()
    finally:
        db.close()
