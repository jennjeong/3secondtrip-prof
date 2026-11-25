// 실행: node --test tests/fe/ground.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, Flow, state, tripOf } from './helpers/generator.mjs';
import { CITIES } from '../../FE/js/redesign-cities.js';
import { groundRoute, GROUND_LINES, rideMode, rideOf, RIDE } from '../../FE/js/redesign-ground.js';
import { checkTrip, checkDay, airportMinutes, beforeFlight, landingMinutes, timeToMin, isInternational } from '../../FE/js/redesign-plan-check.js';
import { costBreakdown, costScope, costDuplicates, compareCost, componentLabel } from '../../FE/js/redesign-plan-cost.js';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}.json`, import.meta.url)));
const route = (from, to) => groundRoute({ origin: from, city: to });
const rides = (g) => g.days.flatMap(d => d.activities).filter(a => a.flightMeta);
const text = (g) => JSON.stringify(g.days) + JSON.stringify(g.providers.flight);

/* ── 구간 ── */
test('서울 → 강릉은 KTX, 서울 → 속초는 버스로 간다', () => {
  const a = route('seoul', 'gangneung');
  assert.deepEqual([a.mode, a.label, a.from, a.to], ['train', 'KTX', '서울역', '강릉역']);
  assert.ok(a.minutes >= 100 && a.minutes <= 140 && a.fare >= 25000 && a.fare <= 32000);
  const b = route('seoul', 'sokcho');
  assert.deepEqual([b.mode, b.from, b.to], ['bus', '서울고속버스터미널', '속초고속버스터미널']);
  assert.ok(b.minutes >= 120 && b.minutes <= 180 && b.fare >= 15000 && b.fare <= 28000);
});
test('제주·울릉·신안(섬)과 다른 나라는 육로가 없다', () => {
  for (const [x, y] of [['seoul', 'jeju'], ['jeju', 'busan'], ['seoul', 'ulleung'], ['pohang', 'ulleung'], ['seoul', 'sinan'], ['seoul', 'tokyo'], ['tokyo', 'okinawa'], ['seoul', 'seoul'], ['', 'busan']]) assert.equal(route(x, y), null, `${x} → ${y}`);
});
test('오가는 길의 시간·요금이 같고 역 이름만 뒤바뀐다', () => {
  for (const [x, y] of [['seoul', 'busan'], ['daejeon', 'mokpo'], ['sokcho', 'jeonju'], ['tokyo', 'kyoto']]) {
    const a = route(x, y), b = route(y, x);
    assert.deepEqual([a.minutes, a.fare, a.from, a.to], [b.minutes, b.fare, b.to, b.from], `${x} ↔ ${y}`);
  }
});
test('섬이 아닌 우리나라 도시는 어느 쌍이든 기차나 버스가 있고 값이 그럴듯하다', () => {
  const kr = CITIES.filter(c => c.country === '대한민국' && !['jeju', 'ulleung', 'sinan'].includes(c.key));
  for (const a of kr) for (const b of kr) {
    if (a === b) continue;
    const r = route(a.key, b.key);
    assert.ok(r, `${a.name} → ${b.name} 없음`);
    assert.ok(['train', 'bus', 'subway'].includes(r.mode) && r.minutes >= 15 && r.minutes <= 400 && r.minutes % 5 === 0 && r.fare >= 1500 && r.fare <= 75000 && r.fare % 100 === 0, `${a.name} → ${b.name} ${JSON.stringify(r)}`);
    assert.match(r.to, r.mode === 'bus' ? /(터미널|정류장)$/ : /역$/);
  }
});
test('구간 표의 도시는 모두 있는 도시이고 한 나라 안에 있으며 순서대로 늘어난다', () => {
  for (const l of GROUND_LINES) {
    const cs = l.stops.map(s => CITIES.find(c => c.key === s.key));
    assert.ok(cs.every(Boolean), `${l.label}: ${l.stops.map(s => s.key)}`);
    assert.equal(new Set(cs.map(c => c.country)).size, 1, l.label);
    l.stops.forEach((s, i) => assert.ok(!i || (s.min > l.stops[i - 1].min && s.fare > l.stops[i - 1].fare), `${l.label} ${s.key}`));
  }
});
test('해외도 같은 나라 안의 짧은 기차 구간만 — 도쿄 → 교토는 신칸센, 도쿄 → 후쿠오카는 그대로 비행기', () => {
  assert.equal(route('tokyo', 'kyoto').label, '신칸센');
  assert.equal(route('tokyo', 'fukuoka'), null);
  assert.equal(route('nyc', 'la'), null);
});
test('예전 일정처럼 이동 수단이 적혀 있지 않으면 항공이다', () => {
  assert.equal(rideMode({ flightMeta: {} }), 'air');
  assert.equal(rideOf(load('gangneung-old-air')), 'air');
  assert.equal(rideOf({ days: [] }), 'air');
});

/* ── 생성 ── */
test('서울 → 강릉 일정은 강릉역에 KTX로 도착하고 공항·항공 말이 어디에도 없다', async () => {
  const { g, queries } = await generate('seoul', 'gangneung', 3);
  const [a, b] = rides(g);
  assert.equal(a.name, '강릉역 (도착)'); assert.equal(b.name, '강릉역 (출발)');
  assert.equal(rideOf(g), 'train');
  assert.equal(a.latitude, 37.7645, '역 위치로 동선을 잡는다');
  assert.match(a.address, /^예시 열차 · KTX · 서울역 출발 \d\d:\d\d → 강릉역 도착 \d\d:\d\d \(예상\) · 2시간$/);
  assert.match(b.address, /강릉역 출발 \d\d:\d\d → 서울역 도착 \d\d:\d\d/);
  assert.doesNotMatch(text(g), /공항|항공|비행|대한항공|입국/);
  assert.ok(!queries.some(q => /공항|flights/.test(q)), '공항·항공권 조회를 하지 않는다');
  assert.equal(g.sources.flight, 'estimate');
});
test('왕복 교통비 = 편도 운임 × 2 × 인원, 예산 추정과 합계가 같다', async () => {
  const { g } = await generate('seoul', 'gangneung', 3);
  const fare = route('seoul', 'gangneung').fare;
  const bd = costBreakdown(g);
  assert.equal(bd.flight, fare * 2 * 2);
  assert.equal(bd.total, g.budgetPlan.estimate);
  assert.deepEqual(costDuplicates(g), []);
});
test('기차·버스로 만든 일정은 시간 충돌이 없다(당일·3일·먼 버스 구간)', async () => {
  for (const [x, y, d] of [['seoul', 'gangneung', 1], ['seoul', 'gangneung', 3], ['seoul', 'busan', 2], ['seoul', 'wando', 3], ['tokyo', 'kyoto', 2]]) {
    const { g } = await generate(x, y, d);
    assert.deepEqual(checkTrip(g).conflicts, [], `${x} → ${y} ${d}일`);
    const [a, b] = rides(g);
    assert.ok(timeToMin(a.flightMeta.depTime) >= 7 * 60 && a.flightMeta.depDayOffset === 0, '아침에 나선다');
    assert.equal(b.flightMeta.arrDayOffset, 0);
    assert.ok(timeToMin(b.flightMeta.arrTime) <= 23 * 60, '밤 11시 전에 집에 돌아온다');
  }
});
test('예산에서 빼면 기차표가 0원이고 따로 계산으로 적힌다', async () => {
  const { g } = await generate('seoul', 'gangneung', 3, { includeFlight: false });
  assert.equal(costBreakdown(g).flight, 0);
  assert.equal(costScope(g).text, '기차비 별도');
});
test('서울 → 제주는 예전과 같은 항공 일정이다', async () => {
  const { g, queries } = await generate('seoul', 'jeju', 3);
  const [a] = rides(g);
  assert.equal(rideOf(g), 'air'); assert.equal(a.flightMeta.mode, undefined);
  assert.match(a.name, /국제공항.*\(도착\)/); assert.match(a.address, /^예시 항공편 · 대한항공/);
  assert.ok(queries.includes('제주 국제공항'));
});
test('공항을 직접 고른 서울 → 부산은 비행기로 간다 — 공항 조회가 안 되는 도시는 그대로 육로', async () => {
  assert.equal(rideOf((await generate('seoul', 'busan', 2, { departureAirport: 'GMP' })).g), 'air');
  assert.equal(rideOf((await generate('seoul', 'busan', 2)).g), 'train');
  assert.equal(rideOf((await generate('seoul', 'gangneung', 2, { departureAirport: 'GMP' })).g), 'train');
});

/* ── 점검 ── */
const ride = (dir, time, mode, dep, arr, o = {}) => ({ time, name: `${mode === 'bus' ? '속초고속버스터미널' : '강릉역'} (${dir})`, category: '이동', cost: 1000, latitude: 37.7645, longitude: 128.8995, flightMeta: { mode, depTime: dep, arrTime: arr, source: 'estimate' }, ...o });
const stop = (time, name, o = {}) => ({ time, name, category: '관광', cost: 0, sample: true, latitude: 37.76, longitude: 128.9, ...o });
const trip = (...days) => ({ city: '강릉', country: '대한민국', originCountry: '대한민국', days: days.map((activities, i) => ({ date: `2026-12-0${8 + i}`, activities })) });
test('역·터미널은 공항보다 여유가 짧고, 내려서 시내까지도 공항 기준을 쓰지 않는다', () => {
  for (const mode of ['train', 'bus', 'subway']) {
    const g = trip([ride('도착', '10:30', mode, '08:30', '10:30')]);
    assert.ok(beforeFlight(g) <= 20 && beforeFlight(g) > 0 && landingMinutes(g) <= 10, mode);
    assert.ok(airportMinutes(g.days[0].activities[0], stop('11:00', 'A')) <= 20);
    assert.equal(airportMinutes(g.days[0].activities[0], { name: '위치 모름' }), 25);
  }
  assert.equal(isInternational(trip([])), false);
});
test('도착 전·내린 직후 일정과 빠듯한 출발을 역·기차 말로 알린다', () => {
  const g = trip([ride('도착', '10:30', 'train', '08:30', '10:30'), stop('10:00', '이른 곳'), stop('17:00', '늦은 곳'), ride('출발', '18:30', 'train', '18:30', '20:30')]);
  const r = checkDay(g, 0), all = JSON.stringify(r);
  assert.ok(r.list.some(x => x.code === 'beforeArrival' && /기차 도착/.test(x.text)));
  assert.ok(r.list.some(x => x.code === 'departureTight' && /출발 20분 전 역 도착/.test(x.text)));
  const t = JSON.stringify(checkDay(trip([ride('도착', '10:30', 'bus', '08:00', '10:30'), stop('10:35', '바로')]), 0));
  assert.match(t, /터미널/);
  assert.doesNotMatch(all + t, /공항|항공|착륙|입국/);
});
test('항공 점검 글과 여유는 그대로다', () => {
  const g = trip([{ ...ride('도착', '10:30', undefined, '09:30', '10:30') }, stop('10:00', '이른 곳')]);
  assert.equal(beforeFlight(g), 60); assert.equal(landingMinutes(g), 20);
  assert.match(checkDay(g, 0).list[0].text, /항공편 도착\(10:30\)/);
});

/* ── 비용 이름 ── */
test('비용 항목 이름은 이동 수단을 따른다', () => {
  const g = trip([ride('도착', '10:30', 'bus', '08:30', '10:30')]);
  assert.equal(componentLabel('flight', rideOf(g)), '버스');
  assert.equal(componentLabel('flight'), '항공'); assert.equal(componentLabel('hotel', 'bus'), '숙소');
  const c = compareCost({ flight: 10 }, { flight: 5 }, 'train');
  assert.equal(c[0].label, '기차');
  assert.deepEqual(Object.keys(RIDE).sort(), ['air', 'bus', 'subway', 'train']);
});

/* ── 예산 대안 ── */
test('기차 일정의 예산 대안에는 저비용 항공이 없고, 빼면 기차비 별도로 적는다', async () => {
  const { g } = await generate('seoul', 'busan', 3, { budget: 40 });
  const alts = Flow.budgetAlternativesFor(g);
  assert.ok(alts.length > 1);
  assert.ok(!alts.some(a => /lcc/.test(a.key) || (a.changes || []).includes('lcc')));
  const no = alts.find(a => a.key === 'noFlight');
  assert.equal(no.label, '기차표는 따로 계산'); assert.equal(no.scope, '기차비 별도');
  assert.doesNotMatch(JSON.stringify(alts.map(a => [a.label, a.detail, a.summary, a.scope, a.compare])), /항공/);
});
test('육로 일정의 가까운 도시 대안은 그 도시까지의 교통비로 계산한다', async () => {
  const { g } = await generate('seoul', 'busan', 3, { budget: 40 });
  const near = Flow.budgetAlternativesFor(g).find(a => a.key === 'nearby');
  if (near && near.apply.city.key !== 'jeju') assert.equal(near.after.flight, (groundRoute({ origin: 'seoul', city: near.apply.city.key })?.fare || 0) * 4);
});

/* ── 예전 저장 일정 ── */
test('예전 항공 일정은 점검·비용·대안 어디에서도 바뀌지 않는다', () => {
  const g = load('gangneung-old-air'), before = JSON.stringify(g);
  Object.assign(state.trip, tripOf('seoul', 'gangneung', 3, { budget: 80 })); state.generated = g;
  assert.equal(costBreakdown(g).flight, 635000);
  assert.deepEqual(costScope(g).text, '');
  checkTrip(g);
  const alts = Flow.budgetAlternativesFor(g);
  assert.equal(JSON.stringify(g), before);
  const lcc = alts.find(a => a.key === 'lcc');
  assert.ok(lcc && lcc.after.flight > 200000 && lcc.after.flight < 635000, '항공 일정은 항공 기준으로 비교한다');
  const save = alts.find(a => a.key === 'save' || a.key === 'shorter');
  assert.ok(save);
  assert.equal(save.after.flight, route('seoul', 'gangneung').fare * 4, '다시 만드는 대안은 새 기준(기차)으로 예상한다');
});
test('예전 항공 일정에서 다시 조회해도 항공 조회로 남는다', async () => {
  const g = load('gangneung-old-air'), days = JSON.stringify(g.days);
  Object.assign(state.trip, tripOf('seoul', 'gangneung', 3, { budget: 80 })); state.generated = g;
  const r = await Flow.retryProvider('flight');
  assert.match(r.state.name, /Google 항공/);
  assert.equal(JSON.stringify(g.days), days);
});
test('기차 일정에서 다시 만들면 기차로 남고, 공항을 고른 여행은 다시 만들어도 비행기로 남는다', async () => {
  await generate('seoul', 'gangneung', 2);
  await Flow.regenerateSchedule();
  assert.equal(rideOf(state.generated), 'train');
  const { g } = await generate('seoul', 'busan', 2, { departureAirport: 'GMP' });
  Object.assign(state.trip, tripOf('seoul', 'tokyo', 4));          // 다른 여행을 짜다가 저장한 일정을 연 경우
  state.generated = g;
  await Flow.regenerateSchedule();
  assert.equal(rideOf(state.generated), 'air');
});
