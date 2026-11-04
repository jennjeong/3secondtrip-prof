from typing import Any

from pydantic import BaseModel, Field, field_validator

MAX_DAYS = 31
MAX_ACTIVITIES_PER_DAY = 60
MAX_JSON_CHARS = 200_000


class SharedTripWrite(BaseModel):
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def _check_shape(cls, v: dict[str, Any]) -> dict[str, Any]:
        import json

        days = v.get("days")
        if not isinstance(days, list) or not 0 < len(days) <= MAX_DAYS:
            raise ValueError("days must be a list of 1-31 items")
        for d in days:
            acts = d.get("activities") if isinstance(d, dict) else None
            if not isinstance(acts, list) or len(acts) > MAX_ACTIVITIES_PER_DAY:
                raise ValueError("invalid activities")
        if len(json.dumps(v, ensure_ascii=False)) > MAX_JSON_CHARS:
            raise ValueError("trip is too large")
        return v


class SharedTripUpdate(SharedTripWrite):
    version: int = Field(ge=1)


class SharedTripPublic(BaseModel):
    token: str
    data: dict[str, Any]
    version: int
