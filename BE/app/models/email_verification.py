"""EmailVerification — 이메일 인증용 6자리 코드와 1회용 링크.

코드·링크 원문은 저장하지 않고 해시만 보관한다. 새로 보내면 이전 것은 모두 무효가 된다.
코드는 5번 틀리면 그 코드를 더 쓸 수 없다(다시 받아야 한다).
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.db.database import Base


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash = Column(String(64), nullable=False)
    link_hash = Column(String(64), nullable=False, unique=True, index=True)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
