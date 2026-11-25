"""동네 사람이 쓴 코스 — 입력 검증과 공개 형태."""
import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Lived = Literal["1년 미만", "1~3년", "3~10년", "10년 이상", "나고 자랐어요"]
Concept = Literal["가성비", "균형", "프리미엄", "효율", "힐링", "액티비티"]
Category = Literal["식사", "카페", "시장", "산책", "가게", "볼거리", "저녁"]

_LINK = re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(com|net|kr|io|me|shop|link)\b", re.I)
_PHONE = re.compile(r"\d{2,4}[-. ]\d{3,4}[-. ]\d{4}|[\w.+-]+@[\w-]+\.\w+")
# 제어 문자와, 글자 순서를 뒤집거나 보이지 않게 끼워 넣는 문자
_CTRL = re.compile("[\\x00-\\x08\\x0b-\\x1f\\x7f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]")


def _clean(v: str, *, lines: bool = False) -> str:
    v = _CTRL.sub("", v.replace("\r\n", "\n"))
    if lines:
        v = re.sub(r"[ \t]+", " ", v)
        v = re.sub(r"\n{3,}", "\n\n", v)
    else:
        v = re.sub(r"\s+", " ", v)
    v = v.strip()
    if _PHONE.search(v):
        raise ValueError("전화번호·이메일은 넣을 수 없어요")
    if _LINK.search(v):
        raise ValueError("링크는 넣을 수 없어요")
    return v


class Stop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time: str = Field(default="", pattern=r"^$|^([01]\d|2[0-3]):[0-5]\d$")
    name: str = Field(min_length=1, max_length=60)
    cat: Category
    tip: str = Field(default="", max_length=120)

    @field_validator("name", "tip")
    @classmethod
    def _text(cls, v: str, info):
        v = _clean(v)
        if info.field_name == "name" and not v:
            raise ValueError("장소 이름을 적어 주세요")
        return v


class LocalCourseWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: str = Field(min_length=1, max_length=60)
    country: str = Field(min_length=1, max_length=60)
    area: Optional[str] = Field(default=None, max_length=30)
    lived: Lived
    title: str = Field(min_length=4, max_length=60)
    concept: Concept
    note: str = Field(min_length=10, max_length=400)
    days: list[list[Stop]] = Field(min_length=1, max_length=5)
    confirm_local: Literal[True]                # ‘이 도시에 살고 있거나 살았어요’에 체크

    @field_validator("city", "country", "area", "title")
    @classmethod
    def _one_line(cls, v, info):
        v = _clean(v) if v else v
        if info.field_name in ("city", "country") and not v:
            raise ValueError("도시를 골라 주세요")
        if info.field_name == "title" and len(v) < 4:
            raise ValueError("제목을 네 글자 이상 적어 주세요")
        return v

    @field_validator("note")
    @classmethod
    def _note(cls, v: str):
        v = _clean(v, lines=True)
        if len(v) < 10:
            raise ValueError("한마디를 열 글자 이상 적어 주세요")
        return v

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        if any(not 2 <= len(d) <= 12 for d in v):
            raise ValueError("하루에 장소를 2~12곳 적어 주세요")
        return v


class LocalCoursePublic(BaseModel):
    """공개 글에는 닉네임만 — 이메일·사용자 번호는 내보내지 않는다."""
    id: int
    author: str
    city: str
    country: str
    area: Optional[str] = None
    lived: str
    title: str
    concept: str
    note: str
    days: list[list[Stop]]
    created_at: Optional[datetime] = None


class LocalCourseMine(LocalCoursePublic):
    status: str
    review_note: Optional[str] = None


class LocalCourseReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Literal["광고", "사실과 달라요", "부적절해요", "개인정보"]


class LocalCourseReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["pending", "approved", "rejected"]
    review_note: Optional[str] = Field(default=None, max_length=200)
