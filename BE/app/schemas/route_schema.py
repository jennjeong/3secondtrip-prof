"""Route schemas — request/response for /api/routes."""
from typing import Optional, Literal
from pydantic import BaseModel, Field

TravelMode = Literal["DRIVE", "WALK", "TRANSIT", "BICYCLE"]


class LatLng(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    waypoints: list[LatLng] = Field(default_factory=list)
    travel_mode: TravelMode = "DRIVE"
    language: Optional[str] = "ko"
    region: Optional[str] = None     # "KR", "JP", etc.


class RouteResponse(BaseModel):
    distance_meters: int
    duration_seconds: int
    encoded_polyline: str
    travel_mode: TravelMode
    summary: Optional[str] = None
