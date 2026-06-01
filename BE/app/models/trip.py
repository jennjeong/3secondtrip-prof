"""Trip — 사용자가 만든 여행(생성된 일정의 메타정보)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Date, Float, func
from app.db.database import Base


class Trip(Base):
    __tablename__ = "trips"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(255), nullable=True)
    departure_city = Column(String(120), nullable=True)
    destination_country = Column(String(120), nullable=True)
    destination_city = Column(String(120), nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    companion_type = Column(String(20), nullable=True)
    concept = Column(String(40), nullable=True)
    styles_json = Column(Text, nullable=True, default="[]")            # JSON 배열 문자열
    budget = Column(Float, nullable=True)
    currency = Column(String(8), nullable=True, default="KRW")
    trip_data_json = Column(Text, nullable=True)                       # 자유 형식 추가 정보

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
