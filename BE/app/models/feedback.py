"""Feedback — 사용자 피드백(로그인 / 비로그인 모두 가능)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, func
from app.db.database import Base


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    feedback_type = Column(String(20), nullable=False, default="etc")  # bug | feature | design | schedule | etc
    title = Column(String(255), nullable=True)
    content = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, default="new")          # new | in_progress | resolved | closed

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
