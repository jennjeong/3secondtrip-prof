"""FastAPI dependencies — JWT bearer auth + current_user loader."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.database import get_db
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


def _version_ok(payload: dict, user: User) -> bool:
    """토큰의 tv 가 사용자의 현재 token_version 과 같아야 한다.
    tv 가 없는 예전 토큰은 0 으로 본다(배포만으로 로그아웃되지 않게)."""
    try:
        return int(payload.get("tv", 0)) == int(user.token_version or 0)
    except (TypeError, ValueError):
        return False


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                     db: Session = Depends(get_db)) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(creds.credentials)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(User).filter(User.id == int(sub)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not _version_ok(payload, user):
        # 비밀번호가 바뀐 뒤의 옛 토큰 — 화면은 이 값으로 안내 문구를 고른다
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token_revoked")
    if user.provider == "local" and user.email_verified_at is None:
        # 이메일 인증 전 계정은 저장·계정 기능을 쓸 수 없다(토큰도 인증 뒤에만 발급되지만 한 번 더 막는다)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="email_unverified")
    return user


def get_current_user_optional(creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                              db: Session = Depends(get_db)) -> User | None:
    if not creds or not creds.credentials:
        return None
    try:
        payload = decode_access_token(creds.credentials)
        sub = payload.get("sub")
        if not sub:
            return None
        user = db.query(User).filter(User.id == int(sub)).first()
        return user if user and _version_ok(payload, user) else None
    except HTTPException:
        return None


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """Require an authenticated admin (is_admin=True). 403 otherwise."""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    if not getattr(user, "is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")
    return user
