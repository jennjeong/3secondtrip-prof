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

import { api, startSocialLogin, getAccessToken, clearAccessToken } from './redesign-api-adapter.js';
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

  if (authMode === 'signup') {
    const nick = $('#authNick').value.trim();
    if (!nick) { showToast('닉네임을 입력해 주세요'); return; }
    // Email/password signup: stub — wire to backend when /auth/email/signup exists
    showToast('회원가입은 소셜 로그인을 사용해 주세요');
    return;
  }
  // Email/password login: stub — wire to backend when /auth/email/login exists
  showToast('이메일 로그인은 소셜 로그인을 사용해 주세요');
}

async function _checkNickname() {
  const nick = $('#authNick').value.trim();
  const hint = $('#authNickHint');
  if (!nick) { if (hint) { hint.textContent = '닉네임을 입력해 주세요'; hint.style.color = 'var(--c-danger)'; } return; }
  // TODO: when backend has /auth/check-nickname, call it.  Best-effort fallback:
  if (hint) { hint.textContent = '사용 가능한 닉네임이에요'; hint.style.color = 'var(--c-success)'; }
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
