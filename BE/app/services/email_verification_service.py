"""이메일 인증 — 가입한 이메일을 실제로 받을 수 있는지 6자리 코드(또는 메일 속 링크)로 확인한다.

- 코드 15분, 5번 틀리면 그 코드는 못 쓴다. 새로 보내면 이전 코드·링크는 모두 무효.
- 재발송은 60초에 한 번. 코드·링크 원문은 저장하지도, 로그에 남기지도 않는다.
- 메일 서비스가 없으면: 개발 환경은 응답에 코드를 실어 시험할 수 있게 하고(dev_code), 운영에서는 가입을 막는다.
"""
import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.email_verification import EmailVerification
from app.models.user import User
from app.services import mail_service

CODE_TTL = timedelta(minutes=15)
RESEND_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 5


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.utcnow()


def is_enabled() -> bool:
    return mail_service.configured() or mail_service.is_dev()


def is_verified(user: User) -> bool:
    """소셜 계정은 공급자가 이메일을 확인했다. 이메일 가입 계정은 인증을 마쳐야 한다."""
    return user.provider != "local" or user.email_verified_at is not None


def latest(db: Session, user: User) -> EmailVerification | None:
    return (db.query(EmailVerification).filter(EmailVerification.user_id == user.id)
            .order_by(EmailVerification.id.desc()).first())


def seconds_until_resend(db: Session, user: User) -> int:
    row = latest(db, user)
    if not row or not row.created_at:
        return 0
    left = (row.created_at + RESEND_AFTER - _now()).total_seconds()
    return max(0, int(left + .999))


def issue(db: Session, user: User) -> dict:
    """새 코드를 만들어 보낸다. 반환: {'sent': bool, 'dev_code': str|None, 'expires_in': 초}"""
    now = _now()
    db.query(EmailVerification).filter(EmailVerification.user_id == user.id, EmailVerification.used_at.is_(None)) \
        .update({EmailVerification.used_at: now}, synchronize_session=False)
    code = f"{secrets.randbelow(1_000_000):06d}"
    link = secrets.token_urlsafe(32)
    db.add(EmailVerification(user_id=user.id, code_hash=_hash(code), link_hash=_hash(link), expires_at=now + CODE_TTL))
    db.commit()
    url = f"{settings.frontend_origin}{settings.frontend_callback_path}#verify_token={link}"
    body = (
        f"3초 여행 이메일 인증 코드: {code}\n\n"
        "가입 화면에 이 6자리 코드를 넣어 주세요. 15분 동안 쓸 수 있어요.\n"
        f"다른 기기에서 열었다면 이 링크를 눌러도 인증돼요.\n{url}\n\n"
        "직접 가입하지 않았다면 이 메일을 무시해 주세요. 인증하지 않은 계정은 쓸 수 없어요."
    )
    error = mail_service.send_detailed(user.email, "[3초 여행] 이메일 인증 코드", body)
    sent = error == ""
    dev_code = code if (not sent and mail_service.is_dev()) else None
    if not sent and not dev_code:
        # 전달되지 않은 코드는 쓸 수 없으니 지운다 — 60초를 기다리지 않고 바로 다시 보낼 수 있다
        db.query(EmailVerification).filter(EmailVerification.user_id == user.id, EmailVerification.link_hash == _hash(link)) \
            .delete(synchronize_session=False)
        db.commit()
    return {"sent": sent, "dev_code": dev_code, "send_error": None if sent or dev_code else error,
            "expires_in": int(CODE_TTL.total_seconds())}


def verify_code(db: Session, user: User, code: str) -> str:
    """'ok' | 'invalid' | 'expired' | 'locked' | 'none'"""
    row = latest(db, user)
    if not row:
        return "none"
    now = _now()
    if row.used_at is not None:
        return "expired"
    if row.expires_at <= now:
        return "expired"
    if row.attempts >= MAX_ATTEMPTS:
        return "locked"
    if not secrets.compare_digest(row.code_hash, _hash((code or "").strip())):
        row.attempts = int(row.attempts or 0) + 1
        db.commit()
        return "locked" if row.attempts >= MAX_ATTEMPTS else "invalid"
    row.used_at = now
    user.email_verified_at = now
    db.commit()
    return "ok"


def verify_link(db: Session, token: str) -> tuple[str, User | None]:
    """메일 속 링크 — 'ok' | 'used' | 'expired' | 'invalid'"""
    row = db.query(EmailVerification).filter(EmailVerification.link_hash == _hash(token or "")).first()
    if not row:
        return "invalid", None
    user = db.get(User, row.user_id)
    if not user:
        return "invalid", None
    if user.email_verified_at is not None:
        return "used", user
    now = _now()
    if row.used_at is not None:
        return "used" if user.email_verified_at else "expired", user
    if row.expires_at <= now:
        return "expired", user
    row.used_at = now
    user.email_verified_at = now
    db.commit()
    return "ok", user


STALE_AFTER = timedelta(days=7)


def purge_stale(db: Session) -> int:
    """인증을 7일 넘게 마치지 않은 이메일 가입 요청을 지운다(개인정보 처리방침의 보관 기간)."""
    cut = _now() - STALE_AFTER
    olds = db.query(User).filter(User.provider == "local", User.email_verified_at.is_(None), User.created_at < cut).all()
    for u in olds:
        db.query(EmailVerification).filter(EmailVerification.user_id == u.id).delete(synchronize_session=False)
        db.delete(u)
    if olds:
        db.commit()
    return len(olds)
