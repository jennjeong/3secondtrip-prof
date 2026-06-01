"""Roadmap — 인기/추천 로드맵(공개 또는 사용자 생성)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, func
from app.db.database import Base


class Roadmap(Base):
    __tablename__ = "roadmaps"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    title = Column(String(255), nullable=False)
    city = Column(String(120), nullable=True, index=True)
    country = Column(String(120), nullable=True, index=True)
    concept = Column(String(40), nullable=True, index=True)
    days = Column(Integer, nullable=True)
    likes = Column(Integer, nullable=False, default=0, index=True)
    gradient = Column(String(255), nullable=True)
    roadmap_data_json = Column(Text, nullable=True)                    # 상세 코스 데이터
    is_public = Column(Boolean, nullable=False, default=True, index=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
