"""Google Maps Platform proxy — Routes API v2 + Places API v1.

The server-side key is read from settings.google_maps_server_key.
NEVER returned to the frontend.  Frontend gets the *browser* key via
/api/config/maps which is referrer-restricted at GCP Console.
"""
from typing import Optional
import logging

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger("google_maps")

ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"
PLACES_TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"

_TIMEOUT = httpx.Timeout(15.0, connect=8.0)


def _require_key() -> str:
    key = settings.google_maps_server_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GOOGLE_MAPS_SERVER_KEY is not configured on the server.",
        )
    return key


async def compute_route(*, origin, destination, waypoints, travel_mode: str,
                        language: Optional[str] = "ko", region: Optional[str] = None) -> dict:
    """Call Routes API v2 computeRoutes.

    Returns: { distance_meters, duration_seconds, encoded_polyline, summary }
    Raises HTTPException on errors with safe public messages.
    """
    key = _require_key()
    payload = {
        "origin":      {"location": {"latLng": {"latitude": origin.lat, "longitude": origin.lng}}},
        "destination": {"location": {"latLng": {"latitude": destination.lat, "longitude": destination.lng}}},
        "travelMode":  travel_mode,
        "computeAlternativeRoutes": False,
        "languageCode": language or "ko",
        "units": "METRIC",
    }
    if waypoints:
        payload["intermediates"] = [
            {"location": {"latLng": {"latitude": w.lat, "longitude": w.lng}}} for w in waypoints
        ]
    if travel_mode == "DRIVE":
        payload["routingPreference"] = "TRAFFIC_AWARE"
    if region:
        payload["regionCode"] = region

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(ROUTES_ENDPOINT, json=payload, headers=headers)
    except httpx.HTTPError as e:
        logger.exception("Routes API network error")
        raise HTTPException(status_code=502, detail="Routes API network error") from e

    if r.status_code >= 400:
        # Surface Google's error message without leaking the key
        try:
            body = r.json()
            msg = (body.get("error") or {}).get("message") or "Routes API error"
        except Exception:
            msg = r.text[:200] or "Routes API error"
        logger.warning("Routes API %s: %s", r.status_code, msg)
        # Bad request from us → 400; quota/permission → 403/429; else 502
        if r.status_code in (400, 403, 404, 429):
            raise HTTPException(status_code=r.status_code, detail=msg)
        raise HTTPException(status_code=502, detail=msg)

    data = r.json()
    routes = data.get("routes") or []
    if not routes:
        # Dump Google's raw response — invaluable when Google says 200 OK
        # but returns no usable routes (typically FieldMask / mode mismatch
        # / very rare actual no-route).
        try:
            logger.warning("Routes API 200 but no routes.  body=%s", str(data)[:500])
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="No route found")
    rt = routes[0]
    poly = (rt.get("polyline") or {}).get("encodedPolyline") or ""
    # Routes API returns duration like "1234s"
    raw_dur = rt.get("duration", "0s")
    try:
        dur_s = int(str(raw_dur).rstrip("s"))
    except ValueError:
        dur_s = 0
    return {
        "distance_meters": int(rt.get("distanceMeters") or 0),
        "duration_seconds": dur_s,
        "encoded_polyline": poly,
        "summary": None,
    }


async def search_places(*, query: str, language: Optional[str] = "ko",
                        region: Optional[str] = None, max_results: int = 8,
                        center_lat: Optional[float] = None, center_lng: Optional[float] = None) -> list[dict]:
    """Call Places API v1 :searchText.

    Returns list of: { place_id, name, address, latitude, longitude, rating?, user_rating_count?, types[] }
    """
    key = _require_key()
    payload = {
        "textQuery": query.strip(),
        "languageCode": language or "ko",
        "maxResultCount": max(1, min(int(max_results), 20)),
    }
    if region:
        payload["regionCode"] = region
    if center_lat is not None and center_lng is not None:
        payload["locationBias"] = {
            "circle": {
                "center": {"latitude": float(center_lat), "longitude": float(center_lng)},
                "radius": 50000.0,
            }
        }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(PLACES_TEXT_ENDPOINT, json=payload, headers=headers)
    except httpx.HTTPError as e:
        logger.exception("Places API network error")
        raise HTTPException(status_code=502, detail="Places API network error") from e

    if r.status_code >= 400:
        try:
            body = r.json()
            msg = (body.get("error") or {}).get("message") or "Places API error"
        except Exception:
            msg = r.text[:200] or "Places API error"
        logger.warning("Places API %s: %s", r.status_code, msg)
        if r.status_code in (400, 403, 404, 429):
            raise HTTPException(status_code=r.status_code, detail=msg)
        raise HTTPException(status_code=502, detail=msg)

    out: list[dict] = []
    for p in (r.json().get("places") or []):
        loc = p.get("location") or {}
        name = (p.get("displayName") or {}).get("text") or ""
        if not name or loc.get("latitude") is None or loc.get("longitude") is None:
            continue
        out.append({
            "place_id": p.get("id") or "",
            "name": name,
            "address": p.get("formattedAddress"),
            "latitude": float(loc["latitude"]),
            "longitude": float(loc["longitude"]),
            "rating": p.get("rating"),
            "user_rating_count": p.get("userRatingCount"),
            "types": p.get("types") or [],
        })
    return out
