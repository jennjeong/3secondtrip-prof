"""Surveys router — taste survey, 1 row per user."""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.survey import TasteSurvey
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.survey_schema import SurveySave, SurveyPublic

router = APIRouter(prefix="/surveys", tags=["surveys"])


def _to_public(s: TasteSurvey) -> SurveyPublic:
    return SurveyPublic(
        id=s.id, user_id=s.user_id, pace=s.pace,
        food_preference=s.food_preference, activity_preference=s.activity_preference,
        budget_preference=s.budget_preference, mobility_preference=s.mobility_preference,
        survey_data=(json.loads(s.survey_data_json) if s.survey_data_json else None),
        created_at=s.created_at, updated_at=s.updated_at,
    )


@router.post("/me", response_model=SurveyPublic, status_code=201)
@router.patch("/me", response_model=SurveyPublic)
def upsert_my_survey(payload: SurveySave, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(TasteSurvey).filter(TasteSurvey.user_id == current.id).first()
    if not s:
        s = TasteSurvey(user_id=current.id)
        db.add(s)
    for k in ("pace", "food_preference", "activity_preference", "budget_preference", "mobility_preference"):
        v = getattr(payload, k)
        if v is not None:
            setattr(s, k, v)
    if payload.survey_data is not None:
        s.survey_data_json = json.dumps(payload.survey_data, ensure_ascii=False)
    db.commit(); db.refresh(s)
    return _to_public(s)


@router.get("/me", response_model=SurveyPublic)
def get_my_survey(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(TasteSurvey).filter(TasteSurvey.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Survey not found")
    return _to_public(s)
