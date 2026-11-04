"""EventCount — 날짜·이벤트별 합계만 저장한다.  사용자나 기기는 구분하지 않는다."""
from sqlalchemy import Column, Date, Integer, String
from app.db.database import Base


class EventCount(Base):
    __tablename__ = "event_counts"

    day = Column(Date, primary_key=True)
    name = Column(String(40), primary_key=True)
    count = Column(Integer, nullable=False, default=0)
