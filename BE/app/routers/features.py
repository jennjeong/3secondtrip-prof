"""어떤 외부 기능이 서버에 연결돼 있는지 알려 준다.

키 값은 절대 돌려주지 않고, 설정 여부(참/거짓)만 알려 준다.  화면은 이 값으로
실시간 요금 조회나 AI 요약을 시도할지 정하고, 꺼져 있으면 추정치를 쓴다는
안내를 보여 준다.
"""
from fastapi import APIRouter

from app.core.config import settings
from app.core import password_policy
from app.services import email_verification_service, mail_service, password_reset_service

router = APIRouter(prefix="/api", tags=["features"])


@router.get("/features")
def features() -> dict:
    serp = bool(settings.serpapi_api_key)
    return {
        "live_flights": serp,
        "live_hotels": serp,
        "ai_summary": bool(settings.openai_api_key),
        "places": bool(settings.google_maps_server_key),
        # 메일 서비스가 없으면 운영에서는 꺼진다(개발 환경은 서버 로그로 링크 확인)
        "password_reset": password_reset_service.is_enabled(),
        "email_signup": email_verification_service.is_enabled(),     # 인증 메일을 보낼 수 있을 때만 가입을 연다
        # 운영 점검용 — 키 값은 숨기고, 메일 설정 여부와 메일 속 인증 링크가 열 주소(공개 화면 주소)만 알려 준다
        "email": {"configured": mail_service.configured(),
                  "link_base": f"{settings.frontend_origin}{settings.frontend_callback_path}"},
        "password_policy": password_policy.describe(),
        # 설정이 안 된 소셜 로그인은 화면에서 '준비 중'으로 막는다(JSON 오류 화면 방지)
        "oauth": {
            "google": bool(settings.google_client_id and settings.google_client_secret),
            "kakao": bool(settings.kakao_client_id),
            "naver": bool(settings.naver_client_id and settings.naver_client_secret),
            "apple": bool(settings.apple_client_id and settings.apple_team_id and settings.apple_key_id),
        },
    }
