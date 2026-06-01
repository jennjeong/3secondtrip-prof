"""Review — 일정/여행에 대한 후기(별점 + 본문 + 태그)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, CheckConstraint, func
from app.db.database import Base


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True, index=True)

    rating = Column(Integer, nullable=False)
    content = Column(Text, nullable=True)
    concept_tags_json = Column(Text, nullable=True, default="[]")
    is_public = Column(Boolean, nullable=False, default=True, index=True)
    city = Column(String(120), nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating_1_5"),
    )
