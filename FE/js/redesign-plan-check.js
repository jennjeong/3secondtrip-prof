/* 3초 여행 — 일정 시간 검증 (화면과 무관한 순수 계산)
 *
 * 생성 직후·편집 뒤·예산 대안 적용 뒤에 모두 이 파일 하나로 검사한다.
 * 시각은 모두 여행지 현지 시각이다(오는 편 도착만 출발지 현지).
 *
 *  - checkDay / checkTrip : 문제 찾기.
 *      kind 'time' = 실제 시간 충돌(해결할 것)  ·  'info' = 확인할 정보  ·  'note' = 계산 기준 안내
 *      항목마다 code · di(날짜) · ai(장소 순서) · placeId 가 있어 그 장소로 바로 갈 수 있다.
 *  - repairTrip : 풀 수 있는 충돌을 시간 이동·빼기로 푼 결과와 변경 목록을 돌려준다.
 *      고정한 장소와 직접 고친 시각은 건드리지 않고 blocked 로 원인을 알려 준다.
 */
import { openState, hoursText } from './redesign-hours.js';
import { RIDE, rideMode, rideOf } from './redesign-ground.js';

export const CHECKIN_FROM = 15 * 60;      // 보통 체크인 가능 시간
export const TOLERANCE = 10;              // 이 정도 어긋남은 문제로 보지 않는다(분)
export const STATION_MIN = 25;            // 역·터미널 ↔ 시내(위치를 모를 때)
const DAY_END = 24 * 60 - 5;
const OPEN_CATS = new Set(['관광', '식사', '카페', '쇼핑', '액티비티']);
const DWELL_MIN = { 식사: 75, 카페: 60, 관광: 90, 쇼핑: 100, 액티비티: 120, 숙박: 30, 이동: 0 };

