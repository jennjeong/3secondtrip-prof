"""LandmarkImage — AI 랜드마크 이미지 캐시.

Render 무료 서버의 디스크는 잠들 때마다 지워진다.  디스크에 캐시하면 깨어날
때마다 이미지를 다시 만들어 요금이 나가므로 DB에 저장한다.
"""
from sqlalchemy import Column, DateTime, LargeBinary, String, func
from app.db.database import Base


class LandmarkImage(Base):
    __tablename__ = "landmark_images"

    city = Column(String(80), primary_key=True)
    content = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
