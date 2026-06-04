"""실시간 호텔 요금 프록시 (Amadeus). 키는 백엔드에만 존재."""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import amadeus_service

router = APIRouter(prefix="/api/hotels", tags=["hotels"])


class HotelPriceRequest(BaseModel):
    latitude: float
    longitude: float
    check_in: str = Field(min_length=8, max_length=10)    # YYYY-MM-DD
    check_out: str = Field(min_length=8, max_length=10)
    adults: int = Field(default=2, ge=1, le=20)
    rooms: int = Field(default=1, ge=1, le=10)
    currency: str = Field(default="KRW", min_length=3, max_length=3)
    name: Optional[str] = Field(default=None, max_length=200)


class HotelPriceResponse(BaseModel):
    available: bool
    nightly: Optional[int] = None
    currency: Optional[str] = None
    hotel: Optional[str] = None
    matched: bool = False
    source: str = "amadeus"


@router.post("/price", response_model=HotelPriceResponse)
async def hotel_price(req: HotelPriceRequest):
    """좌표·날짜·인원으로 실제 1박 요금을 조회. 미설정/무결과면 available=false."""
    if not amadeus_service.is_configured():
        return HotelPriceResponse(available=False, source="unconfigured")
    res = await amadeus_service.nightly_price(
        lat=req.latitude, lng=req.longitude,
        check_in=req.check_in, check_out=req.check_out,
        adults=req.adults, rooms=req.rooms, currency=req.currency, name=req.name,
    )
    if not res:
        return HotelPriceResponse(available=False)
    return HotelPriceResponse(
        available=True, nightly=res["nightly"], currency=res["currency"],
        hotel=res["hotel"], matched=res.get("matched", False),
    )
