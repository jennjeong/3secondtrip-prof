"""Shared trips — 긴 무작위 링크를 아는 사람만 읽고 고칠 수 있다.

로그인 없이 쓰는 기능이라 토큰이 곧 권한이다.  version 이 어긋나면 409 를
돌려줘 다른 사람의 수정을 덮어쓰지 않게 한다.
"""
import json
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.rate_limit import RateLimiter
from app.db.database import get_db
from app.models.shared_trip import SharedTrip
from app.schemas.shared_trip_schema import SharedTripPublic, SharedTripUpdate, SharedTripWrite

router = APIRouter(prefix="/api/shared-trips", tags=["shared-trips"])

MAX_ROWS = 5000
RETENTION_DAYS = 180
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_create_limit = RateLimiter(per_ip=5, total=30)
_access_limit = RateLimiter(per_ip=60, total=600)


def _to_public(row: SharedTrip) -> SharedTripPublic:
    return SharedTripPublic(token=row.token, data=json.loads(row.data_json), version=row.version)


def _load(db: Session, token: str) -> SharedTrip:
    row = db.get(SharedTrip, token) if _TOKEN_RE.match(token) else None
    if not row:
        raise HTTPException(404, "Shared trip not found")
    return row


@router.post("", response_model=SharedTripPublic, status_code=201, dependencies=[Depends(_create_limit)])
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
    return _to_public(row)


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
