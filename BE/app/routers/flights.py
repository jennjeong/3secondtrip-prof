"""SerpApi Google Flights proxy — real round-trip fares.

Public read (no auth), mirroring hotels.py. The SerpApi key stays server-side.
"""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.serpapi_flights_service import search_flights

router = APIRouter(prefix="/api", tags=["flights"])


class FlightSearchRequest(BaseModel):
    departure_id: str = Field(..., description="출발 공항 IATA (예: ICN)")
    arrival_id: str = Field(..., description="도착 공항 IATA (예: KIX)")
    outbound_date: str = Field(..., description="YYYY-MM-DD")
    return_date: Optional[str] = Field(None, description="YYYY-MM-DD (왕복이면)")
    adults: int = 1
    currency: str = "KRW"
    country: Optional[str] = "kr"
    language: Optional[str] = "ko"
    travel_class: int = 1   # 1 economy · 2 premium · 3 business · 4 first


@router.post("/flights/search")
async def flights_search(payload: FlightSearchRequest):
    return await search_flights(
        departure_id=payload.departure_id,
        arrival_id=payload.arrival_id,
        outbound_date=payload.outbound_date,
        return_date=payload.return_date,
        adults=payload.adults,
        currency=payload.currency,
        country=payload.country,
        language=payload.language,
        travel_class=payload.travel_class,
    )
