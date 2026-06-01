"""Booking — 예약 요약(실제 결제 X, 사용자가 선택/저장한 옵션 집합)."""
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, Text, func
from app.db.database import Base


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True, index=True)

    booking_data_json = Column(Text, nullable=False, default="{}")
    total_price = Column(Float, nullable=True)
    currency = Column(String(8), nullable=True, default="KRW")

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
