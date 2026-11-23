"""이용 통계 — 정해진 이벤트의 날짜별 합계만 받는다."""
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.rate_limit import RateLimiter
from app.db.database import get_db
from app.models.event_count import EventCount
from app.models.user import User
from app.routers.dependencies import get_current_admin

router = APIRouter(prefix="/api/events", tags=["events"])

EventName = Literal[
    "trip_step_city", "trip_step_dates", "trip_step_concept", "trip_step_budget", "trip_created",
    "trip_shared", "trip_exported", "collab_started", "booking_opened", "booking_link_clicked",
    "app_installed", "client_error",
    "trip_generate_start", "trip_generate_done", "trip_generate_fail",
    "trip_saved", "collab_revoked",
    # 운영 지표 — 개수만 센다
    "gen_time_under10", "gen_time_10to30", "gen_time_over30",
    "gen_price_live", "gen_price_estimated", "gen_places_fallback",
    "api_fail_places", "api_fail_flights", "api_fail_hotels",
    "trip_save_fail", "trip_share_fail",
]
_limit = RateLimiter(per_ip=60, total=1200)


class EventIn(BaseModel):
    name: EventName


@router.post("", status_code=204, dependencies=[Depends(_limit)])
def record_event(payload: EventIn, db: Session = Depends(get_db)):
    today = date.today()
    row = db.get(EventCount, (today, payload.name))
    if row:
        row.count = EventCount.count + 1
    else:
        db.add(EventCount(day=today, name=payload.name, count=1))
    db.commit()


@router.get("/summary")
def event_summary(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    since = date.today() - timedelta(days=days - 1)
    rows = db.query(EventCount).filter(EventCount.day >= since).order_by(EventCount.day).all()
    return [{"day": r.day.isoformat(), "name": r.name, "count": r.count} for r in rows]
