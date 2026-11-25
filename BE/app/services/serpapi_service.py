"""SerpApi proxy — Google Hotels engine for *real* nightly hotel prices.

The API key is read from settings.serpapi_api_key (server-side only) and is
NEVER returned to the frontend.  Mirrors the proxy/error-handling shape of
google_maps_service.py so the rest of the app treats it the same way.

SerpApi docs: https://serpapi.com/google-hotels-api
"""
from typing import Optional
import logging
import statistics

import httpx

from app.core.config import settings
from app.services.provider_errors import Timer, from_httpx, from_status, provider_error

logger = logging.getLogger("serpapi")
PROVIDER = "google_hotels"

SERPAPI_ENDPOINT = "https://serpapi.com/search.json"

# Hotels search can be slow (Google Hotels aggregation) — allow a longer read.
_TIMEOUT = httpx.Timeout(25.0, connect=8.0)


def _require_key() -> str:
    key = settings.serpapi_api_key
    if not key:
        raise provider_error(PROVIDER, "unconfigured")
    return key


async def search_hotels(*, query: str, check_in_date: str, check_out_date: str,
                        adults: int = 2, currency: str = "KRW",
                        country: Optional[str] = "kr", language: Optional[str] = "ko",
                        hotel_class: Optional[str] = None, max_results: int = 20) -> dict:
    """Call SerpApi `engine=google_hotels` and return normalized nightly prices.

    Returns:
        {
          "hotels": [ { name, price_per_night, currency, rating, reviews,
                        hotel_class, type, latitude, longitude, link, thumbnail } ],
          "currency": "KRW",
          "count": int,
          "lowest_price_per_night": int | None,
          "median_price_per_night": int | None,
        }

    check_in_date / check_out_date must be YYYY-MM-DD, in the future, with
    check_out strictly after check_in (SerpApi requirement).
    Raises HTTPException on errors with safe public messages.
    """
    key = _require_key()
    params = {
        "engine": "google_hotels",
        "q": (query or "").strip(),
        "check_in_date": check_in_date,
        "check_out_date": check_out_date,
        "adults": max(1, int(adults or 1)),
        "currency": (currency or "KRW").upper(),
        "gl": (country or "kr").lower(),
        "hl": (language or "ko").lower(),
        "api_key": key,
    }
    if hotel_class:
        params["hotel_class"] = hotel_class

    timer = Timer()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(SERPAPI_ENDPOINT, params=params)
    except httpx.HTTPError as e:
        logger.warning("SerpApi network error: %s", type(e).__name__)
        raise from_httpx(PROVIDER, e) from e

    if r.status_code >= 400:
        # Surface SerpApi's message without leaking the key.
        try:
            body = r.json()
            msg = body.get("error") or "SerpApi error"
        except Exception:
            msg = r.text[:200] or "SerpApi error"
        logger.warning("SerpApi %s: %s", r.status_code, msg)
        raise from_status(PROVIDER, r.status_code)

    data = r.json()
    # SerpApi returns HTTP 200 with an "error" string for no-results / bad params.
    if data.get("error"):
        logger.warning("SerpApi logical error: %s", data.get("error"))
        raise provider_error(PROVIDER, "no_result")

    out: list[dict] = []
    for p in (data.get("properties") or []):
        rate = p.get("rate_per_night") or {}
        price = rate.get("extracted_lowest")
        if price is None:
            continue  # no usable nightly price → skip
        gps = p.get("gps_coordinates") or {}
        images = p.get("images") or []
        out.append({
            "name": p.get("name") or "",
            "price_per_night": int(round(float(price))),
            "currency": params["currency"],
            "rating": p.get("overall_rating"),
            "reviews": p.get("reviews"),
            "hotel_class": p.get("extracted_hotel_class"),
            "type": p.get("type"),
            "latitude": gps.get("latitude"),
            "longitude": gps.get("longitude"),
            "link": p.get("link"),
            "thumbnail": (images[0].get("thumbnail") if images else None),
        })
        if len(out) >= max(1, int(max_results)):
            break

    prices = [h["price_per_night"] for h in out]
    return {
        "hotels": out,
        "currency": params["currency"],
        "count": len(out),
        "lowest_price_per_night": (min(prices) if prices else None),
        "median_price_per_night": (int(round(statistics.median(prices))) if prices else None),
        "meta": timer.meta(PROVIDER, len(out)),
    }
