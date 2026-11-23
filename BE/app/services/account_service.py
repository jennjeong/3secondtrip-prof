"""계정 삭제 — 사용자와 그 사람이 만든 데이터를 지운다.

DB 의 ON DELETE CASCADE 에만 기대지 않고(SQLite 는 기본으로 꺼져 있다) 직접 지운다.
  - 지움: 여행·여행 장소·일정·예약 후보·후기·블로그·취향 분석·공개 코스·비밀번호 재설정 기록
  - 남김(이름 없이): 피드백 — 서비스 개선 기록이라 작성자 연결만 끊는다
"""
from sqlalchemy.orm import Session

from app.models.blog import Blog
from app.models.booking import Booking
from app.models.feedback import Feedback
from app.models.password_reset import PasswordReset
from app.models.review import Review
from app.models.roadmap import Roadmap
from app.models.schedule import Schedule
from app.models.survey import TasteSurvey
from app.models.trip import Trip
from app.models.trip_place import TripPlace
from app.models.user import User

CONFIRM_TEXT = "계정 삭제"


def delete_account(db: Session, user: User) -> dict:
    uid = user.id
    counts: dict[str, int] = {}
    trip_ids = [t.id for t in db.query(Trip.id).filter(Trip.user_id == uid).all()]
    if trip_ids:
        counts["trip_places"] = db.query(TripPlace).filter(TripPlace.trip_id.in_(trip_ids)).delete(synchronize_session=False)
    for name, model in (("trips", Trip), ("schedules", Schedule), ("bookings", Booking), ("reviews", Review),
                        ("blogs", Blog), ("surveys", TasteSurvey), ("roadmaps", Roadmap), ("password_resets", PasswordReset)):
        counts[name] = db.query(model).filter(model.user_id == uid).delete(synchronize_session=False)
    counts["feedback_anonymized"] = db.query(Feedback).filter(Feedback.user_id == uid).update(
        {Feedback.user_id: None}, synchronize_session=False)
    db.delete(user)
    db.commit()
    return counts
