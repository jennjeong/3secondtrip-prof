"""SerpApi Google Hotels proxy — real nightly prices.

Public read (no auth), mirroring the Places search proxy in places.py.
The SerpApi key stays server-side in services/serpapi_service.py.
"""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.serpapi_service import search_hotels

router = APIRouter(prefix="/api", tags=["hotels"])


class HotelSearchRequest(BaseModel):
    query: str = Field(..., description="City / location text, e.g. '도쿄'")
    check_in_date: str = Field(..., description="YYYY-MM-DD (future)")
    check_out_date: str = Field(..., description="YYYY-MM-DD (after check_in)")
    adults: int = 2
    currency: str = "KRW"
    country: Optional[str] = "kr"
    language: Optional[str] = "ko"
    hotel_class: Optional[str] = None   # e.g. "4" or "4,5" to filter by stars
    max_results: int = 20


@router.post("/hotels/search")
async def hotels_search(payload: HotelSearchRequest):
    return await search_hotels(
        query=payload.query,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults,
        currency=payload.currency,
        country=payload.country,
        language=payload.language,
        hotel_class=payload.hotel_class,
        max_results=payload.max_results,
    )
