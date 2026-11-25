/* 3초 여행 — 여행 비용 계산 기준 (화면과 무관한 순수 계산)
 *
 * 일정 합계·예산 대안·적용 뒤 비교가 모두 이 파일의 같은 항목과 같은 반올림(원 단위)을 쓴다.
 *  항목: 항공 또는 기차·버스(왕복 전체 인원, 항목 키는 모두 flight) · 숙소(1박 × 객실 × 박수) · 식비 · 입장·체험 · 쇼핑 · 현지 교통
 *  상태: live(실시간 조회) · estimate(추정) · excluded(따로 계산) · none(해당 없음)
 *  모르는 비용은 0원이 아니라 unknown 으로 세고 합계에 넣지 않는다.
 */
import { RIDE, rideOf } from './redesign-ground.js';

export const COMPONENTS = [
  ['flight', '항공'], ['hotel', '숙소'], ['food', '식비'], ['entry', '입장·체험'], ['shopping', '쇼핑'], ['transport', '현지 교통'],
];
const LABEL = Object.fromEntries(COMPONENTS);
/** 항목 이름 — 오가는 교통은 이동 수단에 따라 ‘항공 · 기차 · 버스 · 전철’ */
export const componentLabel = (k, ride = 'air') => (k === 'flight' ? (RIDE[ride] || RIDE.air).label : LABEL[k]);

export function costUnknown(a) {
  return !!a && (a.cost === null || a.cost === undefined) && a.category !== '이동' && a.category !== '숙박';
}
const CAT = (a) => a.costCategory || a.category;      // 예시 장소는 보이는 종류와 비용 기준이 다를 수 있다
const won = (v) => Math.round(Number(v) || 0);

/** 일정 전체의 항목별 비용. */
export function costBreakdown(g) {
  const bd = { flight: 0, hotel: 0, food: 0, entry: 0, shopping: 0, transport: 0, nights: 0, unknown: 0, edited: 0 };
  (g?.days || []).forEach(d => {
    bd.transport += won(d.localTransport);
    (d.activities || []).forEach(a => {
      if (a.excludedFromBudget) return;
      if (costUnknown(a)) { bd.unknown += 1; return; }
      const c = won(a.cost);
      if (a.costEdited) bd.edited += 1;
      if (a.category === '이동' && a.flightMeta) bd.flight += c;        // 가는 편 + 오는 편 = 왕복
      else if (a.category === '숙박') { bd.hotel += c; if (c > 0) bd.nights += 1; }   // 1박 요금은 '복귀(1박)' 한 곳에만
      else if (CAT(a) === '식사' || CAT(a) === '카페') bd.food += c;
      else if (CAT(a) === '쇼핑') bd.shopping += c;
      else bd.entry += c;
    });
  });
  bd.hotelPerNight = bd.nights ? Math.round(bd.hotel / bd.nights) : 0;
  bd.total = COMPONENTS.reduce((n, [k]) => n + bd[k], 0);
  return bd;
}

/** 무엇이 들어 있고 빠졌는지 — 금액 옆에 범위를 적을 때 쓴다. */
export function costScope(g, bd = costBreakdown(g)) {
  const bp = g?.budgetPlan || {};
  const src = g?.sources || {};
  const flightActs = (g?.days || []).flatMap(d => d.activities || []).filter(a => a.category === '이동' && a.flightMeta);
  const nights = Math.max(0, (g?.days?.length || 1) - 1);
  const status = {
    flight: bp.localTrip || (!flightActs.length && !bd.flight) ? 'none'
      : (bp.includeFlight === false || src.flight === 'excluded' || flightActs.every(a => a.flightMeta?.source === 'excluded')) && !bd.flight ? 'excluded'
      : (src.flight || g?.flightPriceSource) === 'serpapi' ? 'live' : 'estimate',
    hotel: !nights ? 'none' : (bp.includeHotel === false || src.hotel === 'excluded') && !bd.hotel ? 'excluded'
      : (src.hotel || g?.hotelPriceSource) === 'serpapi' ? 'live' : 'estimate',
    food: 'estimate', entry: 'estimate', shopping: 'estimate', transport: 'estimate',
  };
  const excluded = COMPONENTS.map(([k]) => k).filter(k => status[k] === 'excluded');
  const included = COMPONENTS.map(([k]) => k).filter(k => status[k] !== 'excluded' && status[k] !== 'none' && bd[k] > 0);
  return { status, excluded, included, unknown: bd.unknown, text: scopeText(excluded, bd.unknown, rideOf(g)), ride: rideOf(g) };
}
/** ‘항공비 별도’ · ‘항공비·숙소비 별도’ · ‘항공·숙소 포함’ */
export function scopeText(excluded, unknown = 0, ride = 'air') {
  const name = { flight: RIDE[ride].fee, hotel: '숙소비' };
  const out = excluded.map(k => name[k] || LABEL[k]);
  return [out.length ? `${out.join('·')} 별도` : '', unknown ? `미확인 ${unknown}곳 제외` : ''].filter(Boolean).join(' · ');
}

