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


def send(to: str, subject: str, text: str) -> bool:
    if not configured():
        return False
    try:
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.mail_from, "to": [to], "subject": subject, "text": text},
            timeout=10,
        )
        if r.status_code >= 300:
            logger.warning("mail failed: status=%s subject=%s", r.status_code, subject)
            return False
        return True
    except Exception:
        logger.exception("mail failed: subject=%s", subject)
        return False
