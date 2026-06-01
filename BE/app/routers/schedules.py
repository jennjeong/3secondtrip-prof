"""Schedules router — CRUD + save/unsave toggle."""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.schedule import Schedule
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.schedule_schema import ScheduleCreate, ScheduleUpdate, SchedulePublic

router = APIRouter(prefix="/schedules", tags=["schedules"])


def _to_public(s: Schedule) -> SchedulePublic:
    return SchedulePublic(
        id=s.id, user_id=s.user_id, trip_id=s.trip_id, title=s.title,
        schedule_data=(json.loads(s.schedule_data_json or "{}")),
        is_saved=s.is_saved, created_at=s.created_at, updated_at=s.updated_at,
    )


@router.post("", response_model=SchedulePublic, status_code=201)
def create_schedule(payload: ScheduleCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = Schedule(
        user_id=current.id, trip_id=payload.trip_id, title=payload.title,
        schedule_data_json=json.dumps(payload.schedule_data or {}, ensure_ascii=False),
        is_saved=bool(payload.is_saved),
    )
    db.add(s); db.commit(); db.refresh(s)
    return _to_public(s)


@router.get("", response_model=list[SchedulePublic])
def list_schedules(db: Session = Depends(get_db), current: User = Depends(get_current_user),
                   only_saved: bool = False):
    q = db.query(Schedule).filter(Schedule.user_id == current.id)
    if only_saved:
        q = q.filter(Schedule.is_saved == True)  # noqa
    return [_to_public(s) for s in q.order_by(Schedule.created_at.desc()).all()]


@router.get("/{schedule_id}", response_model=SchedulePublic)
def get_schedule(schedule_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    return _to_public(s)


@router.patch("/{schedule_id}", response_model=SchedulePublic)
def update_schedule(schedule_id: int, payload: ScheduleUpdate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    data = payload.model_dump(exclude_unset=True)
    if "schedule_data" in data and data["schedule_data"] is not None:
        s.schedule_data_json = json.dumps(data.pop("schedule_data"), ensure_ascii=False)
    for k, v in data.items():
        setattr(s, k, v)
    db.commit(); db.refresh(s)
    return _to_public(s)


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    db.delete(s); db.commit()


@router.post("/{schedule_id}/save", response_model=SchedulePublic)
def save_schedule(schedule_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    s.is_saved = True
    db.commit(); db.refresh(s)
    return _to_public(s)


@router.delete("/{schedule_id}/save", response_model=SchedulePublic)
def unsave_schedule(schedule_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    s.is_saved = False
    db.commit(); db.refresh(s)
    return _to_public(s)
