"""TasteSurvey — 사용자 취향 분석 결과(1 row per user, upserted)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, func
from app.db.database import Base


class TasteSurvey(Base):
    __tablename__ = "surveys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    pace = Column(String(20), nullable=True)                  # 느긋하게 | 적당히 | 빡빡하게
    food_preference = Column(String(20), nullable=True)       # 로컬 맛집 | 유명 맛집 | 카페 | 가성비
    activity_preference = Column(String(20), nullable=True)   # 자연 | 쇼핑 | 문화 | 액티비티 | 사진
    budget_preference = Column(String(20), nullable=True)     # 절약 | 균형 | 프리미엄
    mobility_preference = Column(String(20), nullable=True)   # 도보 | 대중교통 | 택시 | 렌터카
    survey_data_json = Column(Text, nullable=True)             # 추가 답변 보관

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_surveys_user"),
    )
