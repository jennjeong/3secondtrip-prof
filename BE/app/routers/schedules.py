"""Schedules router — CRUD + save/unsave toggle."""
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import jsonsafe
from app.core.idempotency import idempotency_key_header, run_idempotent
from app.db.database import get_db
from app.models.schedule import Schedule
from app.models.trip import Trip
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.schedule_schema import ScheduleCreate, ScheduleUpdate, SchedulePublic

router = APIRouter(prefix="/schedules", tags=["schedules"])


def _to_public(s: Schedule) -> SchedulePublic:
    return SchedulePublic(
        id=s.id, user_id=s.user_id, trip_id=s.trip_id, title=s.title,
        schedule_data=jsonsafe.loads(s.schedule_data_json, {}),
        is_saved=s.is_saved, created_at=s.created_at, updated_at=s.updated_at,
    )


def _owned_trip(db: Session, user: User, trip_id: int | None) -> Trip | None:
    """일정을 이을 여행은 내 것이어야 한다 — 남의 여행 id 는 없는 것과 같다(404)."""
    if trip_id is None:
        return None
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user.id).first()
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


def _check_days_in_trip(trip: Trip | None, data: dict | None) -> None:
    """여행에 출발·귀국일이 있으면 일정의 날짜(days[].date)는 그 안이어야 한다."""
    if trip is None or not data or not trip.start_date or not trip.end_date:
        return
    for i, d in enumerate(data.get("days") or []):
        ds = d.get("date") if isinstance(d, dict) else None
        if ds and not (trip.start_date <= date.fromisoformat(str(ds)) <= trip.end_date):
            raise HTTPException(422, f"{i + 1}일차 날짜가 여행 기간 밖이에요.")


def _get_owned(db: Session, user: User, schedule_id: int) -> Schedule:
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == user.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    return s


@router.post("", response_model=SchedulePublic, status_code=201)
def create_schedule(payload: ScheduleCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user),
                    idem_key: str | None = Depends(idempotency_key_header)):
    trip = _owned_trip(db, current, payload.trip_id)
    _check_days_in_trip(trip, payload.schedule_data)

    def _create() -> SchedulePublic:
        s = Schedule(
            user_id=current.id, trip_id=payload.trip_id, title=payload.title,
            schedule_data_json=json.dumps(payload.schedule_data or {}, ensure_ascii=False),
            is_saved=bool(payload.is_saved),
        )
        db.add(s); db.flush(); db.refresh(s)
        return _to_public(s)

    return run_idempotent(db, key=idem_key, scope=f"u:{current.id}", endpoint="POST /schedules",
                          fingerprint=payload.model_dump(mode="json"), status_code=201, create=_create)


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
    if data.get("schedule_data") is not None and s.trip_id is not None:
        trip = db.query(Trip).filter(Trip.id == s.trip_id, Trip.user_id == current.id).first()
        _check_days_in_trip(trip, data["schedule_data"])
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
def save_schedule(schedule_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user),
                  idem_key: str | None = Depends(idempotency_key_header)):
    def _save() -> SchedulePublic:
        s = _get_owned(db, current, schedule_id)
        s.is_saved = True
        db.flush(); db.refresh(s)
        return _to_public(s)

    return run_idempotent(db, key=idem_key, scope=f"u:{current.id}", endpoint="POST /schedules/{id}/save",
                          fingerprint={"schedule_id": schedule_id}, status_code=200, create=_save)


@router.delete("/{schedule_id}/save", response_model=SchedulePublic)
def unsave_schedule(schedule_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current.id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    s.is_saved = False
    db.commit(); db.refresh(s)
    return _to_public(s)
