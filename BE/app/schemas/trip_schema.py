from datetime import date, datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict


class TripBase(BaseModel):
    title: Optional[str] = None
    departure_city: Optional[str] = None
    destination_country: Optional[str] = None
    destination_city: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    companion_type: Optional[str] = None
    concept: Optional[str] = None
    styles: list[str] = Field(default_factory=list)
    budget: Optional[float] = None
    currency: Optional[str] = "KRW"
    trip_data: Optional[dict[str, Any]] = None


class TripCreate(TripBase): ...


class TripUpdate(TripBase):
    title: Optional[str] = None


class TripPublic(TripBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
