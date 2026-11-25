// 실행: node --test tests/fe/local-course.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/generator.mjs';
const { checkCourse, toPayload, LIVED, STYLE_LIST, CATS } = await import('../../FE/js/redesign-local-course.js');
const { fromLocal } = await import('../../FE/js/redesign-roadmaps.js');
import { readFileSync } from 'node:fs';

const good = () => ({ id: null, city: '서울', country: '대한민국', area: ' 망원동 ', lived: '3~10년', title: '망원동 느린 하루', concept: '균형', note: '주말 아침 시장이 한산해요.', confirm: true,
  days: [[{ time: '10:00', name: '망원시장', cat: '시장', tip: '' }, { time: '', name: ' 한강공원 ', cat: '산책', tip: '' }, { time: '', name: '', cat: '산책', tip: '' }]] });
const keys = (c) => checkCourse(c).map(x => x[0]);

test('다 채운 코스는 통과하고, 빈 줄은 보내지 않는다', () => {
  assert.deepEqual(checkCourse(good()), []);
  const p = toPayload(good());
  assert.equal(p.area, '망원동');
  assert.deepEqual(p.days[0].map(s => s.name), ['망원시장', '한강공원']);
  assert.equal(p.confirm_local, true);
  assert.ok(!('id' in p) && !('status' in p));
});

test('빠진 칸과 넣을 수 없는 내용을 칸마다 알려 준다', () => {
  assert.deepEqual(keys({ ...good(), city: '', country: '' }), ['city']);
  assert.deepEqual(keys({ ...good(), lived: '' }), ['lived']);
  assert.deepEqual(keys({ ...good(), title: '짧' }), ['title']);
  assert.deepEqual(keys({ ...good(), note: '예약은 010-1234-5678 로 주세요' }), ['note']);
  assert.deepEqual(keys({ ...good(), note: '자세한 건 spam.com 에서 보세요' }), ['note']);
  assert.deepEqual(keys({ ...good(), confirm: false }), ['confirm']);
  assert.deepEqual(keys({ ...good(), days: [[{ time: '', name: '한 곳', cat: '식사', tip: '' }]] }), ['day0']);
});

test('서버가 받는 값과 화면의 선택지가 같다', () => {
  const py = readFileSync(new URL('../../BE/app/schemas/local_course_schema.py', import.meta.url), 'utf8');
  const lit = (n) => [...py.match(new RegExp(`^${n} = Literal\\[(.*)\\]`, 'm'))[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(lit('Lived'), LIVED);
  assert.deepEqual(lit('Concept'), STYLE_LIST);
  assert.deepEqual(lit('Category'), CATS);
});

test('카드로 바꾸면 좋아요·비용을 만들지 않고 동네와 팁을 남긴다', () => {
  const m = fromLocal({ id: 7, author: '나', city: '서울', country: '대한민국', area: '망원동', lived: '10년 이상', title: 't', concept: '균형', note: 'n', days: [[{ time: '', name: 'a', cat: '식사', tip: '팁' }]], created_at: '2026-11-26' });
  assert.equal(m.id, 'l7'); assert.equal(m.isLocal, true); assert.equal(m.days, 1);
  assert.equal(m.likes, 0); assert.equal(m.cost, null); assert.equal(m.plan[0][0].tip, '팁');
});
