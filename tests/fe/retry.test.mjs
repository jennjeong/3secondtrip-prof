import test from 'node:test';
import assert from 'node:assert/strict';

// 일정 생성이 실패해도 입력은 그대로 남고, 같은 입력으로 다시 시도하면 만들어진다.
test('생성 실패 뒤 입력이 남아 있고, 다시 시도하면 같은 입력으로 만든다', async () => {
  const { Flow, state, tripOf } = await import('./helpers/generator.mjs');
  Object.assign(state.trip, tripOf('seoul', 'tokyo', 3));
  state.generated = null;
  // 날짜를 망가뜨려 실패시킨다 — 다른 입력은 그대로 둔다
  const good = state.trip.endDate;
  state.trip.endDate = '2026-12-01';
  const before = JSON.stringify({ ...state.trip, endDate: null });
  const ok1 = await Flow.regenerateSchedule({ skipSync: true, quietFail: true });
  assert.equal(ok1, false);
  assert.equal(state.generated, null);
  assert.equal(JSON.stringify({ ...state.trip, endDate: null }), before, '실패해도 다른 입력은 바뀌지 않는다');
  state.trip.endDate = good;
  const ok2 = await Flow.regenerateSchedule({ skipSync: true, quietFail: true });
  assert.equal(ok2, true);
  assert.equal(state.generated.days.length, 3);
  assert.equal(state.generated.city || state.trip.cityName, state.trip.cityName);
});
