from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator

from app.schemas.trip_data_validation import validate_trip_data


class ScheduleBase(BaseModel):
    title: Optional[str] = None
    trip_id: Optional[int] = None
    schedule_data: dict[str, Any] = Field(default_factory=dict)
    is_saved: bool = False

    @field_validator("schedule_data")
    @classmethod
    def _check_data(cls, v):
        validate_trip_data(v)
        return v


class ScheduleCreate(ScheduleBase): ...


class ScheduleUpdate(BaseModel):
    title: Optional[str] = None
    schedule_data: Optional[dict[str, Any]] = None
    is_saved: Optional[bool] = None

    @field_validator("schedule_data")
    @classmethod
    def _check_data(cls, v):
        if v is not None:
            validate_trip_data(v)
        return v


class SchedulePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    trip_id: Optional[int] = None
    title: Optional[str] = None
    schedule_data: dict[str, Any] = Field(default_factory=dict)
    is_saved: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
