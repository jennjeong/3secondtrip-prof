"""외부 제공처(Google 장소·경로, SerpApi 항공·숙소) 오류를 한 모양으로 돌려준다.

화면은 code 로 '전부 실패'와 '다시 시도할 수 있는 실패'를 구분한다.
  timeout      응답이 늦음            (다시 시도 가능)
  network      연결하지 못함          (다시 시도 가능)
  upstream     제공처 오류            (다시 시도 가능)
  quota        조회 한도 초과         (나중에 가능)
  unconfigured 서버에 키가 없음       (불가)
  rejected     요청 조건을 거절       (불가)
  no_result    조건에 맞는 결과 없음  (불가)
제공처가 보낸 원문에는 내부 정보가 섞일 수 있어 사용자에게 그대로 보내지 않는다(서버 로그에만 남긴다).
"""
from datetime import datetime, timezone
import time

import httpx
from fastapi import HTTPException

_SPEC = {
    "timeout": (504, "제공처 응답이 늦어요. 잠시 뒤 다시 시도해 주세요.", True),
    "network": (502, "제공처에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.", True),
    "upstream": (502, "제공처가 오류를 돌려줬어요. 잠시 뒤 다시 시도해 주세요.", True),
    "quota": (429, "조회 한도를 다 썼어요. 나중에 다시 시도해 주세요.", True),
    "unconfigured": (503, "서버에 아직 연결되지 않은 기능이에요.", False),
    "rejected": (400, "조회 조건을 받아들이지 않았어요.", False),
    "no_result": (404, "조건에 맞는 결과가 없어요.", False),
}


def provider_error(provider: str, code: str) -> HTTPException:
    status, message, retryable = _SPEC[code]
    return HTTPException(status_code=status, detail={"code": code, "provider": provider, "message": message, "retryable": retryable})


def from_httpx(provider: str, exc: httpx.HTTPError) -> HTTPException:
    return provider_error(provider, "timeout" if isinstance(exc, httpx.TimeoutException) else "network")


def from_status(provider: str, status: int) -> HTTPException:
    if status == 429:
        return provider_error(provider, "quota")
    if status in (401, 403):          # 키 문제 — 사용자가 다시 시도해도 나아지지 않는다
        return provider_error(provider, "unconfigured")
    if status in (400, 404, 422):
        return provider_error(provider, "rejected")
    return provider_error(provider, "upstream")


class Timer:
    def __init__(self) -> None:
        self._t = time.perf_counter()

    def meta(self, provider: str, count: int) -> dict:
        return {
            "provider": provider,
            "status": "live" if count else "empty",
            "latency_ms": int((time.perf_counter() - self._t) * 1000),
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
