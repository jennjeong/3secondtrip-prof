from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    content: Optional[str] = None
    concept_tags: list[str] = Field(default_factory=list)
    is_public: bool = True
    trip_id: Optional[int] = None
    schedule_id: Optional[int] = None
    city: Optional[str] = None


class ReviewPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    trip_id: Optional[int] = None
    schedule_id: Optional[int] = None
    rating: int
    content: Optional[str] = None
    concept_tags: list[str] = Field(default_factory=list)
    is_public: bool = True
    city: Optional[str] = None
    created_at: Optional[datetime] = None
