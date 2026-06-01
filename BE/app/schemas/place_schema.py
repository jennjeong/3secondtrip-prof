"""Place schemas — Places API search results + TripPlace CRUD."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class PlaceSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    language: Optional[str] = "ko"
    region: Optional[str] = None             # "KR", "JP", etc.
    max_results: int = Field(default=8, ge=1, le=20)
    # Optional bias center (helps disambiguate "Park" etc.)
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None


class PlaceResult(BaseModel):
    place_id: str
    name: str
    address: Optional[str] = None
    latitude: float
    longitude: float
    rating: Optional[float] = None
    user_rating_count: Optional[int] = None
    types: list[str] = Field(default_factory=list)


class PlaceSearchResponse(BaseModel):
    places: list[PlaceResult]


# ── TripPlace CRUD ────────────────────────────────────────────────
class TripPlaceCreate(BaseModel):
    trip_id: int
    day_number: int = Field(ge=1)
    place_order: int = Field(ge=1)
    place_name: str = Field(min_length=1, max_length=255)
    address: Optional[str] = None
    latitude: float
    longitude: float
    google_place_id: Optional[str] = None
    stay_minutes: Optional[int] = 60


class TripPlaceUpdate(BaseModel):
    day_number: Optional[int] = None
    place_order: Optional[int] = None
    place_name: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    google_place_id: Optional[str] = None
    stay_minutes: Optional[int] = None


class TripPlacePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    day_number: int
    place_order: int
    place_name: str
    address: Optional[str] = None
    latitude: float
    longitude: float
    google_place_id: Optional[str] = None
    stay_minutes: Optional[int] = None
    created_at: Optional[datetime] = None
