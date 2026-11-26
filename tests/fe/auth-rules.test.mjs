// 실행: node --test tests/fe/auth-rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PW, COMMON, checkPassword, checkEmail, checkNickname, displayName } from '../../FE/js/redesign-auth-rules.js';

const py = readFileSync(new URL('../../BE/app/core/password_policy.py', import.meta.url), 'utf8');

test('화면과 서버의 비밀번호 정책이 같다', () => {
  const num = (n) => Number(py.match(new RegExp(`^${n} = (\\d+)`, 'm'))[1]);
  assert.equal(PW.min, num('MIN_LEN')); assert.equal(PW.max, num('MAX_LEN')); assert.equal(PW.passphrase, num('PASSPHRASE_LEN'));
  const block = py.match(/COMMON = \{([\s\S]*?)\}/)[1];
  const server = [...block.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual([...COMMON].sort(), server);
});

test('비밀번호 규칙', () => {
  assert.match(checkPassword('short1a'), /8자 이상/);
  assert.match(checkPassword('abcdefghij'), /영문과 숫자/);
  assert.match(checkPassword('password123'), /흔해서/);
  assert.match(checkPassword('x'.repeat(129)), /128자까지/);
  assert.equal(checkPassword('Trip-pass-2026'), '');
  assert.equal(checkPassword('  our little trip to the sea  '), '');      // 문장형, 공백 그대로
  assert.equal(checkPassword('가'.repeat(30) + '끝A1'), '');                 // 긴 한글도
});

test('이메일·닉네임·메뉴 이름', () => {
  assert.notEqual(checkEmail(''), ''); assert.notEqual(checkEmail('a@b'), ''); assert.equal(checkEmail(' you@example.com '), '');
  assert.notEqual(checkNickname('a'), ''); assert.equal(checkNickname('여행자'), '');
  assert.equal(displayName({ nickname: '' }), '내 계정'); assert.equal(displayName({ nickname: '아주긴닉네임이에요정말' }), '아주긴닉네임이에요정말');
});
