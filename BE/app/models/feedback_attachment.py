"""FeedbackAttachment — 피드백에 붙인 스크린샷 1장.

비로그인도 보낼 수 있으므로 크기(700KB)·형식(JPEG/PNG/WebP)을 제한하고,
관리자만 내려받을 수 있다.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String, func

from app.db.database import Base


class FeedbackAttachment(Base):
    __tablename__ = "feedback_attachments"

    id = Column(Integer, primary_key=True, index=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id", ondelete="CASCADE"), nullable=False, index=True)
    mime = Column(String(32), nullable=False)
    size = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
