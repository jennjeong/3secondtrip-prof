// 실행: node --test tests/fe/wake.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWaker, FRESH_MS } from '../../FE/js/redesign-wake.js';

/** 시계를 손으로 돌리는 깨우기 도우미 */
function setup(answers, opt = {}) {
  let t = 0; const calls = [];
  const w = createWaker({
    now: () => t, sleep: async (ms) => { t += ms; },
    ping: async () => { calls.push(t); const a = answers.length > 1 ? answers.shift() : answers[0]; t += a.ms ?? 0; if (a.err) throw new Error('net'); return a.ok; },
    ...opt,
  });
  return { w, calls, at: () => t, pass: (ms) => { t += ms; } };
}

test('방금 응답한 서버는 다시 부르지 않는다', async () => {
  const { w, calls } = setup([{ ok: true }]);
  w.touch();
  assert.equal(await w.ensure(), true);
  assert.equal(calls.length, 0);
});

test('오래 열어 둔 화면: 12분이 지나면 다시 깨운 뒤 시작한다', async () => {
  const { w, calls, pass } = setup([{ ok: true, ms: 28e3 }]);
  w.touch(); pass(FRESH_MS + 1);
  assert.equal(w.isFresh(), false);
  assert.equal(await w.ensure(), true);
  assert.equal(calls.length, 1);
  assert.equal(w.isFresh(), true);
});

test('연결 실패·앞단 오류는 깨어날 때까지 다시 시도한다', async () => {
  const { w, calls } = setup([{ err: true }, { ok: false }, { ok: true, ms: 20e3 }]);
  assert.equal(await w.ensure(), true);
  assert.equal(calls.length, 3);
});

test('끝내 응답이 없으면 정한 시간 안에 false', async () => {
  const { w, at } = setup([{ ok: false, ms: 1000 }]);
  assert.equal(await w.ensure({ maxMs: 30e3 }), false);
  assert.ok(at() <= 31e3, String(at()));
});

test('인터넷이 끊겼으면 기다리지 않는다', async () => {
  const { w, calls } = setup([{ ok: true }], { online: () => false });
  assert.equal(await w.ensure(), false);
  assert.equal(calls.length, 0);
});

test('동시에 불러도 한 번만 깨운다', async () => {
  const { w, calls } = setup([{ ok: true, ms: 10 }]);
  assert.deepEqual(await Promise.all([w.ensure(), w.ensure(), w.wake()]), [true, true, true]);
  assert.equal(calls.length, 1);
});

test('안내는 바로 답하면 띄우지 않고, 기다릴 때만 띄운다', async () => {
  let notes = 0;
  const real = createWaker({ ping: () => new Promise(r => setTimeout(() => r(true), 5)) });
  await real.ensure({ onWait: () => notes++, waitAfter: 60 });
  await new Promise(r => setTimeout(r, 80));
  assert.equal(notes, 0);
  const slow = createWaker({ ping: () => new Promise(r => setTimeout(() => r(true), 60)) });
  await slow.ensure({ onWait: () => notes++, waitAfter: 10 });
  assert.equal(notes, 1);
});

test('화면에 떠 있을 때만 잠들지 않게 하고, 가려진 동안은 부르지 않는다', async () => {
  const { w, calls, pass } = setup([{ ok: true }]);
  let tick, onVis; const doc = { visibilityState: 'visible', addEventListener: (_, f) => { onVis = f; } };
  w.touch(); w.watch(doc, (f) => { tick = f; });
  pass(9 * 60e3); tick(); assert.equal(calls.length, 0);
  pass(60e3); tick(); await w.wake(); const n = calls.length; assert.ok(n >= 1);
  doc.visibilityState = 'hidden'; pass(30 * 60e3); tick(); onVis(); assert.equal(calls.length, n);
  doc.visibilityState = 'visible'; onVis(); await w.wake(); assert.ok(calls.length > n);
});

test('서버에 연결할 수 없으면 실패할 요청 없이 예시 장소로 만들고, 연결 문제로 알린다', async () => {
  const { generate, state } = await import('./helpers/generator.mjs');
  navigator.onLine = false;
  try { await generate('seoul', 'tokyo', 3); } finally { navigator.onLine = true; }
  const g = state.generated;
  assert.equal(g.days.length, 3);
  assert.equal(g.sources.placesReal, 0);
  assert.equal(g.providers.places.code, 'network');
  assert.equal(g.providers.places.retryable, true);
});
