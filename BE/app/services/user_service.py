"""User service — duplicate checks, password user creation, oauth upsert."""
from datetime import date
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.password import hash_password
from app.models.user import User


def normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    digits = "".join(c for c in phone if c.isdigit() or c == "+")
    return digits or None


def is_email_available(db: Session, email: str) -> bool:
    en = normalize_email(email)
    if not en:
        return False
    return db.query(User).filter(User.email_normalized == en).first() is None


def is_nickname_available(db: Session, nickname: str) -> bool:
    if not nickname:
        return False
    return db.query(User).filter(User.nickname == nickname.strip()).first() is None


def create_password_user(db: Session, *, email: str, password: str, nickname: str,
                         name: Optional[str] = None, phone: Optional[str] = None,
                         birth_date: Optional[date] = None) -> User:
    en = normalize_email(email)
    if not is_email_available(db, en):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 가입된 이메일입니다.")
    if not is_nickname_available(db, nickname):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 닉네임입니다.")
    user = User(
        provider="local",
        provider_user_id=en,
        email=email.strip(),
        email_normalized=en,
        nickname=nickname.strip(),
        password_hash=hash_password(password),
        name=(name or None),
        phone=normalize_phone(phone),
        birth_date=birth_date,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_or_create_oauth_user(db: Session, *, provider: str, provider_user_id: str,
                             email: Optional[str] = None,
                             nickname: Optional[str] = None,
                             profile_image_url: Optional[str] = None,
                             name: Optional[str] = None,
                             phone: Optional[str] = None,
                             birth_date=None,
                             **extra) -> User:
    """Find-or-create the OAuth user, also persisting PII when the provider
    exposes it (Kakao/Naver give name/phone/birthday under user consent;
    Google/Apple give name only).  All PII columns are Fernet-encrypted
    at-rest via the EncryptedString/EncryptedDate column types.

    Existing users have their previously-empty PII back-filled on every
    login — so the moment a user grants extra consent, we capture the
    new data.
    """
    user = db.query(User).filter(User.provider == provider,
                                 User.provider_user_id == provider_user_id).first()

    if user:
        # Refresh / back-fill any field that was empty before
        changed = False
        if email and not user.email:
            user.email = email.strip()
            user.email_normalized = normalize_email(email); changed = True
        if nickname and not user.nickname:
            user.nickname = nickname.strip(); changed = True
        if profile_image_url and not user.profile_image_url:
            user.profile_image_url = profile_image_url; changed = True
        if name and not user.name:
            user.name = name.strip(); changed = True
        if phone and not user.phone:
            user.phone = normalize_phone(phone); changed = True
        if birth_date and not user.birth_date:
            user.birth_date = birth_date; changed = True
        if changed:
            try:
                db.commit()
            except Exception:
                db.rollback()
        db.refresh(user)
        return user

    # Brand-new user — persist everything the provider gave us.
    user = User(
        provider=provider,
        provider_user_id=provider_user_id,
        email=(email.strip() if email else None),
        email_normalized=normalize_email(email),
        nickname=(nickname.strip() if nickname else None),
        profile_image_url=profile_image_url,
        name=(name.strip() if name else None),
        phone=normalize_phone(phone),
        birth_date=birth_date,
    )
    db.add(user)
    try:
        db.commit()
    except Exception:
        # Nickname / email collision — drop conflicting fields and retry.
        db.rollback()
        user.nickname = None
        user.email_normalized = None
        db.add(user)
        db.commit()
    db.refresh(user)
    return user



def update_profile(db: Session, user: User, **patch) -> User:
    for k, v in patch.items():
        if v is None:
            continue
        if k == "phone":
            v = normalize_phone(v)
        if k == "nickname" and v != user.nickname:
            if not is_nickname_available(db, v):
                raise HTTPException(status_code=409, detail="이미 사용 중인 닉네임입니다.")
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user
