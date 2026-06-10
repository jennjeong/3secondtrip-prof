"""Admin router — 관리자 전용 엔드포인트.

모든 엔드포인트는 get_current_admin 의존성을 통해 보호됨.
JWT + is_admin=True 인 사용자만 호출 가능.
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User
from app.models.trip import Trip
from app.models.schedule import Schedule
from app.models.roadmap import Roadmap
from app.models.review import Review
from app.models.blog import Blog
from app.models.feedback import Feedback
from app.routers.dependencies import get_current_admin

router = APIRouter(prefix="/admin", tags=["admin"])


# ════════════════════════════════════════════════════════════════
# 📊  대시보드 통계
# ════════════════════════════════════════════════════════════════
@router.get("/stats")
def get_admin_stats(db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    """전체 통계: 가입자/일정/콘텐츠 수, provider 분포, 인기 도시 등."""
    user_total = db.query(func.count(User.id)).scalar() or 0
    user_active = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0
    trip_total = db.query(func.count(Trip.id)).scalar() or 0
    schedule_total = db.query(func.count(Schedule.id)).scalar() or 0
    schedule_saved = db.query(func.count(Schedule.id)).filter(Schedule.is_saved == True).scalar() or 0
    roadmap_total = db.query(func.count(Roadmap.id)).scalar() or 0
    review_total = db.query(func.count(Review.id)).scalar() or 0
    blog_total = db.query(func.count(Blog.id)).scalar() or 0

    # provider 분포
    provider_rows = db.query(User.provider, func.count(User.id)).group_by(User.provider).all()
    by_provider = {p: n for p, n in provider_rows}

    # 최근 7일 가입자 (일별)
    seven_ago = datetime.utcnow() - timedelta(days=7)
    signup_rows = (
        db.query(func.date(User.created_at).label("d"), func.count(User.id))
        .filter(User.created_at >= seven_ago)
        .group_by(func.date(User.created_at))
        .all()
    )
    signups_by_day = {str(d): n for d, n in signup_rows}

    # 인기 목적지 도시 TOP 10
    city_rows = (
        db.query(Trip.destination_city, func.count(Trip.id).label("c"))
        .filter(Trip.destination_city.isnot(None))
        .group_by(Trip.destination_city)
        .order_by(desc("c"))
        .limit(10).all()
    )
    top_cities = [{"city": c or "-", "count": n} for c, n in city_rows]

    # 인기 컨셉
    concept_rows = (
        db.query(Trip.concept, func.count(Trip.id))
        .filter(Trip.concept.isnot(None))
        .group_by(Trip.concept).all()
    )
    by_concept = {(c or "-"): n for c, n in concept_rows}

    # 피드백 통계
    feedback_total = db.query(func.count(Feedback.id)).scalar() or 0
    fb_status_rows = db.query(Feedback.status, func.count(Feedback.id)).group_by(Feedback.status).all()
    fb_by_status = {(s or "-"): n for s, n in fb_status_rows}
    fb_type_rows = db.query(Feedback.feedback_type, func.count(Feedback.id)).group_by(Feedback.feedback_type).all()
    fb_by_type = {(t or "-"): n for t, n in fb_type_rows}
    fb_unresolved = db.query(func.count(Feedback.id)).filter(Feedback.status.in_(["new", "in_progress"])).scalar() or 0

    return {
        "users":     {"total": user_total, "active": user_active, "by_provider": by_provider, "signups_7d": signups_by_day},
        "trips":     {"total": trip_total, "top_cities": top_cities, "by_concept": by_concept},
        "schedules": {"total": schedule_total, "saved": schedule_saved},
        "roadmaps":  {"total": roadmap_total},
        "reviews":   {"total": review_total},
        "blogs":     {"total": blog_total},
        "feedback":  {"total": feedback_total, "unresolved": fb_unresolved, "by_status": fb_by_status, "by_type": fb_by_type},
        "generated_at": datetime.utcnow().isoformat(),
    }


# ════════════════════════════════════════════════════════════════
# 👥  사용자 관리
# ════════════════════════════════════════════════════════════════
def _user_to_admin_dict(u: User) -> dict:
    return {
        "id": u.id,
        "provider": u.provider,
        "email": u.email,
        "nickname": u.nickname,
        "is_admin": bool(u.is_admin),
        "is_active": bool(u.is_active),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "profile_image_url": u.profile_image_url,
    }


@router.get("/users")
def list_users(q: Optional[str] = None,
               provider: Optional[str] = None,
               page: int = Query(1, ge=1),
               size: int = Query(20, ge=1, le=200),
               db: Session = Depends(get_db),
               _: User = Depends(get_current_admin)):
    query = db.query(User)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter((func.lower(User.email).like(like)) | (func.lower(User.nickname).like(like)))
    if provider:
        query = query.filter(User.provider == provider)
    total = query.count()
    rows = query.order_by(User.id.desc()).offset((page - 1) * size).limit(size).all()
    return {"total": total, "page": page, "size": size, "items": [_user_to_admin_dict(u) for u in rows]}


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: dict,
                db: Session = Depends(get_db),
                admin: User = Depends(get_current_admin)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    if "is_admin" in payload:
        if u.id == admin.id and not payload["is_admin"]:
            raise HTTPException(400, "관리자 자신의 권한은 해제할 수 없어요.")
        u.is_admin = bool(payload["is_admin"])
    if "is_active" in payload:
        if u.id == admin.id and not payload["is_active"]:
            raise HTTPException(400, "관리자 자신의 계정은 비활성화할 수 없어요.")
        u.is_active = bool(payload["is_active"])
    if "nickname" in payload and payload["nickname"]:
        u.nickname = str(payload["nickname"])[:100]
    db.commit(); db.refresh(u)
    return _user_to_admin_dict(u)


@router.delete("/users/{user_id}")
def delete_user(user_id: int,
                db: Session = Depends(get_db),
                admin: User = Depends(get_current_admin)):
    if user_id == admin.id:
        raise HTTPException(400, "본인 계정은 삭제할 수 없어요.")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    db.delete(u); db.commit()
    return {"ok": True, "deleted_id": user_id}


# ════════════════════════════════════════════════════════════════
# 📅  일정 / 여행 모니터
# ════════════════════════════════════════════════════════════════
@router.get("/trips")
def list_trips(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
               db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    total = db.query(func.count(Trip.id)).scalar() or 0
    rows = db.query(Trip).order_by(Trip.id.desc()).offset((page - 1) * size).limit(size).all()
    items = []
    for t in rows:
        nick = db.query(User.nickname, User.email).filter(User.id == t.user_id).first()
        items.append({
            "id": t.id, "user_id": t.user_id,
            "user_nickname": nick[0] if nick else None,
            "user_email": nick[1] if nick else None,
            "title": t.title, "destination_city": t.destination_city,
            "destination_country": t.destination_country, "departure_city": t.departure_city,
            "start_date": str(t.start_date) if t.start_date else None,
            "end_date":   str(t.end_date)   if t.end_date else None,
            "concept": t.concept, "budget": t.budget, "currency": t.currency,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.delete("/trips/{trip_id}")
def delete_trip(trip_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    obj = db.query(Trip).filter(Trip.id == trip_id).first()
    if not obj: raise HTTPException(404, "Not found")
    db.delete(obj); db.commit()
    return {"ok": True}


@router.get("/schedules")
def list_schedules(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
                   db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    total = db.query(func.count(Schedule.id)).scalar() or 0
    rows = db.query(Schedule).order_by(Schedule.id.desc()).offset((page - 1) * size).limit(size).all()
    items = []
    for s in rows:
        nick = db.query(User.nickname, User.email).filter(User.id == s.user_id).first()
        items.append({
            "id": s.id, "user_id": s.user_id,
            "user_nickname": nick[0] if nick else None,
            "user_email": nick[1] if nick else None,
            "trip_id": s.trip_id, "title": s.title, "is_saved": bool(s.is_saved),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.delete("/schedules/{sid}")
def delete_schedule(sid: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    obj = db.query(Schedule).filter(Schedule.id == sid).first()
    if not obj: raise HTTPException(404, "Not found")
    db.delete(obj); db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════════════
# 📝  콘텐츠 모니터링 (Roadmap / Review / Blog)
# ════════════════════════════════════════════════════════════════
def _attach_user(db, user_id):
    if not user_id: return (None, None)
    row = db.query(User.nickname, User.email).filter(User.id == user_id).first()
    return (row[0] if row else None, row[1] if row else None)


@router.get("/roadmaps")
def list_roadmaps(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
                  db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    total = db.query(func.count(Roadmap.id)).scalar() or 0
    rows = db.query(Roadmap).order_by(Roadmap.id.desc()).offset((page - 1) * size).limit(size).all()
    items = []
    for r in rows:
        nick, email = _attach_user(db, r.user_id)
        items.append({
            "id": r.id, "title": r.title, "city": r.city, "country": r.country,
            "concept": r.concept, "days": r.days, "likes": r.likes,
            "is_public": bool(r.is_public),
            "user_id": r.user_id, "user_nickname": nick, "user_email": email,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.post("/roadmaps", status_code=201)
def create_roadmap(payload: dict,
                   db: Session = Depends(get_db),
                   admin: User = Depends(get_current_admin)):
    """관리자가 추천(공개) 로드맵을 직접 추가."""
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "제목은 필수입니다.")

    def _s(k):
        v = payload.get(k)
        v = str(v).strip() if v is not None else ""
        return v[:120] or None

    try:
        days = int(payload["days"]) if payload.get("days") not in (None, "") else None
    except (TypeError, ValueError):
        days = None
    try:
        likes = max(0, int(payload.get("likes") or 0))
    except (TypeError, ValueError):
        likes = 0

    grad = str(payload.get("gradient") or "").strip()
    obj = Roadmap(
        user_id=admin.id,                       # 추천 로드맵의 작성자 = 관리자
        title=title[:255],
        city=_s("city"), country=_s("country"), concept=_s("concept"),
        days=days, likes=likes,
        gradient=(grad[:255] or None),
        is_public=bool(payload.get("is_public", True)),
    )
    db.add(obj); db.commit(); db.refresh(obj)
    return {"ok": True, "id": obj.id}


@router.delete("/roadmaps/{rid}")
def delete_roadmap(rid: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    obj = db.query(Roadmap).filter(Roadmap.id == rid).first()
    if not obj: raise HTTPException(404, "Not found")
    db.delete(obj); db.commit()
    return {"ok": True}


@router.get("/reviews")
def list_reviews(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
                 db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    total = db.query(func.count(Review.id)).scalar() or 0
    rows = db.query(Review).order_by(Review.id.desc()).offset((page - 1) * size).limit(size).all()
    items = []
    for rv in rows:
        nick, email = _attach_user(db, rv.user_id)
        items.append({
            "id": rv.id, "rating": rv.rating, "content": (rv.content or "")[:300],
            "city": rv.city, "trip_id": rv.trip_id, "schedule_id": rv.schedule_id,
            "is_public": bool(rv.is_public),
            "user_id": rv.user_id, "user_nickname": nick, "user_email": email,
            "created_at": rv.created_at.isoformat() if rv.created_at else None,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.delete("/reviews/{rid}")
def delete_review(rid: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    obj = db.query(Review).filter(Review.id == rid).first()
    if not obj: raise HTTPException(404, "Not found")
    db.delete(obj); db.commit()
    return {"ok": True}


@router.get("/blogs")
def list_blogs(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
               db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    total = db.query(func.count(Blog.id)).scalar() or 0
    rows = db.query(Blog).order_by(Blog.id.desc()).offset((page - 1) * size).limit(size).all()
    items = []
    for b in rows:
        nick, email = _attach_user(db, b.user_id)
        items.append({
            "id": b.id, "title": b.title, "visibility": b.visibility,
            "is_draft": bool(b.is_draft), "body_preview": (b.body or "")[:300],
            "user_id": b.user_id, "user_nickname": nick, "user_email": email,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.delete("/blogs/{bid}")
def delete_blog(bid: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    obj = db.query(Blog).filter(Blog.id == bid).first()
    if not obj: raise HTTPException(404, "Not found")
    db.delete(obj); db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════════════
# 💬  피드백 관리
# ════════════════════════════════════════════════════════════════
@router.get("/feedback")
def list_feedback(status: Optional[str] = None,
                  feedback_type: Optional[str] = None,
                  page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=200),
                  db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    query = db.query(Feedback)
    if status:
        query = query.filter(Feedback.status == status)
    if feedback_type:
        query = query.filter(Feedback.feedback_type == feedback_type)
    total = query.count()
    rows = query.order_by(Feedback.id.desc()).offset((page - 1) * size).limit(size).all()
    items = []
    for f in rows:
        nick, email = _attach_user(db, f.user_id)
        items.append({
            "id": f.id,
            "user_id": f.user_id,
            "user_nickname": nick,
            "user_email": email,
            "feedback_type": f.feedback_type,
            "title": f.title,
            "content": (f.content or "")[:600],
            "status": f.status,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.patch("/feedback/{fid}")
def update_feedback(fid: int, payload: dict,
                    db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    f = db.query(Feedback).filter(Feedback.id == fid).first()
    if not f:
        raise HTTPException(404, "Feedback not found")
    allowed_status = {"new", "in_progress", "resolved", "closed"}
    if "status" in payload:
        s = str(payload["status"])
        if s not in allowed_status:
            raise HTTPException(400, f"잘못된 상태값: {s}")
        f.status = s
    db.commit(); db.refresh(f)
    return {"id": f.id, "status": f.status}


@router.delete("/feedback/{fid}")
def delete_feedback(fid: int, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    f = db.query(Feedback).filter(Feedback.id == fid).first()
    if not f: raise HTTPException(404, "Not found")
    db.delete(f); db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════════════
# 🔍 me — 현재 관리자가 누구인지
# ════════════════════════════════════════════════════════════════
@router.get("/me")
def admin_me(admin: User = Depends(get_current_admin)):
    return _user_to_admin_dict(admin)
