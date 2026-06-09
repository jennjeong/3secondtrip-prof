"""SerpApi proxy — Google Flights engine for *real* round-trip fares.

Mirrors serpapi_service.py (hotels): API key stays server-side, returns a
normalized shape. Prices are requested per 1 adult so the frontend can
multiply by the party size consistently.

SerpApi docs: https://serpapi.com/google-flights-api
"""
from typing import Optional
import logging

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger("serpapi.flights")

SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
_TIMEOUT = httpx.Timeout(25.0, connect=8.0)


def _require_key() -> str:
    key = settings.serpapi_api_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SERPAPI_API_KEY is not configured on the server.",
        )
    return key


async def search_flights(*, departure_id: str, arrival_id: str, outbound_date: str,
                         return_date: Optional[str] = None, adults: int = 1,
                         currency: str = "KRW", country: Optional[str] = "kr",
                         language: Optional[str] = "ko", travel_class: int = 1) -> dict:
    """Call SerpApi engine=google_flights and return normalized fares.

    Returns:
        {
          "currency": "KRW",
          "round_trip": bool,
          "lowest_price": int | None,      # 1인 기준 (왕복이면 왕복 총액)
          "count": int,
          "cheapest": { price, airline, flight_number, stops, duration_min } | None,
        }
    departure_id / arrival_id: IATA airport codes (e.g., ICN, KIX).
    outbound_date / return_date: YYYY-MM-DD (return_date 있으면 왕복).
    """
    key = _require_key()
    params = {
        "engine": "google_flights",
        "departure_id": (departure_id or "").upper().strip(),
        "arrival_id": (arrival_id or "").upper().strip(),
        "outbound_date": outbound_date,
        "currency": (currency or "KRW").upper(),
        "gl": (country or "kr").lower(),
        "hl": (language or "ko").lower(),
        "adults": max(1, int(adults or 1)),
        "travel_class": int(travel_class or 1),
        "api_key": key,
    }
    if return_date:
        params["return_date"] = return_date
        params["type"] = "1"   # round trip
    else:
        params["type"] = "2"   # one way

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(SERPAPI_ENDPOINT, params=params)
    except httpx.HTTPError as e:
        logger.exception("SerpApi flights network error")
        raise HTTPException(status_code=502, detail="SerpApi network error") from e

    if r.status_code >= 400:
        try:
            body = r.json(); msg = body.get("error") or "SerpApi error"
        except Exception:
            msg = r.text[:200] or "SerpApi error"
        logger.warning("SerpApi flights %s: %s", r.status_code, msg)
        if r.status_code in (400, 401, 403, 429):
            raise HTTPException(status_code=r.status_code, detail=str(msg))
        raise HTTPException(status_code=502, detail=str(msg))

    data = r.json()
    if data.get("error"):
        logger.warning("SerpApi flights logical error: %s", data.get("error"))
        raise HTTPException(status_code=404, detail=str(data.get("error")))

    best = data.get("best_flights") or []
    other = data.get("other_flights") or []
    allf = [f for f in (best + other) if isinstance(f.get("price"), (int, float))]
    insights = data.get("price_insights") or {}

    lowest = insights.get("lowest_price")
    if lowest is None and allf:
        lowest = min(f["price"] for f in allf)

    cheapest = None
    if allf:
        cand = min(allf, key=lambda f: f["price"])
        legs = cand.get("flights") or []
        first = legs[0] if legs else {}
        cheapest = {
            "price": int(round(float(cand.get("price")))) if cand.get("price") is not None else None,
            "airline": first.get("airline"),
            "flight_number": first.get("flight_number"),
            "stops": max(0, len(legs) - 1),
            "duration_min": cand.get("total_duration"),
        }

    return {
        "currency": params["currency"],
        "round_trip": bool(return_date),
        "lowest_price": int(round(float(lowest))) if lowest is not None else None,
        "count": len(allf),
        "cheapest": cheapest,
    }
