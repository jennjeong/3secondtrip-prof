"""메일 보내기 — Resend API. RESEND_API_KEY 와 MAIL_FROM 이 둘 다 있을 때만 보낸다.

받는 주소·본문(코드·링크)은 로그에 남기지 않는다. 실패하면 상태 코드만 남긴다.
"""
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger("mail")

DEV_ENVS = {"local", "development", "dev", "test"}


def configured() -> bool:
    return bool(settings.resend_api_key and settings.mail_from)


def is_dev() -> bool:
    return (settings.app_env or "").lower() in DEV_ENVS


def send_detailed(to: str, subject: str, text: str) -> str:
    """보내고 실패 이유를 돌려준다 — '' 성공 | 'not_configured' 설정 없음 |
    'rejected' 메일 제공자가 거절(키·발신 도메인 확인 필요) | 'network' 연결 실패·시간 초과."""
    if not configured():
        return "not_configured"
    try:
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.mail_from, "to": [to], "subject": subject, "text": text},
            timeout=10,
        )
    except Exception as exc:          # 받는 주소·본문은 남기지 않는다
        logger.warning("mail failed: network error=%s subject=%s", type(exc).__name__, subject)
        return "network"
    if r.status_code >= 300:
        # 401·403: 키가 틀렸거나 발신 도메인이 인증되지 않음, 422: 발신 주소 형식, 429: 한도 초과
        logger.warning("mail failed: provider status=%s subject=%s", r.status_code, subject)
        return "rejected"
    return ""


def send(to: str, subject: str, text: str) -> bool:
    return send_detailed(to, subject, text) == ""
