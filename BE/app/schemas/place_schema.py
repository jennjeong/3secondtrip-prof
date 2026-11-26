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
    price_level: Optional[str] = None     # Google Places 가격대 ($~$$$$)
    step_free: Optional[bool] = None   # 휠체어 출입구 — 모르면 None
    opening_periods: Optional[list[dict]] = None   # [{d:0~6(일~토), o:분, c:분}] — 없으면 영업시간 모름


class PlaceSearchResponse(BaseModel):
    places: list[PlaceResult]
    meta: dict | None = None      # provider · status · latency_ms · checked_at


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
    day_number: Optional[int] = Field(default=None, ge=1)
    place_order: Optional[int] = Field(default=None, ge=1)
    place_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    google_place_id: Optional[str] = None
    stay_minutes: Optional[int] = Field(default=None, ge=0, le=1440)


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
