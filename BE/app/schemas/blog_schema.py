from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator

_VIS = {"public", "link", "private"}


class BlogBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    tags: list[str] = Field(default_factory=list)
    body: str = Field(min_length=1)
    visibility: str = "public"
    is_draft: bool = False

    @field_validator("visibility")
    @classmethod
    def _vis(cls, v: str) -> str:
        if v not in _VIS:
            raise ValueError("visibility must be one of public|link|private")
        return v


class BlogCreate(BlogBase): ...
class BlogUpdate(BaseModel):
    title: Optional[str] = None
    tags: Optional[list[str]] = None
    body: Optional[str] = None
    visibility: Optional[str] = None
    is_draft: Optional[bool] = None


class BlogPublic(BlogBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
