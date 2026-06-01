from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict


class BookingCreate(BaseModel):
    trip_id: Optional[int] = None
    schedule_id: Optional[int] = None
    booking_data: dict[str, Any] = Field(default_factory=dict)
    total_price: Optional[float] = None
    currency: Optional[str] = "KRW"


class BookingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    trip_id: Optional[int] = None
    schedule_id: Optional[int] = None
    booking_data: dict[str, Any] = Field(default_factory=dict)
    total_price: Optional[float] = None
    currency: Optional[str] = None
    created_at: Optional[datetime] = None
