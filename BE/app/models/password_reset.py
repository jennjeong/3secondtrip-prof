"""PasswordReset — 비밀번호 재설정용 1회용 링크.

토큰 원문은 저장하지 않고 SHA-256 해시만 보관한다.  만료(30분)되었거나
한 번 쓰인 토큰은 다시 쓸 수 없다.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.db.database import Base


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
