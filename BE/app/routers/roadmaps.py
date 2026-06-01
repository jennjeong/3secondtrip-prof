"""Roadmaps router — public read, login-required write."""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.roadmap import Roadmap
from app.models.user import User
from app.routers.dependencies import get_current_user, get_current_user_optional
from app.schemas.roadmap_schema import RoadmapCreate, RoadmapUpdate, RoadmapPublic

router = APIRouter(prefix="/roadmaps", tags=["roadmaps"])


def _to_public(r: Roadmap) -> RoadmapPublic:
    return RoadmapPublic(
        id=r.id, user_id=r.user_id, title=r.title, city=r.city, country=r.country,
        concept=r.concept, days=r.days, likes=r.likes or 0, gradient=r.gradient,
        roadmap_data=(json.loads(r.roadmap_data_json) if r.roadmap_data_json else None),
        is_public=r.is_public, created_at=r.created_at, updated_at=r.updated_at,
    )


def _apply_filters(q, sort: str, concept: Optional[str], city: Optional[str], country: Optional[str]):
    if concept: q = q.filter(Roadmap.concept == concept)
    if city: q = q.filter(Roadmap.city == city)
    if country: q = q.filter(Roadmap.country == country)
    if sort == "latest":
        q = q.order_by(desc(Roadmap.created_at))
    elif sort == "likes":
        q = q.order_by(desc(Roadmap.likes))
    else:
        q = q.order_by(desc(Roadmap.likes), desc(Roadmap.created_at))
    return q


@router.get("", response_model=list[RoadmapPublic])
def list_roadmaps(
    sort: str = Query("popular"),
    concept: Optional[str] = None,
    city: Optional[str] = None,
    country: Optional[str] = None,
    mine: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: Optional[User] = Depends(get_current_user_optional),
):
    if mine:
        if not current:
            raise HTTPException(401, "Login required")
        base_q = db.query(Roadmap).filter(Roadmap.user_id == current.id)
    else:
        base_q = db.query(Roadmap).filter(Roadmap.is_public == True)  # noqa
    q = _apply_filters(base_q, sort, concept, city, country)
    return [_to_public(r) for r in q.limit(limit).all()]


@router.get("/popular", response_model=list[RoadmapPublic])
def popular_roadmaps(limit: int = Query(8, ge=1, le=50), db: Session = Depends(get_db)):
    rows = db.query(Roadmap).filter(Roadmap.is_public == True).order_by(desc(Roadmap.likes)).limit(limit).all()  # noqa
    return [_to_public(r) for r in rows]


@router.get("/{roadmap_id}", response_model=RoadmapPublic)
def get_roadmap(roadmap_id: int, db: Session = Depends(get_db)):
    r = db.query(Roadmap).filter(Roadmap.id == roadmap_id, Roadmap.is_public == True).first()  # noqa
    if not r:
        raise HTTPException(404, "Roadmap not found")
    return _to_public(r)


@router.post("", response_model=RoadmapPublic, status_code=201)
def create_roadmap(payload: RoadmapCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    r = Roadmap(
        user_id=current.id, title=payload.title, city=payload.city, country=payload.country,
        concept=payload.concept, days=payload.days, likes=payload.likes or 0,
        gradient=payload.gradient, is_public=payload.is_public,
        roadmap_data_json=(json.dumps(payload.roadmap_data, ensure_ascii=False) if payload.roadmap_data else None),
    )
    db.add(r); db.commit(); db.refresh(r)
    return _to_public(r)


@router.patch("/{roadmap_id}", response_model=RoadmapPublic)
def update_roadmap(roadmap_id: int, payload: RoadmapUpdate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    r = db.query(Roadmap).filter(Roadmap.id == roadmap_id, Roadmap.user_id == current.id).first()
    if not r:
        raise HTTPException(404, "Roadmap not found")
    data = payload.model_dump(exclude_unset=True)
    if "roadmap_data" in data:
        rd = data.pop("roadmap_data")
        r.roadmap_data_json = json.dumps(rd, ensure_ascii=False) if rd is not None else None
    for k, v in data.items():
        setattr(r, k, v)
    db.commit(); db.refresh(r)
    return _to_public(r)


@router.delete("/{roadmap_id}", status_code=204)
def delete_roadmap(roadmap_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    r = db.query(Roadmap).filter(Roadmap.id == roadmap_id, Roadmap.user_id == current.id).first()
    if not r:
        raise HTTPException(404, "Roadmap not found")
    db.delete(r); db.commit()
