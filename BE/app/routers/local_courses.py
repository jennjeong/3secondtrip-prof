"""동네 사람이 쓴 코스 — 공개 글은 누구나 읽고, 쓰기는 로그인, 공개는 운영자 확인 뒤."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.core.rate_limit import RateLimiter
from app.db.database import get_db
from app.models.local_course import LocalCourse
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.local_course_schema import LocalCourseMine, LocalCoursePublic, LocalCourseReport, LocalCourseWrite

router = APIRouter(prefix="/local-courses", tags=["local-courses"])
log = logging.getLogger("local_courses")

MAX_PER_USER = 20
MAX_PENDING = 5
_write_limit = RateLimiter(per_ip=6, total=60)
_report_limit = RateLimiter(per_ip=3, total=60)


def _fields(c: LocalCourse, author: str | None) -> dict:
    return dict(id=c.id, author=author or "동네 사람", city=c.city, country=c.country, area=c.area, lived=c.lived,
                title=c.title, concept=c.concept, note=c.note, days=json.loads(c.plan_json), created_at=c.created_at)


def _mine(c: LocalCourse, user: User) -> LocalCourseMine:
    return LocalCourseMine(**_fields(c, user.nickname), status=c.status, review_note=c.review_note)


def _apply(c: LocalCourse, p: LocalCourseWrite) -> None:
    c.city, c.country, c.area, c.lived = p.city, p.country, p.area or None, p.lived
    c.title, c.concept, c.note = p.title, p.concept, p.note
    c.plan_json = json.dumps([[s.model_dump() for s in d] for d in p.days], ensure_ascii=False)


def _own(db: Session, cid: int, user: User) -> LocalCourse:
    c = db.query(LocalCourse).filter(LocalCourse.id == cid, LocalCourse.user_id == user.id).first()
    if not c:
        raise HTTPException(404, "Course not found")
    return c


def _need_nickname(user: User) -> None:
    if not (user.nickname or "").strip():
        raise HTTPException(409, "작성자로 보여 줄 닉네임을 먼저 정해 주세요.")


def _public(db: Session):
    return (db.query(LocalCourse, User.nickname).join(User, User.id == LocalCourse.user_id)
            .filter(LocalCourse.status == "approved", User.is_active == True))  # noqa: E712


@router.get("", response_model=list[LocalCoursePublic])
def list_courses(city: str | None = Query(None, max_length=60), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db)):
    q = _public(db)
    if city:
        q = q.filter(LocalCourse.city == city)
    rows = q.order_by(desc(LocalCourse.created_at), desc(LocalCourse.id)).limit(limit).all()
    return [LocalCoursePublic(**_fields(c, nick)) for c, nick in rows]


@router.get("/mine", response_model=list[LocalCourseMine])
def my_courses(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    rows = db.query(LocalCourse).filter(LocalCourse.user_id == current.id).order_by(desc(LocalCourse.id)).all()
    return [_mine(c, current) for c in rows]


@router.get("/{cid}", response_model=LocalCoursePublic)
def get_course(cid: int, db: Session = Depends(get_db)):
    row = _public(db).filter(LocalCourse.id == cid).first()
    if not row:
        raise HTTPException(404, "Course not found")
    return LocalCoursePublic(**_fields(row[0], row[1]))


@router.post("", response_model=LocalCourseMine, status_code=201, dependencies=[Depends(_write_limit)])
def create_course(payload: LocalCourseWrite, response: Response, db: Session = Depends(get_db),
                  current: User = Depends(get_current_user)):
    _need_nickname(current)
    c = LocalCourse(user_id=current.id, status="pending", reports=0)
    _apply(c, payload)
    # 같은 글을 다시 보내면(재전송·두 번 누름) 새로 만들지 않는다.
    dup = (db.query(LocalCourse)
           .filter(LocalCourse.user_id == current.id, LocalCourse.city == c.city,
                   LocalCourse.title == c.title, LocalCourse.plan_json == c.plan_json).first())
    if dup:
        response.status_code = 200
        return _mine(dup, current)
    counts = dict(db.query(LocalCourse.status, func.count(LocalCourse.id))
                  .filter(LocalCourse.user_id == current.id).group_by(LocalCourse.status).all())
    if sum(counts.values()) >= MAX_PER_USER:
        raise HTTPException(409, f"코스는 {MAX_PER_USER}개까지 쓸 수 있어요. 예전 코스를 지우고 다시 올려 주세요.")
    if counts.get("pending", 0) >= MAX_PENDING:
        raise HTTPException(409, f"확인을 기다리는 코스가 {MAX_PENDING}개예요. 확인이 끝난 뒤 다시 올려 주세요.")
    db.add(c); db.commit(); db.refresh(c)
    log.info("local course submitted id=%s", c.id)
    return _mine(c, current)


@router.put("/{cid}", response_model=LocalCourseMine, dependencies=[Depends(_write_limit)])
def update_course(cid: int, payload: LocalCourseWrite, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """고치면 다시 확인을 받는다 — 확인받은 뒤 다른 내용으로 바꿔 공개되지 않게."""
    _need_nickname(current)
    c = _own(db, cid, current)
    _apply(c, payload)
    c.status, c.review_note = "pending", None
    db.commit(); db.refresh(c)
    return _mine(c, current)


@router.delete("/{cid}", status_code=204)
def delete_course(cid: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    db.delete(_own(db, cid, current)); db.commit()


@router.post("/{cid}/report", status_code=202, dependencies=[Depends(_report_limit)])
def report_course(cid: int, payload: LocalCourseReport, db: Session = Depends(get_db)):
    n = (db.query(LocalCourse).filter(LocalCourse.id == cid, LocalCourse.status == "approved")
         .update({LocalCourse.reports: LocalCourse.reports + 1, LocalCourse.updated_at: LocalCourse.updated_at},
                 synchronize_session=False))
    if not n:
        raise HTTPException(404, "Course not found")
    db.commit()
    log.info("local course reported id=%s reason=%s", cid, payload.reason)
    return {"ok": True}
