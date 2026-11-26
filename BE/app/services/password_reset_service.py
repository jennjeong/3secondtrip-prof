"""비밀번호 재설정 — 1회용 링크 발급, 메일 발송, 새 비밀번호 적용.

메일은 RESEND_API_KEY 와 MAIL_FROM 이 둘 다 있을 때만 보낸다.  없으면
개발 환경(local/development/test)에서만 링크를 서버 로그에 남기고,
운영 환경에서는 기능 자체를 끈다(`is_enabled()` 가 False).
링크·토큰 원문은 운영 로그에 절대 남기지 않는다.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.password import hash_password
from app.models.password_reset import PasswordReset
from app.models.user import User
from app.services import user_service

logger = logging.getLogger("password_reset")

TOKEN_TTL = timedelta(minutes=30)
DEV_ENVS = {"local", "development", "dev", "test"}


def email_configured() -> bool:
    return bool(settings.resend_api_key and settings.mail_from)


def is_dev() -> bool:
    return (settings.app_env or "").lower() in DEV_ENVS


def is_enabled() -> bool:
    return email_configured() or is_dev()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.utcnow()


def reset_link(token: str) -> str:
    return f"{settings.frontend_origin}{settings.frontend_callback_path}#reset_token={token}"


def _send_email(to: str, link: str) -> None:
    body = (
        "3초 여행 비밀번호 재설정 요청을 받았어요.\n\n"
        f"아래 링크에서 30분 안에 새 비밀번호를 정해 주세요.\n{link}\n\n"
        "직접 요청하지 않았다면 이 메일을 무시해도 돼요. 비밀번호는 바뀌지 않아요."
    )
    try:
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.mail_from, "to": [to], "subject": "[3초 여행] 비밀번호 재설정", "text": body},
            timeout=10,
        )
        if r.status_code >= 300:
            logger.warning("reset mail failed: status=%s", r.status_code)
    except Exception:
        logger.exception("reset mail failed")


def request_reset(db: Session, email: str) -> None:
    """가입 여부와 상관없이 같은 응답을 돌려주도록, 결과를 반환하지 않는다."""
    en = user_service.normalize_email(email)
    user = db.query(User).filter(User.email_normalized == en, User.provider == "local").first()
    if not user:
        return
    now = _now()
    # 이전에 보낸 링크는 모두 무효로 한다 — 가장 최근 링크만 쓸 수 있다.
    db.query(PasswordReset).filter(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None)) \
        .update({PasswordReset.used_at: now}, synchronize_session=False)
    token = secrets.token_urlsafe(32)
    db.add(PasswordReset(user_id=user.id, token_hash=_hash(token), expires_at=now + TOKEN_TTL))
    db.commit()
    link = reset_link(token)
    if email_configured():
        _send_email(user.email, link)
    elif is_dev():
        logger.warning("[dev] password reset link for user %s: %s", user.id, link)


def confirm_reset(db: Session, token: str, new_password: str) -> bool:
    row = db.query(PasswordReset).filter(PasswordReset.token_hash == _hash(token)).first()
    now = _now()
    if not row or row.used_at is not None or row.expires_at <= now:
        return False
    user = db.get(User, row.user_id)
    if not user or user.provider != "local":
        return False
    user.password_hash = hash_password(new_password)
    if user.email_verified_at is None:       # 메일의 링크를 열었다 = 이메일을 받을 수 있다
        user.email_verified_at = now
    # 다른 기기에 남아 있는 로그인을 모두 끊는다
    user.token_version = int(user.token_version or 0) + 1
    row.used_at = now
    db.commit()
    return True
