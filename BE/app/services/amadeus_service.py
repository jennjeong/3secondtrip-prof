"""Amadeus Self-Service proxy — 실시간 호텔 1박 요금 조회.

흐름:
  1) OAuth2 client_credentials 로 access_token 획득(프로세스 캐시, ~30분).
  2) Hotel List (by-geocode): 좌표 주변 호텔의 hotelId 목록.
  3) Hotel Offers (v3): hotelIds + 체크인/아웃 + 인원으로 실제 요금.
  4) 1박 단가 = 총액 / 박수.  같은 도시·날짜의 실제 시세를 반환.

키는 settings(AMADEUS_*) 에만 존재하고 프론트로 노출되지 않는다.
키 미설정·결과 없음·오류 시 None 을 돌려 프론트가 추정값으로 fallback 한다.
"""
import logging
import time
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("amadeus")

_TIMEOUT = httpx.Timeout(15.0, connect=8.0)


def _base_url() -> str:
    return ("https://api.amadeus.com" if settings.amadeus_env == "production"
            else "https://test.api.amadeus.com")


# ── OAuth 토큰 캐시 (프로세스 메모리) ──────────────────────────────
_token: Optional[str] = None
_token_exp: float = 0.0


def is_configured() -> bool:
    return bool(settings.amadeus_client_id and settings.amadeus_client_secret)


async def _get_token() -> Optional[str]:
    global _token, _token_exp
    if not is_configured():
        return None
    now = time.time()
    if _token and now < _token_exp - 60:     # 만료 60초 전까지 재사용
        return _token
    data = {
        "grant_type": "client_credentials",
        "client_id": settings.amadeus_client_id,
        "client_secret": settings.amadeus_client_secret,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(f"{_base_url()}/v1/security/oauth2/token", data=data,
                              headers={"Content-Type": "application/x-www-form-urlencoded"})
        r.raise_for_status()
        body = r.json()
    _token = body.get("access_token")
    _token_exp = now + int(body.get("expires_in", 1799))
    return _token


async def _hotel_ids_by_geo(token: str, lat: float, lng: float, radius_km: int = 5,
                            limit: int = 20) -> list[str]:
    params = {
        "latitude": lat, "longitude": lng,
        "radius": radius_km, "radiusUnit": "KM",
        "hotelSource": "ALL",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(f"{_base_url()}/v1/reference-data/locations/hotels/by-geocode",
                             params=params, headers={"Authorization": f"Bearer {token}"})
        r.raise_for_status()
        data = r.json().get("data") or []
    ids = [h.get("hotelId") for h in data if h.get("hotelId")]
    return ids[:limit]


def _nights(check_in: str, check_out: str) -> int:
    from datetime import date
    try:
        d1 = date.fromisoformat(check_in[:10])
        d2 = date.fromisoformat(check_out[:10])
        return max(1, (d2 - d1).days)
    except (ValueError, TypeError):
        return 1


async def nightly_price(*, lat: float, lng: float, check_in: str, check_out: str,
                        adults: int = 2, rooms: int = 1, currency: str = "KRW",
                        name: Optional[str] = None) -> Optional[dict]:
    """좌표 주변 호텔들의 실제 요금을 조회해 1박 단가(원)를 돌려준다.

    name 이 주어지면 이름이 가장 비슷한 호텔의 요금을 우선 선택, 없으면
    중앙값에 가까운 대표 요금을 반환.  결과 형식:
        { "nightly": int, "currency": str, "hotel": str, "matched": bool }
    조회 실패/미설정 시 None.
    """
    token = await _get_token()
    if not token:
        return None
    try:
        hotel_ids = await _hotel_ids_by_geo(token, lat, lng)
        if not hotel_ids:
            return None
        params = {
            "hotelIds": ",".join(hotel_ids),
            "checkInDate": check_in[:10],
            "checkOutDate": check_out[:10],
            "adults": max(1, adults),
            "roomQuantity": max(1, rooms),
            "currency": currency,
            "bestRateOnly": "true",
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(f"{_base_url()}/v3/shopping/hotel-offers",
                                 params=params, headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            data = r.json().get("data") or []
    except httpx.HTTPStatusError as e:
        logger.warning("[amadeus] offers HTTP %s", e.response.status_code if e.response else "?")
        return None
    except Exception:
        logger.exception("[amadeus] hotel offers failed")
        return None

    nights = _nights(check_in, check_out)
    candidates = []
    for item in data:
        hotel = (item.get("hotel") or {}).get("name") or ""
        offers = item.get("offers") or []
        if not offers:
            continue
        try:
            total = float(offers[0].get("price", {}).get("total"))
        except (TypeError, ValueError):
            continue
        per_night = total / (nights * max(1, rooms))
        candidates.append({"hotel": hotel, "nightly": int(round(per_night)),
                           "currency": (offers[0].get("price", {}).get("currency") or currency)})
    if not candidates:
        return None

    # 이름 매칭 우선 — 부분 일치 가장 강한 것
    if name:
        key = name.strip().lower()
        best = None
        for c in candidates:
            hn = c["hotel"].strip().lower()
            if hn and (hn in key or key in hn):
                best = {**c, "matched": True}
                break
        if best:
            return best

    # 대표값 — 중앙값에 가장 가까운 후보
    candidates.sort(key=lambda c: c["nightly"])
    mid = candidates[len(candidates) // 2]
    return {**mid, "matched": False}
