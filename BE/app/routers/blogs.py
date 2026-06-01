"""Blogs router — public read for visibility=public, login-required write."""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.blog import Blog
from app.models.user import User
from app.routers.dependencies import get_current_user, get_current_user_optional
from app.schemas.blog_schema import BlogCreate, BlogUpdate, BlogPublic

router = APIRouter(prefix="/blogs", tags=["blogs"])


def _to_public(b: Blog) -> BlogPublic:
    return BlogPublic(
        id=b.id, user_id=b.user_id, title=b.title,
        tags=json.loads(b.tags_json or "[]"),
        body=b.body, visibility=b.visibility, is_draft=b.is_draft,
        created_at=b.created_at, updated_at=b.updated_at,
    )


@router.post("", response_model=BlogPublic, status_code=201)
def create_blog(payload: BlogCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    b = Blog(
        user_id=current.id, title=payload.title,
        tags_json=json.dumps(payload.tags or [], ensure_ascii=False),
        body=payload.body, visibility=payload.visibility, is_draft=payload.is_draft,
    )
    db.add(b); db.commit(); db.refresh(b)
    return _to_public(b)


@router.get("", response_model=list[BlogPublic])
def list_blogs(
    mine: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: Optional[User] = Depends(get_current_user_optional),
):
    if mine:
        if not current:
            raise HTTPException(401, "Login required")
        rows = db.query(Blog).filter(Blog.user_id == current.id).order_by(Blog.created_at.desc()).limit(limit).all()
    else:
        rows = (db.query(Blog)
                  .filter(Blog.visibility == "public", Blog.is_draft == False)  # noqa
                  .order_by(Blog.created_at.desc()).limit(limit).all())
    return [_to_public(b) for b in rows]


@router.get("/{blog_id}", response_model=BlogPublic)
def get_blog(blog_id: int, db: Session = Depends(get_db), current: Optional[User] = Depends(get_current_user_optional)):
    b = db.query(Blog).filter(Blog.id == blog_id).first()
    if not b:
        raise HTTPException(404, "Blog not found")
    if b.visibility == "private" and (not current or current.id != b.user_id):
        raise HTTPException(404, "Blog not found")
    return _to_public(b)


@router.patch("/{blog_id}", response_model=BlogPublic)
def update_blog(blog_id: int, payload: BlogUpdate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    b = db.query(Blog).filter(Blog.id == blog_id, Blog.user_id == current.id).first()
    if not b:
        raise HTTPException(404, "Blog not found")
    data = payload.model_dump(exclude_unset=True)
    if "tags" in data and data["tags"] is not None:
        b.tags_json = json.dumps(data.pop("tags"), ensure_ascii=False)
    for k, v in data.items():
        setattr(b, k, v)
    db.commit(); db.refresh(b)
    return _to_public(b)


@router.delete("/{blog_id}", status_code=204)
def delete_blog(blog_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    b = db.query(Blog).filter(Blog.id == blog_id, Blog.user_id == current.id).first()
    if not b:
        raise HTTPException(404, "Blog not found")
    db.delete(b); db.commit()
