"""User / signup / profile schemas (Pydantic v2)."""
import re
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict

from app.core import password_policy


def _pw(v: str) -> str:
    msg = password_policy.check(v)
    if msg:
        raise ValueError(msg)
    return v


class PasswordSignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=2, max_length=30)
    name: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=30)
    birth_date: Optional[date] = None
    # 필수 동의 — 셋 다 참이어야 가입된다(화면에서 정책 전문을 열어 볼 수 있다)
    agree_terms: bool = False
    agree_privacy: bool = False
    agree_age: bool = False

    @field_validator("agree_terms", "agree_privacy", "agree_age")
    @classmethod
    def _must_agree(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("필수 항목에 동의해 주세요.")
        return v

    @field_validator("password")
    @classmethod
    def _pw_complexity(cls, v: str) -> str:
        return _pw(v)

    @field_validator("birth_date")
    @classmethod
    def _birth_not_future(cls, v: Optional[date]) -> Optional[date]:
        if v and v > date.today():
            raise ValueError("생년월일은 미래일 수 없습니다.")
        return v


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=16, max_length=200)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def _pw_complexity(cls, v: str) -> str:
        return _pw(v)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _pw_complexity(cls, v: str) -> str:
        return _pw(v)


class SignupPending(BaseModel):
    """가입 요청을 받았다 — 이메일 인증을 마쳐야 로그인된다."""
    status: str = "verification_required"
    email: str
    expires_in: int
    resend_after: int
    sent: bool
    dev_code: Optional[str] = None   # 개발 환경 + 메일 미설정일 때만(운영에서는 늘 비어 있다)
    send_error: Optional[str] = None  # 메일을 못 보냈을 때 이유: rejected | network | not_configured


class VerifyEmailRequest(BaseModel):
    email: Optional[EmailStr] = None
    code: Optional[str] = Field(default=None, min_length=6, max_length=6)
    token: Optional[str] = Field(default=None, min_length=16, max_length=200)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserUpdateRequest(BaseModel):
    nickname: Optional[str] = Field(default=None, min_length=2, max_length=30)
    name: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=30)
    birth_date: Optional[date] = None
    profile_image_url: Optional[str] = Field(default=None, max_length=1024)


class UserPublic(BaseModel):
    """Never includes password_hash."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    email: Optional[str] = None
    nickname: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    birth_date: Optional[date] = None
    profile_image_url: Optional[str] = None
    created_at: Optional[datetime] = None
    email_verified_at: Optional[datetime] = None


class SignupResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"


class CheckDuplicateResponse(BaseModel):
    available: bool
    reason: Optional[str] = None


class AccountDeleteRequest(BaseModel):
    """계정 삭제 — 실수로 지우지 않게 확인 문구를 그대로 적어야 한다.
    이메일 가입 계정은 비밀번호도 확인한다(소셜 계정은 비밀번호가 없다)."""
    confirm: str = Field(min_length=1, max_length=20)
    password: Optional[str] = Field(default=None, max_length=128)
