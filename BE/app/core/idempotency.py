"""Idempotency-Key 헤더 — 같은 요청을 두 번 보내도 한 번만 만든다.

탭 두 개·네트워크 재시도로 같은 POST 가 다시 와도, 같은 사용자(로그인 없는 요청은 같은 IP)가
같은 엔드포인트에 같은 키를 24시간 안에 다시 보내면 처음 응답(상태 코드 포함)을 그대로 돌려준다.
  - 같은 키인데 요청 내용이 다르면 409
  - 헤더가 없으면 지금과 똑같이 동작
키 기록과 만든 데이터는 한 트랜잭션으로 저장되므로, 동시에 온 두 요청 중 하나만 만든다
(나중 요청은 유일 제약에 걸려 먼저 저장된 응답을 돌려받는다).
"""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Callable

from fastapi import Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.idempotency_key import IdempotencyKey

HEADER_NAME = "Idempotency-Key"
REPLAY_HEADER = "Idempotent-Replayed"
MAX_KEY_LEN = 128
TTL = timedelta(hours=24)


def idempotency_key_header(
    idempotency_key: str | None = Header(default=None, alias=HEADER_NAME),
) -> str | None:
    """선택 헤더. 있으면 1~128자의 보이는 ASCII 문자여야 한다(UUID 권장)."""
    if idempotency_key is None:
        return None
    k = idempotency_key.strip()
    if not (1 <= len(k) <= MAX_KEY_LEN) or not k.isascii() or not k.isprintable():
        raise HTTPException(400, f"{HEADER_NAME} must be 1-{MAX_KEY_LEN} printable ASCII characters")
    return k


def client_scope(request: Request) -> str:
    """로그인 없는 요청의 주인 — rate_limit 과 같은 방식으로 IP 를 고른다."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    return f"ip:{ip[:64]}"


def _hash(fingerprint: Any) -> str:
    raw = json.dumps(jsonable_encoder(fingerprint), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _replay(row: IdempotencyKey | None, req_hash: str):
    if row is None or row.status_code is None:
        raise HTTPException(409, "A request with this Idempotency-Key is still in progress")
    if row.request_hash != req_hash:
        raise HTTPException(409, "Idempotency-Key was already used with a different request")
    return JSONResponse(
        content=json.loads(row.response_json),
        status_code=row.status_code,
        headers={REPLAY_HEADER: "true"},
    )


def run_idempotent(db: Session, *, key: str | None, scope: str, endpoint: str,
                   fingerprint: Any, status_code: int, create: Callable[[], Any],
                   alive: Callable[[dict], bool] | None = None):
    """create() 는 db 에 추가·flush 만 하고 응답 객체를 돌려준다. commit 은 여기서 한다.
    alive(처음 응답) 가 거짓이면(그 뒤 사용자가 지웠다) 옛 응답 대신 새로 만든다."""
    if key is None:
        result = create()
        db.commit()
        return result

    req_hash = _hash(fingerprint)
    now = datetime.utcnow()
    # 오래된 키 정리(이 키가 24시간을 넘겼다면 여기서 지워져 새 요청으로 처리된다)
    db.query(IdempotencyKey).filter(IdempotencyKey.created_at < now - TTL).delete(synchronize_session=False)

    def _find():
        return db.query(IdempotencyKey).filter(
            IdempotencyKey.scope == scope, IdempotencyKey.endpoint == endpoint, IdempotencyKey.key == key,
        ).first()

    existing = _find()
    if existing is not None and alive is not None and existing.status_code is not None \
            and existing.request_hash == req_hash:
        try:
            gone = not alive(json.loads(existing.response_json or "{}"))
        except Exception:
            gone = False
        if gone:              # 처음 만든 것이 지워졌다 — 지워진 것을 돌려주지 않고 새 요청으로 처리
            db.delete(existing)
            db.flush()
            existing = None
    if existing is not None:
        db.commit()   # 정리한 내용만 저장
        return _replay(existing, req_hash)

    row = IdempotencyKey(scope=scope, endpoint=endpoint, key=key, request_hash=req_hash, created_at=now)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        # 같은 키의 다른 요청이 막 먼저 저장했다
        db.rollback()
        return _replay(_find(), req_hash)

    try:
        result = create()
        row.status_code = status_code
        row.response_json = json.dumps(jsonable_encoder(result), ensure_ascii=False)
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = _find()
        if winner is None:
            raise          # 키와 상관없는 제약 위반 — 키가 없을 때와 똑같이 처리
        return _replay(winner, req_hash)
    except Exception:
        db.rollback()
        raise
    return result
