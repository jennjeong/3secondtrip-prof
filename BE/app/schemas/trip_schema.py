from datetime import date, datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict, model_validator


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

    @model_validator(mode="after")
    def _dates_in_order(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("출발일이 귀국일보다 늦어요. 날짜를 다시 골라 주세요.")
        return self


class TripCreate(TripBase): ...


class TripUpdate(TripBase):
    title: Optional[str] = None


class TripPublic(TripBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
