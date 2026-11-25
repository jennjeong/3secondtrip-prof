"""SerpApi proxy — Google Flights engine for *real* round-trip fares.

Mirrors serpapi_service.py (hotels): API key stays server-side, returns a
normalized shape. Prices are requested per 1 adult so the frontend can
multiply by the party size consistently.

SerpApi docs: https://serpapi.com/google-flights-api
"""
from typing import Optional
import logging

import httpx

from app.core.config import settings
from app.services.provider_errors import Timer, from_httpx, from_status, provider_error

logger = logging.getLogger("serpapi.flights")
PROVIDER = "google_flights"

SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
_TIMEOUT = httpx.Timeout(25.0, connect=8.0)


def _require_key() -> str:
    key = settings.serpapi_api_key
    if not key:
        raise provider_error(PROVIDER, "unconfigured")
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
          "cheapest": { price, airline, flight_number, stops, duration_min,
                        departure_time, arrival_time } | None,   # 가는 편, 각 공항 현지 시각 "YYYY-MM-DD HH:MM"
          "meta": { provider, status, latency_ms, checked_at },
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

    timer = Timer()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(SERPAPI_ENDPOINT, params=params)
    except httpx.HTTPError as e:
        logger.warning("SerpApi flights network error: %s", type(e).__name__)
        raise from_httpx(PROVIDER, e) from e

    if r.status_code >= 400:
        try:
            body = r.json(); msg = body.get("error") or "SerpApi error"
        except Exception:
            msg = r.text[:200] or "SerpApi error"
        logger.warning("SerpApi flights %s: %s", r.status_code, msg)
        raise from_status(PROVIDER, r.status_code)

    data = r.json()
    if data.get("error"):
        logger.warning("SerpApi flights logical error: %s", data.get("error"))
        raise provider_error(PROVIDER, "no_result")

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
        last = legs[-1] if legs else {}
        cheapest = {
            "price": int(round(float(cand.get("price")))) if cand.get("price") is not None else None,
            "airline": first.get("airline"),
            "flight_number": first.get("flight_number"),
            "stops": max(0, len(legs) - 1),
            "duration_min": cand.get("total_duration"),
            "departure_time": (first.get("departure_airport") or {}).get("time"),
            "arrival_time": (last.get("arrival_airport") or {}).get("time"),
        }

    return {
        "currency": params["currency"],
        "round_trip": bool(return_date),
        "lowest_price": int(round(float(lowest))) if lowest is not None else None,
        "count": len(allf),
        "cheapest": cheapest,
        "meta": timer.meta(PROVIDER, len(allf)),
    }