/* ── 시간·거리 ── */
export function timeToMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return 9 * 60;
  const [h, m] = hhmm.split(':').map(Number);
  return ((h | 0) * 60) + (m | 0);
}
export function minToTime(total) {
  const t = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
export function kmBetween(a, b) {
  const v = [a?.latitude, a?.longitude, b?.latitude, b?.longitude].map(x => (x === null || x === undefined || x === '') ? NaN : Number(x));
  if (!v.every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const s = Math.sin((v[2] - v[0]) * rad / 2) ** 2 + Math.cos(v[0] * rad) * Math.cos(v[2] * rad) * Math.sin((v[3] - v[1]) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}
/** 도시 안 이동 — 평균 18km/h, 우회 1.3배. 위치를 모르면 20분. */
export function travelMinutes(a, b) {
  const km = kmBetween(a, b);
  return km == null ? 20 : Math.max(5, Math.round((km * 1.3 / 18) * 60));
}
/** 공항 ↔ 시내 — 공항철도·도로 평균 50km/h + 타고 내리는 15분. 위치를 모르면 45분.
 *  역·터미널 ↔ 시내(기차·버스 일정) — 시내버스·택시 평균 30km/h + 나오는 10분. 위치를 모르면 25분. */
export function airportMinutes(a, b) {
  const km = kmBetween(a, b);
  if (rideMode(a) !== 'air' || rideMode(b) !== 'air') return km == null ? STATION_MIN : Math.max(10, Math.round(10 + (km * 1.3 / 30) * 60));
  return km == null ? 45 : Math.max(20, Math.round(15 + (km * 1.25 / 50) * 60));
}
export function dwellMinutes(cat) { return DWELL_MIN[cat] ?? 90; }
/** 머무는 시간 — 만들 때 정한 값(stayMin)이 있으면 그 값, 숙소는 짐 맡기기·출발 준비 15분. */
export function stayMinutes(a) {
  if (Number.isFinite(a?.stayMin) && a.stayMin > 0) return a.stayMin;
  return a?.category === '숙박' ? 15 : dwellMinutes(a?.category);
}

/* ── 도착·출발편(항공 · 기차 · 버스) ── */
export const isFlight = (a) => a?.category === '이동' && !!a.flightMeta;
export const isArrival = (a) => isFlight(a) && /도착/.test(a.name || '');
export const isDeparture = (a) => isFlight(a) && /출발/.test(a.name || '');
/** 예전 일정은 항공편 시각이 글자로만 들어 있다 — 그 글자에서 읽는다. */
export function flightTimes(a) {
  const fm = a?.flightMeta || {};
  const pick = (re) => { const m = re.exec(a?.address || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const depT = typeof fm.depTime === 'string' ? timeToMin(fm.depTime) : pick(/출발\s*(\d{1,2}):(\d{2})/);
  const arrT = typeof fm.arrTime === 'string' ? timeToMin(fm.arrTime) : pick(/도착\s*(\d{1,2}):(\d{2})/);
  const own = timeToMin(a?.time);
  return {
    dep: depT ?? own, arr: arrT ?? own,
    estimated: fm.timeSource ? fm.timeSource !== 'live' : /예상|예시/.test(a?.address || '') || fm.source !== 'serpapi',
    prevDayDeparture: fm.depDayOffset === -1 || /출발[^→]*\(전날\)/.test(a?.address || ''),
  };
}
/** 출입국이 있는 여행인지 — 예전 일정처럼 출발 나라를 모르면 한국 출발로 본다. */
export function isInternational(g) {
  const from = g?.originCountry || '대한민국';
  return !!g?.country && g.country !== from;
}
/** 착륙 → 입국 심사·수하물. 기차·버스는 내려서 나오는 10분 */
export const landingMinutes = (g) => (rideOf(g) !== 'air' ? 10 : isInternational(g) ? 50 : 20);
/** 출발 전 공항 도착 여유. 기차·버스는 역·터미널에 20분 전, 전철은 10분 전 */
export const beforeFlight = (g) => ({ train: 20, bus: 20, subway: 10 }[rideOf(g)] || (isInternational(g) ? 120 : 60));
/** ‘2시간’ · ‘20분’ */
export const beforeFlightText = (g) => (beforeFlight(g) >= 60 ? `${beforeFlight(g) / 60}시간` : `${beforeFlight(g)}분`);

/* ── 글 ── */
export function josa(word, withBatchim, without) {
  const w = String(word || '');
  const c = w.charCodeAt(w.length - 1);
  if (c >= 0xAC00 && c <= 0xD7A3) return w + (((c - 0xAC00) % 28) ? withBatchim : without);
  return w + without;
}
export function shortName(name) {
  const s = String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return s.length > 14 ? s.slice(0, 13) + '…' : s;
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const placeKey = (a) => (a.placeId && !String(a.placeId).startsWith('custom-')) ? a.placeId : norm(a.name);
const isStop = (a) => a.category !== '이동' && a.category !== '숙박';

/* ════════ 하루 점검 ════════ */
export function checkDay(g, di) {
  const day = g?.days?.[di];
  const acts = day?.activities || [];
  const items = acts.map(() => []);
  const list = [];
  const add = (kind, code, ai, badge, text, fix) => {
    if (badge && ai >= 0) items[ai].push({ kind, lvl: kind === 'time' ? 'warn' : 'check', code, text: badge });
    if (text) list.push({ kind, lvl: kind === 'time' ? 'warn' : 'check', code, di, ai: ai ?? null, placeId: ai >= 0 ? acts[ai]?.placeId ?? null : null, fix: fix || null, text });
  };

  // 0) 날짜 범위 — 공유·가져온 일정에서 여행 기간 밖 날짜가 섞이면 알린다
  const s0 = g?.startDate || g?.trip?.startDate, e0 = g?.endDate || g?.trip?.endDate;
  if (day?.date && s0 && e0 && (day.date < s0 || day.date > e0) && acts.length) add('time', 'outOfRange', 0, '여행 기간 밖', `${day.date}은 여행 기간(${s0} ~ ${e0}) 밖이에요. 날짜를 기간 안으로 옮기거나 이 날 일정을 지워 주세요.`, 'date');
  const mode = rideOf(g), air = mode === 'air', W = RIDE[mode];
  // 1) 착륙 → 입국 심사·수하물 → 시내 (기차·버스는 내려서 시내로)
  const arr = acts.findIndex(isArrival);
  const hit = new Set();
  if (arr >= 0) {
    const ft = flightTimes(acts[arr]);
    const est = ft.estimated ? ' (예상 도착 기준)' : '';
    if (ft.prevDayDeparture && di === 0) add('time', 'departPrevDay', arr, '전날 출발', '가는 편이 여행 시작 전날에 출발해요. 여행 날짜를 하루 앞당기거나 다른 ' + (air ? '항공편을' : josa(W.vehicle, '을', '를')) + ' 골라 주세요.');
    acts.forEach((a, ai) => {
      if (ai === arr || isFlight(a)) return;
      const t = timeToMin(a.time);
      const ready = ft.arr + landingMinutes(g) + (isStop(a) || a.category === '숙박' ? airportMinutes(acts[arr], a) : 0);
      if (t < ft.arr) {
        hit.add(ai);
        add('time', 'beforeArrival', ai, `${W.vehicle} 도착 전이에요`, `${a.time} ${shortName(a.name)} — ${W.vehicle} 도착(${minToTime(ft.arr)})${est} 전에 잡혀 있어요. ${minToTime(ready)} 이후로 옮겨 주세요.`, 'time');
      } else if (ai < firstAfter(acts, arr) && t + TOLERANCE < ready) {
        hit.add(ai);
        add('time', 'arrivalTight', ai, air ? '입국·이동 시간이 부족해요' : '이동 시간이 부족해요', air ? `${a.time} ${shortName(a.name)} — 착륙(${minToTime(ft.arr)}) 뒤 입국·시내 이동을 생각하면 ${minToTime(ready)} 이후가 좋아요.`
          : `${a.time} ${shortName(a.name)} — ${W.hub} 도착(${minToTime(ft.arr)}) 뒤 시내 이동을 생각하면 ${minToTime(ready)} 이후가 좋아요.`, 'time');
      }
    });
  }
  // 2) 순서·머무는 시간·이동 시간
  for (let ai = 1; ai < acts.length; ai++) {
    const prev = acts[ai - 1], cur = acts[ai];
    if (isFlight(prev) || isFlight(cur) || hit.has(ai)) continue;
    const pm = timeToMin(prev.time), cm = timeToMin(cur.time);
    if (cm < pm) { add('time', 'order', ai, '앞 일정보다 이른 시간', `${cur.time} ${shortName(cur.name)} — 앞 일정(${prev.time})보다 이른 시간이에요. ${minToTime(Math.min(pm + stayMinutes(prev), 23 * 60 + 59))} 이후로 옮겨 주세요.`, 'time'); continue; }
    const known = kmBetween(prev, cur) != null;
    const need = pm + stayMinutes(prev) + (known ? travelMinutes(prev, cur) : 0);   // 위치를 모르면 머무는 시간만 본다
    if (cm + TOLERANCE < need) {
      add('time', 'gap', ai, known ? '이동 시간이 부족해요' : '앞 일정과 겹쳐요',
        known ? `${shortName(prev.name)} → ${shortName(cur.name)} 사이 시간이 약 ${need - cm}분 모자라요. ${josa(shortName(cur.name), "을", "를")} ${minToTime(Math.min(need, 23 * 60 + 59))} 이후로 옮겨 주세요.`
              : `${shortName(prev.name)}에 머무는 시간과 ${shortName(cur.name)} 시작이 약 ${need - cm}분 겹쳐요. ${josa(shortName(cur.name), "을", "를")} ${minToTime(Math.min(need, 23 * 60 + 59))} 이후로 옮겨 주세요.`, 'time');
    }
  }
  // 3) 돌아가는 편
  const dep = acts.findIndex(isDeparture);
  if (dep >= 0) {
    const ft = flightTimes(acts[dep]);
    if (dep > 0 && !isFlight(acts[dep - 1])) {
      const prev = acts[dep - 1];
      const travel = airportMinutes(prev, acts[dep]);
      const leaveBy = ft.dep - beforeFlight(g) - travel;
      if (timeToMin(prev.time) + stayMinutes(prev) > leaveBy + TOLERANCE) {
        let last = -1;
        for (let k = dep - 1; k >= 0; k--) if (isStop(acts[k])) { last = k; break; }
        add('time', 'departureTight', dep, `${W.hub} 이동 시간 빠듯함`,
          `출발 ${beforeFlightText(g)} 전 ${W.hub} 도착 기준으로 ${shortName(prev.name)}에서 늦어도 ${minToTime(leaveBy)}에는 나서야 해요.`
          + (last >= 0 ? ` ${josa(shortName(acts[last].name), '을', '를')} 빼거나 앞당기면 여유가 생겨요.` : ''), last >= 0 ? 'time' : null);
        list[list.length - 1].dropAi = last >= 0 ? last : null;
      }
    }
    if (arr >= 0 && di === 0 && g.days.length === 1 && ft.dep - beforeFlight(g) < flightTimes(acts[arr]).arr + landingMinutes(g) + 120) {
      add('time', 'dayTrip', dep, '당일 왕복이 어려워요', '도착과 출발 사이에 머물 시간이 2시간도 되지 않아요. 하루 묵거나 다른 ' + (air ? '항공편을' : '시간의 ' + josa(W.vehicle, '을', '를')) + ' 골라 주세요.');
    }
  }
  // 4) 같은 장소를 두 번
  const seen = new Map();
  (g?.days || []).forEach((d, dj) => (d.activities || []).forEach(a => {
    if (!isStop(a) || a.sample) return;
    const k = placeKey(a); if (!seen.has(k)) seen.set(k, []); seen.get(k).push(dj);
  }));
  let dup = -1;
  acts.forEach((a, ai) => {
    if (!isStop(a) || a.sample) return;
    const ds = seen.get(placeKey(a)) || [];
    if (ds.length > 1) { add('info', 'duplicate', ai, `중복 방문 (${[...new Set(ds)].map(x => x + 1).join('·')}일차)`); if (dup < 0) dup = ai; }
  });
  if (dup >= 0) add('info', 'duplicate', dup, null, '같은 장소가 두 번 이상 들어 있어요. 한 곳을 바꿔 보세요.');
  // 5) 자정 넘김 · 늦은 시간
  acts.forEach((a, ai) => {
    if (a.pastMidnight && !isFlight(a)) add('time', 'midnight', ai, '자정을 넘겨요', `${shortName(a.name)} — 앞 일정을 지키면 자정을 넘겨 다음 날이 돼요. 빼거나 다른 날로 옮겨 주세요.`, 'drop');
    else if (timeToMin(a.time) >= 23 * 60 && isStop(a)) add('info', 'late', ai, '늦은 시간 — 영업 여부 확인');
  });
  // 6) 영업시간 — 닫혀 있으면 충돌, 모르면 확인할 정보
  const date = day?.date;
  const unknown = [];
  acts.forEach((a, ai) => {
    if (!OPEN_CATS.has(a.category)) return;
    const st = openState(a.openingPeriods, date, a.time);
    if (st === 'closedDay') add('time', 'closedDay', ai, '이날 휴무', `${shortName(a.name)} — 이날은 문을 닫아요(장소 정보 기준). 빼거나 다른 장소로 바꿔 주세요.`, 'drop');
    else if (st === 'closedNow') add('time', 'closedNow', ai, `영업시간 밖 (${hoursText(a.openingPeriods, date)})`, `${a.time} ${shortName(a.name)} — 이 시각엔 닫혀 있어요. 영업시간 ${hoursText(a.openingPeriods, date)}.`, 'time');
    else if (st === 'open' && openState(a.openingPeriods, date, minToTime(timeToMin(a.time) + 30)) !== 'open' && timeToMin(a.time) + 30 < 24 * 60) add('info', 'closingSoon', ai, '곧 문을 닫아요', `${a.time} ${shortName(a.name)} — 도착하고 30분 안에 문을 닫아요. 영업시간 ${hoursText(a.openingPeriods, date)}.`);
    else if (st === 'unknown') { unknown.push(ai); add('info', 'hoursUnknown', ai, '영업시간·휴무 확인 필요'); }
  });
  if (unknown.length) add('info', 'hoursUnknown', unknown[0], null, `${unknown.length}곳은 영업시간 정보가 없어요(문을 닫았다는 뜻은 아니에요). 가기 전에 확인해 주세요.`);
  // 7) 체크인 정책
  acts.forEach((a, ai) => {
    if (a.category === '숙박' && /체크인/.test(a.name || '') && timeToMin(a.time) < CHECKIN_FROM) {
      add('info', 'checkin', ai, '짐 맡기기 확인 필요', `체크인은 보통 15시부터예요. ${a.time}에는 짐만 맡길 수 있는지 숙소에 확인해 주세요.`);
    }
  });
  // 8) 계단 피하기·휠체어
  if ((g?.needs || []).includes('stepFree')) {
    const un = [];
    acts.forEach((a, ai) => {
      if (!OPEN_CATS.has(a.category)) return;
      if (a.stepFree === false) add('info', 'access', ai, '휠체어 출입구 없음(장소 정보 기준)', `${shortName(a.name)} — 장소 정보에 휠체어로 들어갈 수 있는 출입구가 없다고 나와요. 다른 장소로 바꿔 주세요.`, 'drop');
      else if (a.stepFree == null) { un.push(ai); add('info', 'access', ai, '접근성 확인 필요'); }
    });
    if (un.length) add('info', 'access', un[0], null, `${un.length}곳은 출입구 접근성 정보가 없어요. 가기 전에 확인해 주세요.`);
  }
  // 9) 계산 기준 — 할 일이 아니라서 건수에 세지 않는다
  if (acts.some(a => isStop(a) && kmBetween(a, a) == null)) {
    add('note', 'assume', null, null, '위치를 모르는 장소는 이동 시간을 20분으로 가정했어요. 이동 시간은 직선거리 기준 추정이에요.');
  }
  return { items, list };
}
/** 착륙 뒤 첫 이동을 검사할 범위 — 도착편 바로 다음 장소까지만(그 뒤는 앞 장소 기준으로 본다). */
function firstAfter(acts, arr) {
  for (let k = arr + 1; k < acts.length; k++) if (!isFlight(acts[k])) return k + 1;
  return acts.length;
}

export function checkTrip(g) {
  const days = (g?.days || []).map((_, di) => checkDay(g, di));
  const all = days.flatMap(d => d.list);
  const conflicts = all.filter(x => x.kind === 'time');
  return { days, conflicts, info: all.filter(x => x.kind === 'info'), ok: !conflicts.length };
}

/* ════════ 충돌 풀기 ════════ */
const isLocked = (a) => !!a.pinned || !!a.timeEdited || (!!a.edited && a.timeEdited !== false);
const up5 = (m) => Math.ceil(m / 5) * 5;
const down5 = (m) => Math.floor(m / 5) * 5;
const reasons = (W, air) => ({
  beforeArrival: `${W.vehicle} 도착 전이라서`, arrivalTight: `${air ? '입국·공항' : W.hub} 이동 시간이 모자라서`, order: '앞 일정보다 일러서', gap: '이동 시간이 모자라서',
  departureTight: `${W.hub}에 갈 시간이 모자라서`, midnight: '자정을 넘겨서', closedNow: '그 시각엔 닫혀 있어서', closedDay: '이날 휴무라서',
});

/** 하루를 고친 사본. 바꿀 것이 없으면 changes 가 비어 있다. allowDrop 이 거짓이면 빼지 않고 blocked 로 알린다. */
export function repairDay(g, di, { allowDrop = true } = {}) {
  const src = g.days[di];
  const before = checkDay(g, di);
  const work = { ...src, activities: src.activities.map((a, i) => ({ ...a, _i: i })) };
  const changes = [], blocked = [];
  const conflicts = before.list.filter(x => x.kind === 'time');
  const done = () => {
    const activities = work.activities.map(({ _i, ...a }) => a);
    return { day: { ...work, activities }, changes, blocked };
  };
  if (!conflicts.length) return done();
  const mode = rideOf(g), REASON = reasons(RIDE[mode], mode === 'air');
  const reasonOf = (i, later) => REASON[conflicts.find(c => c.ai === i)?.code] || (later === undefined ? REASON[conflicts[0].code] || '' : later ? '앞 일정이 밀려서' : '돌아가는 시간에 맞추느라');

  // 항공 도착은 맨 앞, 출발은 맨 뒤
  let acts = work.activities;
  const a0 = acts.findIndex(isArrival); if (a0 > 0) acts.unshift(acts.splice(a0, 1)[0]);
  const d0 = acts.findIndex(isDeparture); if (d0 >= 0 && d0 < acts.length - 1) acts.push(acts.splice(d0, 1)[0]);
  // 앞 일정보다 이른 장소는 시각 순서로 다시 세운다(항공편은 양 끝에 고정, 숙소 복귀는 맨 뒤 쪽)
  const head = acts.length && isArrival(acts[0]) ? [acts[0]] : [];
  const tail = acts.length && isDeparture(acts[acts.length - 1]) ? [acts[acts.length - 1]] : [];
  const mid = acts.slice(head.length, acts.length - tail.length);
  if (mid.some((a, i) => i && timeToMin(a.time) < timeToMin(mid[i - 1].time))) {
    const hotel0 = head.length && mid[0]?.category === '숙박' ? [mid[0]] : [];   // 짐 맡기기는 착륙 뒤 첫 순서 그대로
    const rest = mid.slice(hotel0.length).map((a, i) => ({ a, i })).sort((x, y) => timeToMin(x.a.time) - timeToMin(y.a.time) || x.i - y.i).map(x => x.a);
    acts = work.activities = [...head, ...hotel0, ...rest, ...tail];
  }

  // 도착 카드의 시각은 출발이 아니라 도착 시각으로
  if (acts.length && isArrival(acts[0]) && timeToMin(acts[0].time) !== flightTimes(acts[0]).arr) {
    const f = acts[0], to = minToTime(flightTimes(f).arr);
    changes.push({ type: 'move', di, ai: f._i, placeId: f.placeId ?? null, name: f.name, from: f.time, to, reason: `${RIDE[mode].vehicle} 도착 시각에 맞추느라` });
    f.time = to;
  }
  const n = () => acts.length;
  const travel = (x, y) => (isFlight(x) || isFlight(y)) ? airportMinutes(x, y) : travelMinutes(x, y);
  // 앞에서부터 가장 이른 시각
  const earliest = () => {
    const E = [];
    acts.forEach((a, i) => {
      const own = timeToMin(a.time);
      if (isFlight(a)) { E[i] = isArrival(a) ? flightTimes(a).arr : flightTimes(a).dep; return; }
      if (i === 0) { E[i] = own; return; }
      const p = acts[i - 1];
      const ready = isArrival(p) ? E[i - 1] + landingMinutes(g) + travel(p, a) : E[i - 1] + stayMinutes(p) + travel(p, a);
      E[i] = isLocked(a) ? Math.max(own, ready > own + TOLERANCE ? ready : own) : ready;
    });
    return E;
  };
  // 뒤에서부터 가장 늦은 시각
  const latest = () => {
    const L = [];
    for (let i = n() - 1; i >= 0; i--) {
      const a = acts[i];
      if (isDeparture(a)) { L[i] = flightTimes(a).dep; continue; }
      if (isArrival(a)) { L[i] = flightTimes(a).arr; continue; }
      const nx = acts[i + 1];
      let lim = nx ? (isDeparture(nx) ? L[i + 1] - beforeFlight(g) : L[i + 1]) - travel(a, nx) - stayMinutes(a) : DAY_END;
      if (isLocked(a)) lim = Math.min(lim, timeToMin(a.time));
      L[i] = lim;
    }
    return L;
  };

  for (let guard = 0; guard < 40; guard++) {
    const E = earliest(), L = latest();
    const bad = acts.findIndex((a, i) => !isFlight(a) && E[i] > L[i] + TOLERANCE);
    if (bad < 0) break;
    // 빼도 되는 장소 — 고정 시각(항공편·고정 장소) 앞에서 가장 늦은 장소(예시 장소 먼저)
    let anchor = acts.findIndex((a, i) => i >= bad && (isLocked(a) || isDeparture(a)));
    if (anchor < 0) anchor = n() - 1;
    const pool = acts.map((a, i) => ({ a, i })).filter(x => x.i <= anchor && isStop(x.a) && !isLocked(x.a) && !x.a.mustVisit);
    const victim = pool.filter(x => x.a.sample).pop() || pool[pool.length - 1];
    if (!victim || !allowDrop) {
      const b = acts[bad];
      const why = isLocked(b) ? (b.pinned ? '고정한 장소' : '직접 고친 시각') : '앞뒤 일정';
      blocked.push({ di, ai: b._i, placeId: b.placeId ?? null, name: b.name, time: b.time, earliest: minToTime(up5(E[bad])),
        reason: `${josa(why, '이', '가')} 있어 자동으로 옮기지 않았어요. ${minToTime(up5(E[bad]))} 이후로 바꾸거나 빼 주세요.` });
      break;
    }
    changes.push({ type: 'drop', di, ai: victim.a._i, placeId: victim.a.placeId ?? null, name: victim.a.name, from: victim.a.time, to: null, reason: reasonOf(victim.a._i) });
    acts.splice(victim.i, 1);
  }

  // 시각 정하기 — 원래 시각을 되도록 지키고, 필요한 만큼만 옮긴다
  const E = earliest(), L = latest();
  let prev = null, prevT = 0;
  acts.forEach((a, i) => {
    if (isFlight(a)) { prev = a; prevT = isArrival(a) ? E[i] : L[i]; return; }
    const own = timeToMin(a.time);
    if (isLocked(a)) {
      const need = prev ? (isArrival(prev) ? prevT + landingMinutes(g) + travel(prev, a) : prevT + stayMinutes(prev) + travel(prev, a)) : own;
      if (need > own + TOLERANCE && !blocked.some(b => b.ai === a._i)) {
        blocked.push({ di, ai: a._i, placeId: a.placeId ?? null, name: a.name, time: a.time, earliest: minToTime(up5(need)),
          reason: `${a.pinned ? '고정한 장소라' : '직접 고친 시각이라'} 자동으로 옮기지 않았어요. 앞 일정을 생각하면 ${minToTime(up5(need))} 이후가 맞아요.` });
      }
      prev = a; prevT = Math.max(own, Math.min(need, own)); return;
    }
    const need = !prev ? E[i] : isArrival(prev) ? prevT + landingMinutes(g) + travel(prev, a) : prevT + stayMinutes(prev) + travel(prev, a);
    let t = own + TOLERANCE >= need ? own : up5(need);
    if (t > L[i] + TOLERANCE) t = Math.max(up5(need) <= L[i] ? up5(need) : need, down5(L[i]));
    // 닫혀 있으면 그날 여는 시각으로 — 뒤 일정에 닿지 않을 때만
    if (OPEN_CATS.has(a.category) && openState(a.openingPeriods, src.date, minToTime(t)) === 'closedNow') {
      for (let x = up5(Math.max(need, t - 180)); x <= Math.min(L[i], t + 240); x += 5) {
        if (openState(a.openingPeriods, src.date, minToTime(x)) === 'open' && x + 30 < L[i] + stayMinutes(a)) { t = x; break; }
      }
    }
    t = Math.round(t);
    if (t >= 24 * 60) { a.pastMidnight = true; t = DAY_END; } else delete a.pastMidnight;
    if (minToTime(t) !== a.time) {
      changes.push({ type: 'move', di, ai: a._i, placeId: a.placeId ?? null, name: a.name, from: a.time, to: minToTime(t), reason: reasonOf(a._i, t > own) });
      a.time = minToTime(t);
    }
    prev = a; prevT = t;
  });
  // 고칠 수 없는 휴무·영업시간은 다른 장소가 필요하다고 알린다
  const after = checkDay({ ...g, days: g.days.map((d, k) => (k === di ? { ...work, activities: acts } : d)) }, di);
  after.list.filter(x => x.kind === 'time' && (x.code === 'closedDay' || x.code === 'closedNow')).forEach(x => {
    const a = acts[x.ai];
    if (a && !blocked.some(b => b.ai === a._i)) blocked.push({ di, ai: a._i, placeId: a.placeId ?? null, name: a.name, time: a.time, reason: '영업시간에 맞는 시각이 없어요. 다른 장소로 바꿔 주세요.' });
  });
  work.activities = acts;
  return done();
}

/** 여행 전체. 원본은 바꾸지 않는다. */
export function repairTrip(g, opts) {
  let cur = { ...g, days: g.days.map(d => d) };
  const changes = [], blocked = [];
  g.days.forEach((_, di) => {
    const r = repairDay(cur, di, opts);
    changes.push(...r.changes); blocked.push(...r.blocked);
    cur = { ...cur, days: cur.days.map((d, k) => (k === di ? r.day : d)) };
  });
  return { days: cur.days, changes, blocked, before: checkTrip(g), after: checkTrip(cur) };
}

/** 하루 시간표를 순서대로 다시 계산한다(끌어서 옮긴 뒤). 항공 도착은 맨 앞, 출발은 맨 뒤. */
export function recomputeDay(g, day) {
  const arr = day?.activities;
  if (!arr?.length) return;
  const ai = arr.findIndex(isArrival); if (ai > 0) arr.unshift(arr.splice(ai, 1)[0]);
  const di = arr.findIndex(isDeparture); if (di >= 0 && di < arr.length - 1) arr.push(arr.splice(di, 1)[0]);
  let prev = null;
  arr.forEach(a => {
    if (isFlight(a)) { prev = a; return; }
    const own = timeToMin(a.time);
    let need = own;
    if (prev) need = isArrival(prev) ? flightTimes(prev).arr + landingMinutes(g) + airportMinutes(prev, a)
      : timeToMin(prev.time) + stayMinutes(prev) + (isFlight(prev) ? airportMinutes(prev, a) : travelMinutes(prev, a));
    const t = up5(prev ? need : own);
    if (t >= 24 * 60) a.pastMidnight = true; else delete a.pastMidnight;
    a.time = minToTime(t);
    prev = a;
  });
}
