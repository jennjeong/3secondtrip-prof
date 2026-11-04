"""SharedTrip — 링크를 아는 사람끼리 함께 편집하는 일정."""
from sqlalchemy import Column, DateTime, Integer, String, func
from app.db.database import Base
from app.models._crypto_type import EncryptedString


class SharedTrip(Base):
    __tablename__ = "shared_trips"

    token = Column(String(64), primary_key=True)
    data_json = Column(EncryptedString(), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
