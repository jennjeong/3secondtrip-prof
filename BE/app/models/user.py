"""User — 로컬(email/password) + 소셜(google/kakao/naver/apple) 통합 모델.

평문 비밀번호 저장 금지.  password_hash 는 bcrypt 단방향 해시.
소셜 로그인 유저는 password_hash = NULL.

PII columns (name / phone / birth_date) 는 Fernet 대칭 암호화로 at-rest
보호됩니다.  app/core/crypto.py + app/models/_crypto_type.py 참고.
"""
from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, func, Boolean
from app.db.database import Base
from app.models._crypto_type import EncryptedString, EncryptedDate


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    # ── 인증 출처 (검색·OAuth 매칭 필요 → 평문) ──────────────────────
    provider = Column(String(20), nullable=False, index=True)           # local | google | kakao | naver | apple
    provider_user_id = Column(String(255), nullable=False, index=True)  # social provider id / email_normalized

    # ── 이메일·닉네임 (유일성 체크 필요 → 평문) ─────────────────────
    email = Column(String(255), nullable=True, index=True)
    email_normalized = Column(String(255), nullable=True, index=True)
    nickname = Column(String(100), nullable=True)

    # ── 비밀번호 (이미 bcrypt 단방향 해시) ──────────────────────────
    password_hash = Column(String(255), nullable=True)

    # ── PII (Fernet 대칭 암호화) ────────────────────────────────────
    # 컬럼 길이는 Fernet 토큰 길이(~60+ chars per char) 대비 여유 확보.
    name        = Column(EncryptedString(255),  nullable=True)
    phone       = Column(EncryptedString(255),  nullable=True)
    birth_date  = Column(EncryptedDate(64),     nullable=True)

    # ── 공개 이미지 URL — 평문 ─────────────────────────────────────
    profile_image_url = Column(String(1024), nullable=True)

    # ── 권한 ────────────────────────────────────────────────────────
    is_admin   = Column(Boolean, nullable=False, default=False, server_default='0', index=True)
    is_active  = Column(Boolean, nullable=False, default=True,  server_default='1', index=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_provider_uid"),
        UniqueConstraint("email_normalized", name="uq_users_email_normalized"),
        UniqueConstraint("nickname", name="uq_users_nickname"),
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} provider={self.provider} email={self.email}>"
