"""LocalCourse — 그 도시에 사는(살았던) 사람이 직접 쓴 코스.

거주 여부는 작성자가 스스로 밝힌 것이고 확인하지 않는다 — 화면에도 그렇게 적는다.
누구나 가입할 수 있으므로 운영자가 확인한 글(approved)만 공개한다.  기존 표는 건드리지 않고 새 표만 쓴다.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from app.db.database import Base


class LocalCourse(Base):
    __tablename__ = "local_courses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    city = Column(String(60), nullable=False, index=True)
    country = Column(String(60), nullable=False)
    area = Column(String(30), nullable=True)                           # 동네 이름(선택)
    lived = Column(String(20), nullable=False)                         # 살아온 기간 — 작성자가 고른 값
    title = Column(String(60), nullable=False)
    concept = Column(String(20), nullable=False)
    note = Column(String(400), nullable=False)
    plan_json = Column(Text, nullable=False)                           # [[{time,name,cat,tip}]]

    status = Column(String(12), nullable=False, default="pending", index=True)   # pending | approved | rejected
    review_note = Column(String(200), nullable=True)                   # 돌려보낸 까닭(작성자에게만 보임)
    reports = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
