"""Blog — 사용자 작성 여행 후기/일기."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, func
from app.db.database import Base


class Blog(Base):
    __tablename__ = "blogs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(255), nullable=False)
    tags_json = Column(Text, nullable=True, default="[]")
    body = Column(Text, nullable=False)
    visibility = Column(String(16), nullable=False, default="public")  # public | link | private
    is_draft = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
