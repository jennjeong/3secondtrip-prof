"""Trips router — CRUD scoped to current user."""
import json
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core import jsonsafe
from app.db.database import get_db
from app.models.trip import Trip
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.trip_schema import TripCreate, TripUpdate, TripPublic

router = APIRouter(prefix="/trips", tags=["trips"])


def _to_public(t: Trip) -> TripPublic:
    return TripPublic(
        id=t.id, user_id=t.user_id, title=t.title,
        departure_city=t.departure_city,
        destination_country=t.destination_country, destination_city=t.destination_city,
        start_date=t.start_date, end_date=t.end_date,
        companion_type=t.companion_type, concept=t.concept,
        styles=jsonsafe.loads(t.styles_json, []),
        budget=t.budget, currency=t.currency,
        trip_data=jsonsafe.loads(t.trip_data_json, None),
        created_at=t.created_at, updated_at=t.updated_at,
    )


@router.post("", response_model=TripPublic, status_code=201)
def create_trip(payload: TripCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    t = Trip(
        user_id=current.id, title=payload.title,
        departure_city=payload.departure_city,
        destination_country=payload.destination_country, destination_city=payload.destination_city,
        start_date=payload.start_date, end_date=payload.end_date,
        companion_type=payload.companion_type, concept=payload.concept,
        styles_json=json.dumps(payload.styles or [], ensure_ascii=False),
        budget=payload.budget, currency=payload.currency or "KRW",
        trip_data_json=(json.dumps(payload.trip_data, ensure_ascii=False) if payload.trip_data is not None else None),
    )
    db.add(t); db.commit(); db.refresh(t)
    return _to_public(t)


@router.get("", response_model=list[TripPublic])
def list_trips(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    rows = db.query(Trip).filter(Trip.user_id == current.id).order_by(Trip.created_at.desc()).all()
    return [_to_public(t) for t in rows]


@router.get("/{trip_id}", response_model=TripPublic)
def get_trip(trip_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    t = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == current.id).first()
    if not t:
        raise HTTPException(404, "Trip not found")
    return _to_public(t)


@router.patch("/{trip_id}", response_model=TripPublic)
def update_trip(trip_id: int, payload: TripUpdate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    t = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == current.id).first()
    if not t:
        raise HTTPException(404, "Trip not found")
    data = payload.model_dump(exclude_unset=True)
    if "styles" in data:
        t.styles_json = json.dumps(data.pop("styles") or [], ensure_ascii=False)
    if "trip_data" in data:
        td = data.pop("trip_data")
        t.trip_data_json = json.dumps(td, ensure_ascii=False) if td is not None else None
    for k, v in data.items():
        setattr(t, k, v)
    db.commit(); db.refresh(t)
    return _to_public(t)


@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    t = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == current.id).first()
    if not t:
        raise HTTPException(404, "Trip not found")
    db.delete(t); db.commit()
    return
