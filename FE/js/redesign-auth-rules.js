/* 3초 여행 — 계정 입력 규칙(서버 BE/app/core/password_policy.py 와 같은 값)
 * 화면은 입력하는 동안과 제출할 때 이 규칙으로 먼저 알려 주고, 최종 판단은 서버가 한다. */

export const PW = { min: 8, max: 128, passphrase: 15 };

// 유출 목록에 늘 오르는 비밀번호(서버 목록과 같아야 한다 — tests/fe/auth-rules.test.mjs 가 비교)
export const COMMON = [
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'qwerty123', 'qwer1234',
  '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'abcd1234', 'asdf1234', 'zxcv1234', 'a1234567',
  'qwerty12', 'iloveyou1', 'letmein1', 'welcome1', 'admin123', 'test1234', '12345678a', 'a12345678',
  'q1w2e3r4', 'q1w2e3r4t5', 'sunshine1', 'princess1', 'football1', 'baseball1', 'dragon123', 'monkey123',
  'korea1234', 'love1234', 'hello123', 'hello1234', 'pass1234', 'secret123', 'travel123', 'trip12345',
];
const COMMON_SET = new Set(COMMON);

export const PW_RULE_TEXT = `${PW.min}~${PW.max}자. ${PW.passphrase}자 미만이면 영문과 숫자를 함께 넣어 주세요. 앞뒤 공백도 비밀번호에 그대로 들어가요.`;

/** 비밀번호 — 맞으면 '', 아니면 짧은 이유. 자르거나 공백을 지우지 않는다. */
export function checkPassword(pw) {
  const v = typeof pw === 'string' ? pw : '';
  if (v.length < PW.min) return `비밀번호는 ${PW.min}자 이상이어야 해요.`;
  if (v.length > PW.max) return `비밀번호는 ${PW.max}자까지 쓸 수 있어요.`;
  if (v.length < PW.passphrase && !(/[A-Za-z]/.test(v) && /\d/.test(v))) return `${PW.passphrase}자 미만이면 영문과 숫자를 함께 넣어 주세요.`;
  if (COMMON_SET.has(v.toLowerCase()) || new Set(v).size <= 2) return '너무 흔해서 쉽게 추측되는 비밀번호예요. 다른 비밀번호를 정해 주세요.';
  return '';
}

export function checkEmail(email) {
  const v = String(email || '').trim();
  if (!v) return '이메일을 입력해 주세요.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return '이메일 주소 형식을 확인해 주세요. 예: you@example.com';
  return '';
}

export function checkNickname(nick) {
  const v = String(nick || '').trim();
  if (!v) return '닉네임을 입력해 주세요.';
  if (v.length < 2 || v.length > 30) return '닉네임은 2~30자로 정해 주세요.';
  return '';
}

/** 메뉴에 쓰는 닉네임 — 비어 있으면 '내 계정'. 줄이는 건 CSS(말줄임)가 맡고 글자는 그대로 둔다. */
export function displayName(user) {
  const n = String(user?.nickname || '').trim();
  return n || '내 계정';
}
