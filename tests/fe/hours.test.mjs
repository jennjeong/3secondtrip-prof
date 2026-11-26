// 실행: node --test tests/fe/hours.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openState, stayState } from '../../FE/js/redesign-hours.js';

// 2026-11-28 은 토요일(d=6). 점심 11:30~14:30, 저녁 17:00~21:00
const ramen = [{ d: 6, o: 690, c: 870 }, { d: 6, o: 1020, c: 1260 }];
const sat = '2026-11-28';

test('머무는 동안 문을 열면 open', () => {
  assert.equal(stayState(ramen, sat, '18:00', 60), 'open');
});

test('도착은 되지만 머무는 중에 닫으면 closingSoon', () => {
  assert.equal(openState(ramen, sat, '20:30'), 'open');
  assert.equal(stayState(ramen, sat, '20:30', 60), 'closingSoon');
  assert.equal(stayState(ramen, sat, '14:00', 60), 'closingSoon');      // 점심 마감도 같다
});

test('닫힘·휴무·모름은 openState 와 같다', () => {
  assert.equal(stayState(ramen, sat, '15:30', 60), 'closedNow');
  assert.equal(stayState(ramen, '2026-11-29', '18:00', 60), 'closedDay');
  assert.equal(stayState([], sat, '18:00', 60), 'unknown');
});

test('자정을 넘기는 머묾과 24시간 영업은 open', () => {
  assert.equal(stayState([{ d: 6, o: 0, c: 1440 }], sat, '23:30', 60), 'open');
  assert.equal(stayState([{ d: 6, o: 1080, c: 120 }], sat, '23:40', 60), 'open');
});
