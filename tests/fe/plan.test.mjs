// 실행: node --test tests/fe/plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDay, checkTrip, repairTrip, repairDay, airportMinutes, timeToMin } from '../../FE/js/redesign-plan-check.js';
import { costBreakdown, costScope, costDuplicates, projectCost, compareCost, diffReasons, COMPONENTS } from '../../FE/js/redesign-plan-cost.js';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}.json`, import.meta.url)));
const flight = (dir, time, dep, arr, extra = {}) => ({ time, name: `공항 (${dir})`, category: '이동', cost: 100000, address: `출발 ${dep} → 도착 ${arr} (예상, 각 현지 시각)`, flightMeta: { roundTripKRW: 200000, source: 'estimate', ...extra } });
const stop = (time, name, o = {}) => ({ time, name, category: '관광', cost: 10000, sample: true, ...o });
const hotel = (time, label, cost = 0) => ({ time, name: `호텔 (${label})`, category: '숙박', cost });
const trip = (...days) => ({ city: '도쿄', country: '일본', originCountry: '대한민국', days: days.map((activities, i) => ({ date: `2026-12-${String(8 + i).padStart(2, '0')}`, activities })) });
const codes = (r) => r.list.filter(x => x.kind === 'time').map(x => x.code);

test('예전 도쿄 일정: 09:25 도착 전 08:30 체크인을 찾고, 장소를 빼지 않고 시간을 옮겨 푼다', () => {
  const g = load('tokyo-old-generator');
  const before = JSON.stringify(g);
  const c = checkDay(g, 0).list.find(x => x.code === 'beforeArrival');
  assert.equal(c.di, 0); assert.equal(c.ai, 1); assert.ok(c.placeId);
  const r = repairTrip(g);
  assert.equal(JSON.stringify(g), before, '원본(저장된 일정)은 바꾸지 않는다');
  assert.ok(r.before.conflicts.length >= 2);
  assert.equal(r.after.conflicts.length, 0);
  assert.equal(r.changes.filter(x => x.type === 'drop').length, 0);
  const d1 = r.days[0].activities;
  assert.equal(d1[0].time, '09:25');
  assert.ok(timeToMin(d1[1].time) >= timeToMin('09:25') + 50 + airportMinutes(d1[0], d1[1]));
  assert.ok(r.changes.every(x => x.reason && x.name));
});

test('수정 전 생성기의 마지막 날 공항 시간 충돌도 풀린다', () => {
  const r = repairTrip(load('tokyo-before-fix'));
  assert.ok(r.before.conflicts.some(x => x.code === 'departureTight'));
  assert.equal(r.after.conflicts.length, 0);
});

test('고정한 장소와 직접 고친 시각은 옮기지 않고 까닭을 알린다', () => {
  const g = trip([flight('도착', '10:30', '08:05', '10:30'), stop('11:00', '고정 장소', { pinned: true }), stop('13:00', '점심')]);
  const r = repairDay(g, 0);
  assert.equal(r.day.activities[1].time, '11:00');
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /고정/);
  assert.equal(r.blocked[0].ai, 1);
  const e = repairDay(trip([flight('도착', '10:30', '08:05', '10:30'), stop('10:00', '직접', { edited: true, timeEdited: true })]), 0);
  assert.equal(e.day.activities[1].time, '10:00'); assert.equal(e.blocked.length, 1);
  // 금액만 고친 장소는 시각을 옮길 수 있다
  const f = repairDay(trip([flight('도착', '10:30', '08:05', '10:30'), stop('10:00', '금액만', { edited: true, timeEdited: false })]), 0);
  assert.equal(f.blocked.length, 0); assert.ok(timeToMin(f.day.activities[1].time) >= 12 * 60);
});

test('시간 충돌과 확인할 정보를 나눈다', () => {
  const g = trip([flight('도착', '10:30', '08:05', '10:30'), hotel('12:10', '체크인·짐 맡기기'), stop('13:00', '영업시간 모름')]);
  const r = checkDay(g, 0);
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.list.filter(x => x.kind === 'info').map(x => x.code).sort(), ['checkin', 'hoursUnknown']);
});

test('영업시간 밖이면 여는 시각으로 옮기고, 휴무면 다른 장소가 필요하다고 알린다', () => {
  const tue = new Date(Date.UTC(2026, 11, 8)).getUTCDay();
  const late = stop('09:00', '미술관', { sample: false, openingPeriods: [{ d: tue, o: 600, c: 1080 }] });
  const a = repairDay(trip([late]), 0);
  assert.equal(a.day.activities[0].time, '10:00');
  const shut = stop('09:00', '휴무', { sample: false, openingPeriods: [{ d: (tue + 1) % 7, o: 600, c: 1080 }] });
  const b = repairDay(trip([shut]), 0);
  assert.equal(b.blocked.length, 1); assert.match(b.blocked[0].reason, /다른 장소/);
});

test('자정을 넘기는 하루는 뒤 장소를 빼서 하루 안에 맞춘다', () => {
  const far = { latitude: 35.0, longitude: 139.0 }, near = { latitude: 35.7, longitude: 139.7 };
  const g = trip([stop('18:00', 'A', { ...near, category: '액티비티' }), stop('19:00', 'B', { ...far, category: '액티비티' }), stop('20:00', 'C', near), hotel('22:00', '복귀 (1박)', 50000)]);
  const r = repairDay(g, 0);
  assert.ok(r.changes.some(x => x.type === 'drop'));
  assert.ok(r.day.activities.every(x => !x.pastMidnight));
});

test('당일치기에 머물 시간이 없으면 알린다 · 전날 출발도 알린다', () => {
  const g = trip([flight('도착', '13:00', '10:30', '13:00'), flight('출발', '17:00', '17:00', '19:30')]);
  assert.ok(codes(checkDay(g, 0)).includes('dayTrip'));
  const h = trip([flight('도착', '06:00', '22:30 (전날)', '06:00')]);
  assert.ok(codes(checkDay(h, 0)).includes('departPrevDay'));
});

test('국내선은 입국 심사 없이 더 빨리 움직일 수 있다', () => {
  const mk = (country) => ({ ...trip([flight('도착', '11:00', '10:00', '11:00'), hotel('12:05', '체크인·짐 맡기기')]), country });
  assert.deepEqual(codes(checkDay(mk('대한민국'), 0)), []);
  assert.deepEqual(codes(checkDay(mk('일본'), 0)), ['arrivalTight']);
});

test('필드가 빠진 예전 일정에서도 오류 없이 검사한다', () => {
  const g = { city: '도쿄', days: [{ date: '2025-01-01', activities: [{ name: '장소' }, { time: null, name: null }] }, { date: '2025-01-02' }] };
  assert.doesNotThrow(() => { checkTrip(g); repairTrip({ ...g, days: g.days.map(d => ({ ...d, activities: d.activities || [] })) }); costBreakdown(g); costScope(g); });
});

test('비용: 예전 도쿄 일정 합계를 항목별로 나누면 중복이 없다', () => {
  for (const f of ['tokyo-old-generator', 'tokyo-before-fix']) {
    const g = load(f), bd = costBreakdown(g);
    assert.equal(COMPONENTS.reduce((n, [k]) => n + bd[k], 0), bd.total);
    assert.equal(bd.flight, 430900); assert.equal(bd.hotel, 90000); assert.equal(bd.nights, 2);
    assert.deepEqual(costDuplicates(g), []);
  }
});

test('비용: 왕복·숙박 중복을 찾는다', () => {
  const g = trip([flight('도착', '10:30', '08:05', '10:30'), hotel('12:00', '체크인', 50000), hotel('22:00', '복귀 (1박)', 50000)], [flight('출발', '19:30', '19:30', '21:55', { roundTripKRW: 200000 })]);
  g.days[1].activities[0].cost = 200000;
  const c = costDuplicates(g).map(x => x.code);
  assert.ok(c.includes('flightSum') && c.includes('hotelTwice') && c.includes('hotelLabel'));
});

test('비용: 모르는 금액은 0원으로 더하지 않고 범위에 적는다', () => {
  const g = trip([stop('10:00', '무료', { cost: 0 }), stop('12:00', '모름', { cost: null })]);
  const bd = costBreakdown(g);
  assert.equal(bd.total, 0); assert.equal(bd.unknown, 1);
  assert.match(costScope(g, bd).text, /미확인 1곳/);
});

test('대안 금액: 따로 계산하는 항목은 정확히 빠지고, 실시간·직접 고친 금액이 남는다', () => {
  const actual = { flight: 512300, hotel: 90000, food: 100000, entry: 50000, shopping: 0, transport: 45000 };
  const base = { flight: 430900, hotel: 90000, food: 105000, entry: 50400, shopping: 18000, transport: 45000 };
  const noFlight = projectCost(actual, base, { ...base, flight: 0 });
  assert.equal(noFlight.flight, 0); assert.equal(noFlight.total, 285000);          // 추정 차이(430,900)가 아니라 실제 512,300 이 빠진다
  const half = projectCost(actual, base, { ...base, food: 52500 });
  assert.equal(half.food, 50000); assert.equal(half.flight, 512300);
  assert.equal(compareCost(actual, noFlight).find(x => x.key === 'flight').diff, -512300);
});

test('적용 뒤 차이와 까닭을 말한다', () => {
  const p = { flight: 0, hotel: 45000, food: 60000, entry: 20000, shopping: 0, transport: 30000, total: 155000 };
  assert.equal(diffReasons(p, { ...p }).same, true);
  const r = diffReasons(p, { ...p, food: 75000, total: 170000 });
  assert.equal(r.diff, 15000); assert.equal(r.reasons[0].key, 'food');
});

test('새 생성기로 실제 장소 검색을 써서 만든 도쿄 일정은 시간 충돌이 없고 추정과 합계가 같다', () => {
  const g = load('tokyo-new-real');
  const r = checkTrip(g);
  assert.deepEqual(r.conflicts, []);
  assert.equal(costBreakdown(g).total, g.budgetPlan.estimate);
  assert.deepEqual(costDuplicates(g), []);
  assert.equal(costScope(g).status.flight, 'estimate');
});

test('도착하고 30분 안에 문을 닫으면 확인할 정보로 알린다', () => {
  const tue = new Date(Date.UTC(2026, 11, 8)).getUTCDay();
  const r = checkDay(trip([stop('17:40', '전망대', { sample: false, openingPeriods: [{ d: tue, o: 600, c: 1080 }] })]), 0);
  assert.deepEqual(r.list.filter(x => x.kind === 'info').map(x => x.code), ['closingSoon']);
});
