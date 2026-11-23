/* 3초 여행 — Redesign Auth
 *  - Social login buttons (Google / Kakao / Apple / Naver)
 *  - Email login + signup UI (calls existing backend if available)
 *  - Profile card on My page
 *
 * NOTE: backend OAuth routes /auth/{google|kakao|naver|apple}/login are all
 * implemented in the FastAPI app.  A provider only returns 501 when its
 * credentials are missing from the backend .env — in that case the full-page
 * redirect lands on the backend's JSON error, same as any unconfigured one.
 */

import { api, startSocialLogin, getAccessToken, setAccessToken, clearAccessToken, takeHashParam } from './redesign-api-adapter.js';
import { navigate, getCurrent, getMeta } from './redesign-navigation.js';
import { $, showToast } from './redesign-ui.js';

let appState = null;
let authMode = 'login'; // 'login' | 'signup'

export function initAuth(state) {
  appState = state;

  // Social buttons — all four providers go through the same redirect flow.
  document.querySelectorAll('[data-oauth-provider]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (b.getAttribute('aria-disabled') === 'true') { showToast('이 로그인은 아직 준비 중이에요. 다른 방법으로 로그인해 주세요'); return; }
      startSocialLogin(b.dataset.oauthProvider);
    });
  });

  $('#authToggle')?.addEventListener('click', () => _setMode(authMode === 'login' ? 'signup' : 'login'));
  $('#authSubmit')?.addEventListener('click', (e) => { e.preventDefault(); _submit(); });
  $('#authForm')?.addEventListener('submit', (e) => { e.preventDefault(); _submit(); });
  $('#authCheckNick')?.addEventListener('click', () => _checkNickname());

  // Profile card buttons
  $('#profileAuthBtn')?.addEventListener('click', () => {
    if (appState.currentUser) {
      _logout();
    } else if (appState.authOffline) {
      refreshCurrentUser().then(me => showToast(me ? '다시 연결됐어요' : '아직 서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요'));
    } else {
      navigate('auth', { meta: { return: 'my' } });
    }
  });
  $('#myLogoutBtn')?.addEventListener('click', _logout);

  $('#authForgot')?.addEventListener('click', () => _showReset('request'));
  $('#resetBack')?.addEventListener('click', _hideReset);
  $('#resetForm')?.addEventListener('submit', (e) => { e.preventDefault(); _submitReset(); });
  document.addEventListener('redesign:nav', (e) => { if (e.detail?.page === 'auth') _paintNotice(); });

  _setMode('login');
  _renderProfile();
  _initResetEntry();
}

function _setMode(mode) {
  authMode = mode;
  const sub = $('#authSub'); if (sub) sub.textContent = mode === 'login' ? '소셜 계정으로 빠르게 시작' : '회원가입하고 일정을 저장하세요';
  $('#authNickRow').hidden = mode !== 'signup';
  $('#authNameRow').hidden = mode !== 'signup';
  $('#authExtraRow').hidden = mode !== 'signup';
  $('#authSubmit').textContent = mode === 'login' ? '로그인' : '회원가입';
  $('#authToggle').textContent = mode === 'login' ? '이메일 회원가입' : '이미 계정이 있어요';
}