/** 같은 비용이 두 번 들어갔는지 — 왕복 항공·숙박·체크인/복귀 */
export function costDuplicates(g) {
  const out = [];
  const acts = (g?.days || []).flatMap((d, di) => (d.activities || []).map((a, ai) => ({ a, di, ai })));
  const fl = acts.filter(x => x.a.category === '이동' && x.a.flightMeta && won(x.a.cost) > 0);
  const round = won(fl.find(x => x.a.flightMeta.roundTripKRW)?.a.flightMeta.roundTripKRW);
  const sum = fl.reduce((n, x) => n + won(x.a.cost), 0);
  if (fl.length > 2) out.push({ code: 'flightTwice', text: `${rideOf(g) === 'air' ? '항공권이' : `${RIDE[rideOf(g)].ticket} 값이`} 세 번 이상 더해졌어요.` });
  if (round && !fl.some(x => x.a.costEdited || x.a.edited) && Math.abs(sum - round) > 200) out.push({ code: 'flightSum', text: `${RIDE[rideOf(g)].ticket} 합계가 왕복 요금과 달라요(차이 ${Math.abs(sum - round)}원).` });
  const paid = acts.filter(x => x.a.category === '숙박' && !x.a.excludedFromBudget && won(x.a.cost) > 0);
  const nights = Math.max(0, (g?.days?.length || 1) - 1);
  if (paid.length > nights) out.push({ code: 'hotelTwice', text: `숙박비가 ${nights}박보다 많이(${paid.length}번) 더해졌어요.` });
  if (paid.some(x => /체크인|체크아웃|짐 찾기|\(출발/.test(x.a.name || ''))) out.push({ code: 'hotelLabel', text: '체크인·체크아웃에도 숙박비가 들어 있어요.' });
  return out;
}

/** 조건을 바꿨을 때 예상 금액 — 항목별로 ‘지금 실제 금액 × (바뀐 추정 ÷ 지금 추정)’.
 *  따로 계산하는 항목은 0, 지금 값이 없는 항목은 바뀐 추정을 그대로 쓴다.
 *  rebuilt: 장소를 새로 만드는 대안 — 식비·입장·쇼핑·교통은 새 일정의 추정이 그대로 실제 금액이 된다. */
const LOCAL = new Set(['food', 'entry', 'shopping', 'transport']);
export function projectCost(actual, baseEst, nextEst, { rebuilt = false } = {}) {
  const out = {};
  for (const [k] of COMPONENTS) {
    const b = won(baseEst[k]), x = won(nextEst[k]), a = won(actual[k]);
    out[k] = x === 0 ? 0 : rebuilt && LOCAL.has(k) ? x : (b > 0 && a > 0) ? Math.round(a * x / b) : (b === x ? a : x);
  }
  out.total = COMPONENTS.reduce((n, [k]) => n + out[k], 0);
  return out;
}

/** 두 금액표의 차이(큰 것부터). */
export function compareCost(before, after, ride) {
  return COMPONENTS.map(([k]) => ({ key: k, label: componentLabel(k, ride), before: won(before[k]), after: won(after[k]), diff: won(after[k]) - won(before[k]) }))
    .filter(x => x.before || x.after);
}

/** 예상과 적용 결과가 다른 까닭 — 1천 원 미만은 반올림으로 본다. */
export function diffReasons(predicted, actual, info = {}) {
  const diff = won(actual.total) - won(predicted.total);
  if (Math.abs(diff) < 1000) return { diff, same: true, reasons: [] };
  const why = {
    flight: info.flightLive ? '항공은 실시간 요금을 다시 조회했어요' : `${componentLabel('flight', info.ride)} 추정이 새 날짜·도시 기준으로 바뀌었어요`,
    hotel: info.hotelLive ? '숙소는 실시간 요금을 다시 조회했어요' : '새로 고른 숙소의 추정 요금이에요',
    food: '식사·카페 수가 달라졌어요', entry: '관광·체험 장소 수가 달라졌어요', shopping: '쇼핑 장소 수가 달라졌어요', transport: '여행 날 수가 달라졌어요',
  };
  const reasons = compareCost(predicted, actual, info.ride).filter(x => Math.abs(x.diff) >= 1000).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .map(x => ({ key: x.key, label: x.label, diff: x.diff, text: why[x.key] }));
  return { diff, same: false, reasons };
}
