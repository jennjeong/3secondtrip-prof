"""JWT 발급/검증 — 비밀은 .env (JWT_SECRET) 에만 존재."""
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from jose import jwt, JWTError

from app.core.config import settings


def create_access_token(*, user_id: int | None = None, data: dict[str, Any] | None = None) -> str:
    """JWT 생성.  user_id 가 주어지면 sub 클레임에 자동 세팅.

    예) create_access_token(user_id=123)
        create_access_token(data={"sub": "123", "scope": "admin"})
    """
    payload: dict[str, Any] = dict(data or {})
    if user_id is not None and "sub" not in payload:
        payload["sub"] = str(user_id)
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload["exp"] = expire
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        # Never log the token
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
