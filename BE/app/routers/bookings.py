"""Bookings router — store final selected options as summary."""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import jsonsafe
from app.db.database import get_db
from app.models.booking import Booking
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.booking_schema import BookingCreate, BookingPublic

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _to_public(b: Booking) -> BookingPublic:
    return BookingPublic(
        id=b.id, user_id=b.user_id, trip_id=b.trip_id, schedule_id=b.schedule_id,
        booking_data=jsonsafe.loads(b.booking_data_json, {}),
        total_price=b.total_price, currency=b.currency, created_at=b.created_at,
    )


@router.post("", response_model=BookingPublic, status_code=201)
def create_booking(payload: BookingCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    b = Booking(
        user_id=current.id, trip_id=payload.trip_id, schedule_id=payload.schedule_id,
        booking_data_json=json.dumps(payload.booking_data or {}, ensure_ascii=False),
        total_price=payload.total_price, currency=payload.currency or "KRW",
    )
    db.add(b); db.commit(); db.refresh(b)
    return _to_public(b)


@router.get("", response_model=list[BookingPublic])
def list_bookings(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    rows = db.query(Booking).filter(Booking.user_id == current.id).order_by(Booking.created_at.desc()).all()
    return [_to_public(b) for b in rows]


@router.get("/{booking_id}", response_model=BookingPublic)
def get_booking(booking_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    b = db.query(Booking).filter(Booking.id == booking_id, Booking.user_id == current.id).first()
    if not b:
        raise HTTPException(404, "Booking not found")
    return _to_public(b)


@router.delete("/{booking_id}", status_code=204)
def delete_booking(booking_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    b = db.query(Booking).filter(Booking.id == booking_id, Booking.user_id == current.id).first()
    if not b:
        raise HTTPException(404, "Booking not found")
    db.delete(b); db.commit()
