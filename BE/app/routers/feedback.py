"""Feedback router — anyone can submit, status update kept TODO for admin."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.feedback import Feedback
from app.models.user import User
from app.routers.dependencies import get_current_user, get_current_user_optional
from app.schemas.feedback_schema import FeedbackCreate, FeedbackStatusUpdate, FeedbackPublic

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackPublic, status_code=201)
def create_feedback(payload: FeedbackCreate, db: Session = Depends(get_db),
                    current: User | None = Depends(get_current_user_optional)):
    f = Feedback(
        user_id=(current.id if current else None),
        feedback_type=payload.feedback_type, title=payload.title, content=payload.content,
        status="new",
    )
    db.add(f); db.commit(); db.refresh(f)
    return FeedbackPublic.model_validate(f)


@router.get("", response_model=list[FeedbackPublic])
def list_feedback(limit: int = Query(50, ge=1, le=200),
                  db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    rows = (db.query(Feedback).filter(Feedback.user_id == current.id)
              .order_by(Feedback.created_at.desc()).limit(limit).all())
    return [FeedbackPublic.model_validate(f) for f in rows]


@router.patch("/{feedback_id}/status", response_model=FeedbackPublic)
def update_feedback_status(feedback_id: int, payload: FeedbackStatusUpdate,
                           db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    # TODO: tighten with an admin-role check.  For now, only the original
    # submitter (or admins later) can update status.
    f = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not f:
        raise HTTPException(404, "Feedback not found")
    if f.user_id is not None and f.user_id != current.id:
        raise HTTPException(403, "Forbidden")
    f.status = payload.status
    db.commit(); db.refresh(f)
    return FeedbackPublic.model_validate(f)
