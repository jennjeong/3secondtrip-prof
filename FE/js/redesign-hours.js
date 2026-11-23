/* 3초 여행 — 영업시간 판단
 *
 * 장소 검색이 돌려주는 주간 영업시간 [{d, o, c}] (d=요일 0=일요일, o/c=분)을 쓴다.
 *  - c < o 이면 다음 날 새벽에 닫는다(예: 18:00~02:00).
 *  - 데이터가 없으면 'unknown' — 문을 닫았다는 뜻이 아니다.
 * 결과: 'open' | 'closedDay'(그날 영업 안 함) | 'closedNow'(그 시각엔 닫음) | 'unknown'
 */

function _weekday(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function _min(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

export function openState(periods, isoDate, hhmm) {
  if (!Array.isArray(periods) || !periods.length) return 'unknown';
  const wd = _weekday(isoDate);
  const t = _min(hhmm);
  if (wd == null) return 'unknown';
  const prev = (wd + 6) % 7;
  const today = periods.filter(p => p.d === wd);
  // 전날 밤에 열어 오늘 새벽에 닫는 경우
  const overnight = periods.filter(p => p.d === prev && p.c < p.o);
  if (t == null) return today.length ? 'open' : 'closedDay';
  if (overnight.some(p => t < p.c)) return 'open';
  if (today.some(p => (p.c > p.o ? t >= p.o && t < p.c : t >= p.o))) return 'open';
  if (!today.length) return 'closedDay';
  return 'closedNow';
}

/** 그 요일의 영업시간 한 줄 — '10:00~18:00', '휴무', '' (모름) */
export function hoursText(periods, isoDate) {
  if (!Array.isArray(periods) || !periods.length) return '';
  const wd = _weekday(isoDate);
  const today = periods.filter(p => p.d === wd);
  if (!today.length) return '휴무';
  const f = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return today.map(p => (p.o === 0 && p.c === 1440) ? '24시간' : `${f(p.o)}~${p.c === 1440 ? '24:00' : f(p.c)}`).join(', ');
}
