"""어떤 외부 기능이 서버에 연결돼 있는지 알려 준다.

키 값은 절대 돌려주지 않고, 설정 여부(참/거짓)만 알려 준다.  화면은 이 값으로
실시간 요금 조회나 AI 요약을 시도할지 정하고, 꺼져 있으면 추정치를 쓴다는
안내를 보여 준다.
"""
from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api", tags=["features"])


@router.get("/features")
def features() -> dict:
    serp = bool(settings.serpapi_api_key)
    return {
        "live_flights": serp,
        "live_hotels": serp,
        "ai_summary": bool(settings.openai_api_key),
        "places": bool(settings.google_maps_server_key),
    }
