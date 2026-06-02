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

import { api, startSocialLogin, getAccessToken, setAccessToken, clearAccessToken } from './redesign-api-adapter.js';
import { navigate, getCurrent } from './redesign-navigation.js';
import { $, showToast } from './redesign-ui.js';

let appState = null;
let authMode = 'login'; // 'login' | 'signup'

export function initAuth(state) {
  appState = state;

  // Social buttons — all four providers go through the same redirect flow.
  document.querySelectorAll('[data-oauth-provider]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
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
    } else {
      navigate('auth');
    }
  });
  $('#myLogoutBtn')?.addEventListener('click', _logout);

  _setMode('login');
  _renderProfile();
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
  try {
    const me = await api.me();
    appState.currentUser = me;
    _renderProfile();
    // If user just logged in, route to my page
    if (getCurrent() === 'auth') navigate('my', { replace: true });
    return me;
  } catch (e) {
    if (e?.status === 401) clearAccessToken();
    appState.currentUser = null;
    _renderProfile();
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
    if (name) name.textContent = '게스트';
    if (mail) mail.textContent = '로그인하면 일정을 저장할 수 있어요';
    if (av)   av.textContent = '3';
    if (btn)  btn.textContent = '로그인';
    if (lo)   lo.hidden = true;
  }
}
