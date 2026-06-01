"""User / signup / profile schemas (Pydantic v2)."""
import re
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict

_PW_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,128}$")


class PasswordSignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=2, max_length=30)
    name: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=30)
    birth_date: Optional[date] = None

    @field_validator("password")
    @classmethod
    def _pw_complexity(cls, v: str) -> str:
        if not _PW_RE.match(v):
            raise ValueError("비밀번호는 8자 이상이며 영문/숫자를 각각 포함해야 합니다.")
        return v

    @field_validator("birth_date")
    @classmethod
    def _birth_not_future(cls, v: Optional[date]) -> Optional[date]:
        if v and v > date.today():
            raise ValueError("생년월일은 미래일 수 없습니다.")
        return v


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


class SignupResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"


class CheckDuplicateResponse(BaseModel):
    available: bool
    reason: Optional[str] = None
