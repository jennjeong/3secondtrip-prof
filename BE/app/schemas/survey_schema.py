from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field


class SurveySave(BaseModel):
    pace: Optional[str] = None
    food_preference: Optional[str] = None
    activity_preference: Optional[str] = None
    budget_preference: Optional[str] = None
    mobility_preference: Optional[str] = None
    survey_data: Optional[dict[str, Any]] = None


class SurveyPublic(SurveySave):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
