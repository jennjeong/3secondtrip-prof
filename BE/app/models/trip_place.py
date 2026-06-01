"""TripPlace — 일정의 각 장소(여행일 + 순서 + 위경도 + place_id) DB 저장 모델."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, UniqueConstraint, func
from app.db.database import Base


class TripPlace(Base):
    __tablename__ = "trip_places"

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)

    day_number = Column(Integer, nullable=False, index=True)
    place_order = Column(Integer, nullable=False)

    place_name = Column(String(255), nullable=False)
    address = Column(String(500), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    google_place_id = Column(String(120), nullable=True, index=True)
    stay_minutes = Column(Integer, nullable=True, default=60)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("trip_id", "day_number", "place_order", name="uq_trip_place_order"),
    )
