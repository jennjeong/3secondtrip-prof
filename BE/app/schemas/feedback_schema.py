from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator

_TYPES = {"bug", "feature", "design", "schedule", "etc"}
_STATUS = {"new", "in_progress", "resolved", "closed"}


class FeedbackCreate(BaseModel):
    feedback_type: str = "etc"
    title: Optional[str] = Field(default=None, max_length=255)
    content: str = Field(min_length=1, max_length=5000)
    # 스크린샷(선택) — base64.  디코딩 후 700KB 이하, JPEG/PNG/WebP 만
    attachment_b64: Optional[str] = Field(default=None, max_length=1_000_000)
    attachment_mime: Optional[str] = Field(default=None, max_length=32)

    @field_validator("feedback_type")
    @classmethod
    def _t(cls, v: str) -> str:
        if v not in _TYPES:
            raise ValueError(f"feedback_type must be one of {sorted(_TYPES)}")
        return v


class FeedbackStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _s(cls, v: str) -> str:
        if v not in _STATUS:
            raise ValueError(f"status must be one of {sorted(_STATUS)}")
        return v


class FeedbackPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[int] = None
    feedback_type: str
    title: Optional[str] = None
    content: str
    has_attachment: bool = False
    status: str
    created_at: Optional[datetime] = None
