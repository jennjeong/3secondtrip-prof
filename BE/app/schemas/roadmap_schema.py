from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict


class RoadmapBase(BaseModel):
    title: str
    city: Optional[str] = None
    country: Optional[str] = None
    concept: Optional[str] = None
    days: Optional[int] = None
    likes: int = 0
    gradient: Optional[str] = None
    roadmap_data: Optional[dict[str, Any]] = None
    is_public: bool = True


class RoadmapCreate(RoadmapBase): ...
class RoadmapUpdate(RoadmapBase):
    title: Optional[str] = None


class RoadmapPublic(RoadmapBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RoadmapFilter(BaseModel):
    sort: Optional[str] = "popular"      # popular | latest | likes
    concept: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    limit: int = Field(default=20, ge=1, le=100)
