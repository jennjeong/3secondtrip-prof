from typing import Optional
"""Reviews router — login-required write, public read for is_public=True."""
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.review import Review
from app.models.user import User
from app.routers.dependencies import get_current_user, get_current_user_optional
from app.schemas.review_schema import ReviewCreate, ReviewPublic

router = APIRouter(prefix="/reviews", tags=["reviews"])


def _to_public(r: Review) -> ReviewPublic:
    return ReviewPublic(
        id=r.id, user_id=r.user_id, trip_id=r.trip_id, schedule_id=r.schedule_id,
        rating=r.rating, content=r.content,
        concept_tags=json.loads(r.concept_tags_json or "[]"),
        is_public=r.is_public, city=r.city, created_at=r.created_at,
    )


@router.post("", response_model=ReviewPublic, status_code=201)
def create_review(payload: ReviewCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    r = Review(
        user_id=current.id, trip_id=payload.trip_id, schedule_id=payload.schedule_id,
        rating=payload.rating, content=payload.content,
        concept_tags_json=json.dumps(payload.concept_tags or [], ensure_ascii=False),
        is_public=payload.is_public, city=payload.city,
    )
    db.add(r); db.commit(); db.refresh(r)
    return _to_public(r)


@router.get("", response_model=list[ReviewPublic])
def list_reviews(
    mine: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: Optional[User] = Depends(get_current_user_optional),
):
    if mine:
        if not current:
            raise HTTPException(401, "Login required")
        rows = (db.query(Review).filter(Review.user_id == current.id)
                  .order_by(Review.created_at.desc()).limit(limit).all())
    else:
        rows = (db.query(Review).filter(Review.is_public == True)   # noqa
                  .order_by(Review.created_at.desc()).limit(limit).all())
    return [_to_public(r) for r in rows]


@router.get("/recent", response_model=list[ReviewPublic])
def recent_reviews(limit: int = Query(8, ge=1, le=50), db: Session = Depends(get_db)):
    rows = (db.query(Review).filter(Review.is_public == True)   # noqa
              .order_by(Review.created_at.desc()).limit(limit).all())
    return [_to_public(r) for r in rows]


@router.delete("/{review_id}", status_code=204)
def delete_review(review_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    r = db.query(Review).filter(Review.id == review_id, Review.user_id == current.id).first()
    if not r:
        raise HTTPException(404, "Review not found")
    db.delete(r); db.commit()
