"""Schedule — 생성된 일정(저장/재생성 가능)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, func
from app.db.database import Base


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)

    title = Column(String(255), nullable=True)
    schedule_data_json = Column(Text, nullable=False, default="{}")    # days, activities 등 전체 페이로드
    is_saved = Column(Boolean, nullable=False, default=False, index=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
