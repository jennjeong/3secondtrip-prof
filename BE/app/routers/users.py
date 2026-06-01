"""Users router — local email/password signup + duplicate checks + profile."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.password import verify_password
from app.core.security import create_access_token
from app.db.database import get_db
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.user_schema import (
    PasswordSignupRequest, PasswordLoginRequest,
    SignupResponse, CheckDuplicateResponse, UserPublic, UserUpdateRequest,
)
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/check-nickname", response_model=CheckDuplicateResponse)
def check_nickname(nickname: str = Query(min_length=2, max_length=30), db: Session = Depends(get_db)):
    return CheckDuplicateResponse(available=user_service.is_nickname_available(db, nickname))


@router.get("/check-email", response_model=CheckDuplicateResponse)
def check_email(email: str = Query(min_length=3, max_length=255), db: Session = Depends(get_db)):
    return CheckDuplicateResponse(available=user_service.is_email_available(db, email))


@router.post("/signup", response_model=SignupResponse)
def signup(payload: PasswordSignupRequest, db: Session = Depends(get_db)):
    user = user_service.create_password_user(
        db,
        email=payload.email, password=payload.password, nickname=payload.nickname,
        name=payload.name, phone=payload.phone, birth_date=payload.birth_date,
    )
    token = create_access_token(user_id=user.id)
    return SignupResponse(user=UserPublic.model_validate(user), access_token=token)


@router.post("/login", response_model=SignupResponse)
def login(payload: PasswordLoginRequest, db: Session = Depends(get_db)):
    en = user_service.normalize_email(payload.email)
    user = db.query(User).filter(User.email_normalized == en, User.provider == "local").first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    token = create_access_token(user_id=user.id)
    return SignupResponse(user=UserPublic.model_validate(user), access_token=token)


@router.get("/me", response_model=UserPublic)
def get_me(current: User = Depends(get_current_user)):
    return UserPublic.model_validate(current)


@router.patch("/me", response_model=UserPublic)
def update_me(payload: UserUpdateRequest, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = user_service.update_profile(db, current, **payload.model_dump(exclude_unset=True))
    return UserPublic.model_validate(user)


@router.post("/logout")
def logout(_: User = Depends(get_current_user)):
    """Stateless JWT — frontend just drops the token. Echo for symmetry."""
    return {"ok": True}
