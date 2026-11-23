"""Shared trips — 긴 무작위 링크를 아는 사람만 읽고 고칠 수 있다.

로그인 없이 쓰는 기능이라 토큰이 곧 권한이다.  version 이 어긋나면 409 를
돌려줘 다른 사람의 수정을 덮어쓰지 않게 한다.

링크 회수(DELETE)는 만든 사람만 할 수 있다.  만들 때 한 번만 돌려주는 관리 키
(토큰을 서버 비밀값으로 서명한 값)를 X-Manage-Key 헤더로 보내야 한다.
DB 에 따로 저장하지 않으므로 열 추가 없이 동작한다.
"""
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import RateLimiter
from app.db.database import get_db
from app.models.shared_trip import SharedTrip
from app.schemas.shared_trip_schema import SharedTripCreated, SharedTripPublic, SharedTripUpdate, SharedTripWrite

router = APIRouter(prefix="/api/shared-trips", tags=["shared-trips"])

MAX_ROWS = 5000
RETENTION_DAYS = 180
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_create_limit = RateLimiter(per_ip=5, total=30)
_access_limit = RateLimiter(per_ip=60, total=600)


def _to_public(row: SharedTrip) -> SharedTripPublic:
    return SharedTripPublic(token=row.token, data=json.loads(row.data_json), version=row.version)


def _manage_key(token: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), b"shared-trip-manage:" + token.encode(), hashlib.sha256).hexdigest()


def _load(db: Session, token: str) -> SharedTrip:
    row = db.get(SharedTrip, token) if _TOKEN_RE.match(token) else None
    if not row:
        raise HTTPException(404, "Shared trip not found")
    return row


@router.post("", response_model=SharedTripCreated, status_code=201, dependencies=[Depends(_create_limit)])
def create_shared_trip(payload: SharedTripWrite, db: Session = Depends(get_db)):
    cutoff = datetime.utcnow() - timedelta(days=RETENTION_DAYS)
    db.query(SharedTrip).filter(SharedTrip.updated_at < cutoff).delete()
    if db.query(SharedTrip).count() >= MAX_ROWS:
        raise HTTPException(503, "Shared trip storage is full")
    row = SharedTrip(
        token=secrets.token_urlsafe(32),
        data_json=json.dumps(payload.data, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    pub = _to_public(row)
    return SharedTripCreated(**pub.model_dump(), manage_key=_manage_key(row.token))


@router.get("/{token}", response_model=SharedTripPublic, dependencies=[Depends(_access_limit)])
def get_shared_trip(token: str, db: Session = Depends(get_db)):
    return _to_public(_load(db, token))


@router.put("/{token}", response_model=SharedTripPublic, dependencies=[Depends(_access_limit)])
def update_shared_trip(token: str, payload: SharedTripUpdate, db: Session = Depends(get_db)):
    _load(db, token)
    # 조건부 UPDATE — 두 사람이 동시에 저장해도 한 명만 성공한다.
    result = db.execute(
        update(SharedTrip)
        .where(SharedTrip.token == token, SharedTrip.version == payload.version)
        .values(data_json=json.dumps(payload.data, ensure_ascii=False), version=payload.version + 1)
    )
    db.commit()
    db.expire_all()
    row = _load(db, token)
    if result.rowcount == 0:
        raise HTTPException(409, detail="Trip was changed by someone else")
    return _to_public(row)


@router.delete("/{token}", status_code=204, dependencies=[Depends(_access_limit)])
def revoke_shared_trip(token: str, x_manage_key: str = Header(default=""), db: Session = Depends(get_db)):
    """링크 회수 — 만든 사람의 관리 키가 맞을 때만 지운다. 지운 뒤에는 링크가 404 가 된다."""
    row = _load(db, token)
    if not x_manage_key or not hmac.compare_digest(x_manage_key, _manage_key(token)):
        raise HTTPException(403, "Only the creator can revoke this link")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
