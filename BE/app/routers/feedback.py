"""Feedback router — anyone can submit, status update kept TODO for admin."""
import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.rate_limit import RateLimiter
from app.models.feedback_attachment import FeedbackAttachment
from app.routers.dependencies import get_current_admin

from app.db.database import get_db
from app.models.feedback import Feedback
from app.models.user import User
from app.routers.dependencies import get_current_user, get_current_user_optional
from app.schemas.feedback_schema import FeedbackCreate, FeedbackStatusUpdate, FeedbackPublic

router = APIRouter(prefix="/feedback", tags=["feedback"])


_create_limit = RateLimiter(per_ip=5, total=200, window_seconds=600)
MAX_ATTACHMENT = 700 * 1024
_MAGIC = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG", "image/webp": b"RIFF"}


def _decode_attachment(payload: FeedbackCreate) -> tuple[str, bytes] | None:
    if not payload.attachment_b64:
        return None
    mime = (payload.attachment_mime or "").lower()
    if mime not in _MAGIC:
        raise HTTPException(422, "스크린샷은 JPEG·PNG·WebP 이미지만 보낼 수 있어요.")
    try:
        raw = base64.b64decode(payload.attachment_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "스크린샷 파일을 읽지 못했어요.")
    if len(raw) > MAX_ATTACHMENT:
        raise HTTPException(413, "스크린샷이 너무 커요(700KB 이하).")
    if not raw.startswith(_MAGIC[mime]):
        raise HTTPException(422, "이미지 형식이 올바르지 않아요.")
    return mime, raw


def _public(f: Feedback, has_attachment: bool) -> FeedbackPublic:
    out = FeedbackPublic.model_validate(f)
    out.has_attachment = has_attachment
    return out


@router.post("", response_model=FeedbackPublic, status_code=201, dependencies=[Depends(_create_limit)])
def create_feedback(payload: FeedbackCreate, db: Session = Depends(get_db),
                    current: User | None = Depends(get_current_user_optional)):
    att = _decode_attachment(payload)
    f = Feedback(
        user_id=(current.id if current else None),
        feedback_type=payload.feedback_type, title=payload.title, content=payload.content,
        status="new",
    )
    db.add(f); db.flush()
    if att:
        db.add(FeedbackAttachment(feedback_id=f.id, mime=att[0], size=len(att[1]), data=att[1]))
    db.commit(); db.refresh(f)
    return _public(f, bool(att))


@router.get("/{feedback_id}/attachment")
def get_feedback_attachment(feedback_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    a = db.query(FeedbackAttachment).filter(FeedbackAttachment.feedback_id == feedback_id).first()
    if not a:
        raise HTTPException(404, "Attachment not found")
    return Response(content=a.data, media_type=a.mime, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


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
