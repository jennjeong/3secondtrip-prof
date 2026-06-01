#!/usr/bin/env python3
"""사용자에게 관리자 권한 부여 (CLI).

사용법:
    cd BE
    source .venv/bin/activate
    python make_admin.py <email-or-id> [--off]

예시:
    python make_admin.py jeongej977@gmail.com
    python make_admin.py 1
    python make_admin.py jeongej977@gmail.com --off    # 권한 해제
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.db.init_db import init_db
from app.models.user import User


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    ident = sys.argv[1]
    turn_on = "--off" not in sys.argv

    init_db()                # ensures is_admin column exists
    db: Session = SessionLocal()
    try:
        if ident.isdigit():
            user = db.query(User).filter(User.id == int(ident)).first()
        else:
            user = (db.query(User)
                    .filter((User.email == ident) | (User.email_normalized == ident.lower()))
                    .first())
        if not user:
            print(f"❌  사용자를 찾을 수 없어요: {ident}")
            print("   가입자 목록:")
            for u in db.query(User).all():
                print(f"     [{u.id}] {u.provider} · {u.email or '(no email)'} · {u.nickname or '-'}")
            sys.exit(2)

        user.is_admin = turn_on
        user.is_active = True
        db.commit()
        verb = "✅  관리자 권한 부여" if turn_on else "🚫  관리자 권한 해제"
        print(f"{verb} 완료: [{user.id}] {user.email or user.nickname or user.provider}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