async function _submit() {
  const email = $('#authEmail').value.trim();
  const pw    = $('#authPw').value;
  if (!email || !pw) { showToast('이메일과 비밀번호를 입력해 주세요'); return; }
  if (pw.length < 8) { showToast('비밀번호는 8자 이상이어야 해요'); return; }

  // Build the signup payload (and validate) before we flip the button to busy.
  let payload = null;
  if (authMode === 'signup') {
    const nick = $('#authNick').value.trim();
    if (!nick) { showToast('닉네임을 입력해 주세요'); return; }
    if (!/(?=.*[A-Za-z])(?=.*\d)/.test(pw)) { showToast('비밀번호는 영문과 숫자를 모두 포함해야 해요'); return; }
    payload = { email, password: pw, nickname: nick };
    const name  = $('#authName')?.value.trim();
    const phone = $('#authPhone')?.value.trim();
    const birth = $('#authBirth')?.value;          // 'YYYY-MM-DD' or ''
    if (name)  payload.name = name;
    if (phone) payload.phone = phone;
    if (birth) payload.birth_date = birth;
  }

  const btn = $('#authSubmit');
  const orig = authMode === 'login' ? '로그인' : '회원가입';
  if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
  try {
    const res = authMode === 'signup'
      ? await api.signup(payload)
      : await api.loginEmail({ email, password: pw });
    if (res?.access_token) setAccessToken(res.access_token);
    await refreshCurrentUser();                    // sets currentUser + routes to My page
    showToast(authMode === 'signup' ? '회원가입 완료! 환영해요 🎉' : '로그인되었어요');
  } catch (e) {
    showToast(_authErrorMessage(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

/** Map a backend/API error to a friendly Korean message. */
function _authErrorMessage(e) {
  if (e?.status === 401) return '이메일 또는 비밀번호가 올바르지 않습니다';
  if (e?.status === 409) return e.message || '이미 사용 중인 이메일 또는 닉네임이에요';
  if (e?.message === 'NETWORK_ERROR') return '서버에 연결할 수 없어요';
  // FastAPI 422 returns detail as an array of {msg,...}
  const detail = e?.body?.detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg.replace(/^Value error,\s*/, '');
  return e?.message || '요청을 처리하지 못했어요';
}

async function _checkNickname() {
  const nick = $('#authNick').value.trim();
  const hint = $('#authNickHint');
  const setHint = (msg, ok) => { if (hint) { hint.textContent = msg; hint.style.color = ok ? 'var(--c-success)' : 'var(--c-danger)'; } };
  if (!nick)            { setHint('닉네임을 입력해 주세요', false); return; }
  if (nick.length < 2)  { setHint('닉네임은 2자 이상이어야 해요', false); return; }
  try {
    const res = await api.checkNickname(nick);
    const available = !!res?.available;
    setHint(available ? '사용 가능한 닉네임이에요' : '이미 사용 중인 닉네임이에요', available);
  } catch (e) {
    setHint('확인 중 오류가 났어요', false);
  }
}

export async function refreshCurrentUser() {
  const hadToken = !!getAccessToken();
  try {
    const me = await api.me();
    appState.currentUser = me;
    appState.authOffline = false;
    _renderProfile();
    // 방금 로그인했다면 로그인 전에 보던 화면으로 돌아간다(만들던 일정은 그대로 이어진다).
    if (getCurrent() === 'auth') {
      const back = getMeta()?.return;
      navigate(back && back !== 'auth' ? back : 'my', { replace: true });
    }
    document.dispatchEvent(new CustomEvent('redesign:auth-ready'));
    return me;
  } catch (e) {
    if (e?.status === 401) {
      clearAccessToken();
      appState.currentUser = null;
      appState.authOffline = false;
      if (hadToken) showToast(e?.body?.detail === 'token_revoked'
        ? '비밀번호가 바뀌어 이 기기에서 로그아웃됐어요. 새 비밀번호로 다시 로그인해 주세요. 만들던 일정은 그대로 있어요'
        : '로그인이 만료됐어요. 만들던 일정은 이 기기에 그대로 있어요', 4200);
    } else {
      // 서버에 닿지 못한 경우 — 로그아웃시키지 않고 연결 문제임을 알린다.
      appState.authOffline = hadToken;
    }
    if (e?.status === 401 || !hadToken) appState.currentUser = null;
    _renderProfile();
    document.dispatchEvent(new CustomEvent('redesign:auth-ready'));
    return null;
  }
}

async function _logout() {
  try { await api.logout(); } catch (_) {}
  clearAccessToken();
  appState.currentUser = null;
  _renderProfile();
  showToast('로그아웃되었어요');
}

function _renderProfile() {
  const me = appState.currentUser;
  const name = $('#profileName');
  const mail = $('#profileEmail');
  const av   = $('#profileAvatar');
  const btn  = $('#profileAuthBtn');
  const lo   = $('#myLogoutBtn');

  if (me) {
    if (name) name.textContent = me.nickname || me.email || ('user#' + (me.id||''));
    if (mail) mail.textContent = me.email || '';
    if (av)   av.textContent = (me.nickname || me.email || '?').slice(0, 1).toUpperCase();
    if (btn)  btn.textContent = '로그아웃';
    if (lo)   lo.hidden = false;
  } else {
    const offline = !!appState.authOffline;
    if (name) name.textContent = offline ? '연결 확인 중' : '게스트';
    if (mail) mail.textContent = offline
      ? '서버에 연결하지 못해 로그인 상태를 확인하지 못했어요. 이 기기의 일정은 그대로 볼 수 있어요.'
      : '로그인하면 일정을 계정에 보관하고 다른 기기에서도 볼 수 있어요';
    if (av)   av.textContent = '3';
    if (btn)  btn.textContent = offline ? '다시 연결' : '로그인';
    if (lo)   lo.hidden = true;
  }
}

/* ============ 로그인 뒤 이어서 할 일 ============
 * 비회원이 '저장'을 눌러 로그인하러 가면, 소셜 로그인처럼 페이지를 떠났다
 * 돌아와도 하려던 일을 이어서 하도록 sessionStorage 에 남긴다(30분).
 */
const INTENT_KEY = 'tst_pending_intent_v1';
const INTENT_TTL = 30 * 60 * 1000;

export function setPendingIntent(intent) {
  try { sessionStorage.setItem(INTENT_KEY, JSON.stringify({ ...intent, at: Date.now() })); } catch (_) {}
}
export function peekPendingIntent() {
  try {
    const v = JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null');
    if (!v || Date.now() - v.at > INTENT_TTL) { sessionStorage.removeItem(INTENT_KEY); return null; }
    return v;
  } catch (_) { return null; }
}
export function clearPendingIntent() {
  try { sessionStorage.removeItem(INTENT_KEY); } catch (_) {}
}

const LOGIN_ERRORS = {
  cancelled: '로그인을 취소했어요. 만들던 일정은 이 기기에 그대로 있어요.',
  state: '로그인 확인이 만료됐어요. 한 번 더 시도해 주세요.',
  failed: '소셜 로그인에 실패했어요. 잠시 뒤 다시 시도하거나 이메일로 로그인해 주세요.',
};

/** 로그인 화면 위쪽 안내 — 왜 로그인하는지, 또는 방금 무엇이 잘못됐는지. */
function _paintNotice(extra) {
  const box = $('#authNotice');
  if (!box) return;
  const intent = peekPendingIntent();
  const parts = [];
  if (extra) parts.push(extra);
  if (intent?.action === 'save-trip') parts.push('로그인하면 만들던 일정을 바로 계정에 저장해요.');
  box.textContent = parts.join(' ');
  box.hidden = parts.length === 0;
  box.classList.toggle('is-error', !!extra);
}

/** 앱을 열 때 한 번: 소셜 로그인 오류, 비밀번호 재설정 링크를 처리한다. */
let _captured = { err: null, token: null };
/** 첫 화면 이동이 주소를 바꾸기 전에(부팅 맨 처음) 값을 꺼내 둔다. */
export function captureAuthHash() {
  _captured = { err: takeHashParam('login_error'), token: takeHashParam('reset_token') };
}
export function handleAuthReturn() {
  const err = _captured.err;
  if (err) {
    navigate('auth', { replace: true, meta: { return: peekPendingIntent()?.action === 'save-trip' ? 'schedule' : 'my' } });
    _paintNotice(LOGIN_ERRORS[err] || LOGIN_ERRORS.failed);
    showToast(LOGIN_ERRORS[err] || LOGIN_ERRORS.failed, 3600);
  }
  const token = _captured.token;
  _captured = { err: null, token: null };
  if (token) {
    resetToken = token;
    navigate('auth', { replace: true, meta: { return: 'my' } });
    _showReset('confirm');
  }
}

/* ============ 비밀번호 재설정 ============ */
let resetToken = null;
let resetMode = 'request';   // request | confirm | done

function _showReset(mode) {
  resetMode = mode;
  $('#authForm').hidden = true;
  document.querySelector('.social-stack')?.setAttribute('hidden', '');
  document.querySelector('.auth-divider')?.setAttribute('hidden', '');
  $('#resetForm').hidden = false;
  $('#resetEmailRow').hidden = mode !== 'request';
  $('#resetPwRow').hidden = mode !== 'confirm';
  $('#resetPw2Row').hidden = mode !== 'confirm';
  $('#resetSubmit').hidden = mode === 'done';
  $('#resetSubmit').textContent = mode === 'confirm' ? '새 비밀번호 저장' : '재설정 링크 받기';
  $('#resetTitle').textContent = mode === 'confirm' ? '새 비밀번호 정하기' : '비밀번호 재설정';
  $('#resetMsg').textContent = mode === 'request'
    ? '가입한 이메일로 30분 동안 쓸 수 있는 재설정 링크를 보내요. 소셜 계정으로 가입했다면 그 서비스로 로그인해 주세요.'
    : mode === 'confirm' ? '영문과 숫자를 모두 넣어 8자 이상으로 정해 주세요.' : '';
  requestAnimationFrame(() => (mode === 'confirm' ? $('#resetPw') : $('#resetEmail'))?.focus());
}

function _hideReset() {
  $('#resetForm').hidden = true;
  $('#authForm').hidden = false;
  document.querySelector('.social-stack')?.removeAttribute('hidden');
  document.querySelector('.auth-divider')?.removeAttribute('hidden');
  resetToken = null;
  $('#authForgot')?.focus();
}

async function _submitReset() {
  const msg = $('#resetMsg');
  const btn = $('#resetSubmit');
  if (resetMode === 'request') {
    const email = $('#resetEmail').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = '이메일 주소를 확인해 주세요.'; $('#resetEmail').focus(); return; }
    btn.disabled = true;
    try {
      await api.requestPasswordReset(email);
      msg.textContent = '가입된 이메일이라면 재설정 링크를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요. 링크는 30분 동안 쓸 수 있어요.';
    } catch (e) {
      msg.textContent = e?.status === 429 ? '요청이 너무 많아요. 10분 뒤 다시 시도해 주세요.'
        : e?.status === 503 ? '지금은 재설정 메일을 보낼 수 없어요. 소셜 로그인이나 문의하기를 이용해 주세요.'
        : '요청을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    } finally { btn.disabled = false; }
    return;
  }
  if (resetMode === 'confirm') {
    const pw = $('#resetPw').value, pw2 = $('#resetPw2').value;
    if (pw.length < 8 || !/(?=.*[A-Za-z])(?=.*\d)/.test(pw)) { msg.textContent = '영문과 숫자를 모두 넣어 8자 이상으로 정해 주세요.'; $('#resetPw').focus(); return; }
    if (pw !== pw2) { msg.textContent = '두 비밀번호가 달라요.'; $('#resetPw2').focus(); return; }
    btn.disabled = true;
    try {
      await api.confirmPasswordReset(resetToken, pw);
      resetToken = null;
      _showReset('done');
      msg.textContent = '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.';
      $('#resetBack').textContent = '로그인하기';
      $('#resetBack').focus();
    } catch (e) {
      msg.textContent = e?.status === 400 ? '링크가 만료되었거나 이미 사용되었어요. 재설정 링크를 다시 받아 주세요.'
        : _authErrorMessage(e);
      if (e?.status === 400) { resetToken = null; setTimeout(() => _showReset('request'), 0); setTimeout(() => { msg.textContent = '링크가 만료되었거나 이미 사용되었어요. 재설정 링크를 다시 받아 주세요.'; }, 10); }
    } finally { btn.disabled = false; }
  }
}

async function _initResetEntry() {
  const f = await api.features();
  const b = $('#authForgot');
  if (b) b.hidden = !f.passwordReset;
  // 서버에 설정되지 않은 소셜 로그인은 누르면 오류 화면으로 가므로 미리 막는다.
  if (f.oauth) document.querySelectorAll('[data-oauth-provider]').forEach(btn => {
    const on = !!f.oauth[btn.dataset.oauthProvider];
    btn.setAttribute('aria-disabled', String(!on));
    btn.classList.toggle('is-off', !on);
    if (!on && !btn.querySelector('.social-off')) btn.append(Object.assign(document.createElement('span'), { className: 'social-off', textContent: ' · 준비 중' }));
  });
}
