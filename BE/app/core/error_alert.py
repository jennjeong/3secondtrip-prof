"""서버 오류 알림 — ERROR_WEBHOOK_URL(Discord 형식)이 있을 때만 보낸다.

경로 템플릿과 오류 종류만 보낸다.  요청 값·토큰·개인정보는 절대 넣지 않는다.
"""
import logging
import time

import httpx

from app.core.config import settings

logger = logging.getLogger("error_alert")
MIN_INTERVAL_SECONDS = 300
_last_sent = 0.0


async def send_error_alert(route: str, error_type: str) -> None:
    global _last_sent
    url = settings.error_webhook_url
    now = time.monotonic()
    if not url or (_last_sent and now - _last_sent < MIN_INTERVAL_SECONDS):
        return
    _last_sent = now
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(url, json={"content": f"🚨 3초 여행 서버 오류: {route} ({error_type})"})
    except httpx.HTTPError:
        logger.warning("error alert delivery failed")
