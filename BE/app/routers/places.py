"""Places search + TripPlace CRUD."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.idempotency import idempotency_key_header, run_idempotent
from app.db.database import get_db
from app.models.trip import Trip
from app.models.trip_place import TripPlace
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.place_schema import (
    PlaceSearchRequest, PlaceSearchResponse, PlaceResult,
    TripPlaceCreate, TripPlaceUpdate, TripPlacePublic,
)
from app.services.google_maps_service import search_places
from app.services.provider_errors import Timer

router = APIRouter(prefix="/api", tags=["maps"])


# ── Places API proxy ─────────────────────────────────────────────
@router.post("/places/search", response_model=PlaceSearchResponse)
async def places_search(payload: PlaceSearchRequest):
    timer = Timer()
    items = await search_places(
        query=payload.query,
        language=payload.language,
        region=payload.region,
        max_results=payload.max_results,
        center_lat=payload.center_lat,
        center_lng=payload.center_lng,
    )
    return PlaceSearchResponse(places=[PlaceResult(**i) for i in items], meta=timer.meta("google_places", len(items)))


# ── TripPlace CRUD ───────────────────────────────────────────────
def _owned_place(db: Session, user: User, place_id: int) -> TripPlace:
    """남의 여행 장소는 없는 장소와 똑같이 404 — 응답 문구로도 존재 여부를 알 수 없게 한다."""
    tp = (db.query(TripPlace).join(Trip, Trip.id == TripPlace.trip_id)
          .filter(TripPlace.id == place_id, Trip.user_id == user.id).first())
    if not tp:
        raise HTTPException(404, "TripPlace not found")
    return tp


def _assert_owns_trip(db: Session, user: User, trip_id: int) -> Trip:
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user.id).first()
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


@router.post("/trip-places", response_model=TripPlacePublic, status_code=201)
def create_trip_place(payload: TripPlaceCreate,
                      db: Session = Depends(get_db),
                      current: User = Depends(get_current_user)):
    _assert_owns_trip(db, current, payload.trip_id)
    tp = TripPlace(**payload.model_dump())
    db.add(tp); db.commit(); db.refresh(tp)
    return TripPlacePublic.model_validate(tp)


@router.post("/trip-places/bulk", response_model=list[TripPlacePublic], status_code=201)
def bulk_replace_trip_places(items: list[TripPlaceCreate],
                             db: Session = Depends(get_db),
                             current: User = Depends(get_current_user),
                             idem_key: str | None = Depends(idempotency_key_header)):
    """Atomic replace per (trip_id, day_number): delete existing for that day
    and re-insert in the provided order.  Use this from the map page after
    resolving all places.
    """
    if not items:
        raise HTTPException(400, "items required")
    trip_id = items[0].trip_id
    days = {i.day_number for i in items}
    if any(i.trip_id != trip_id for i in items):
        raise HTTPException(400, "All items must share trip_id")
    _assert_owns_trip(db, current, trip_id)

    def _replace() -> list[TripPlacePublic]:
        db.query(TripPlace).filter(TripPlace.trip_id == trip_id, TripPlace.day_number.in_(days)).delete(synchronize_session=False)
        out = []
        for it in items:
            tp = TripPlace(**it.model_dump())
            db.add(tp); out.append(tp)
        db.flush()
        for tp in out:
            db.refresh(tp)
        return [TripPlacePublic.model_validate(tp) for tp in out]

    return run_idempotent(db, key=idem_key, scope=f"u:{current.id}", endpoint="POST /api/trip-places/bulk",
                          fingerprint=[i.model_dump(mode="json") for i in items], status_code=201, create=_replace)


@router.get("/trip-places", response_model=list[TripPlacePublic])
def list_trip_places(trip_id: int = Query(...),
                     day_number: int | None = Query(None),
                     db: Session = Depends(get_db),
                     current: User = Depends(get_current_user)):
    _assert_owns_trip(db, current, trip_id)
    q = db.query(TripPlace).filter(TripPlace.trip_id == trip_id)
    if day_number is not None:
        q = q.filter(TripPlace.day_number == day_number)
    rows = q.order_by(TripPlace.day_number, TripPlace.place_order).all()
    return [TripPlacePublic.model_validate(r) for r in rows]


@router.patch("/trip-places/{place_id}", response_model=TripPlacePublic)
def update_trip_place(place_id: int, payload: TripPlaceUpdate,
                      db: Session = Depends(get_db),
                      current: User = Depends(get_current_user)):
    tp = _owned_place(db, current, place_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(tp, k, v)
    try:
        db.commit()
    except IntegrityError:
        # 같은 날·같은 순서에 다른 장소가 있다 — 서버 오류(500) 대신 무엇이 겹쳤는지 알려 준다
        db.rollback()
        raise HTTPException(409, "같은 날 같은 순서에 다른 장소가 있어요. 순서를 바꾼 뒤 다시 저장해 주세요.")
    db.refresh(tp)
    return TripPlacePublic.model_validate(tp)


@router.delete("/trip-places/{place_id}", status_code=204)
def delete_trip_place(place_id: int,
                      db: Session = Depends(get_db),
                      current: User = Depends(get_current_user)):
    tp = _owned_place(db, current, place_id)
    db.delete(tp); db.commit()
