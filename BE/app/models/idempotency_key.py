"""IdempotencyKey — 같은 요청이 두 번 와도(탭 두 개·네트워크 재시도) 한 번만 만들게 하는 기록.

(scope, endpoint, key) 가 같으면 처음 돌려준 응답을 그대로 다시 돌려준다.
scope 는 "u:<user_id>" 또는 로그인 없는 요청의 "ip:<주소>".
응답에는 일정 내용·관리 키가 들어 있을 수 있어 암호화해 저장한다.  24시간 뒤 지운다.
"""
from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint, func

from app.db.database import Base
from app.models._crypto_type import EncryptedString


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id = Column(Integer, primary_key=True)
    scope = Column(String(80), nullable=False)
    endpoint = Column(String(80), nullable=False)
    key = Column(String(128), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_json = Column(EncryptedString(), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint("scope", "endpoint", "key", name="uq_idempotency_scope_endpoint_key"),
    )
