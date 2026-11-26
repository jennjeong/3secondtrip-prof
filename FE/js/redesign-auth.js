/* 3초 여행 — 로그인 · 회원가입 · 이메일 인증 · 비밀번호 찾기 · 로그인 상태(메뉴)
 *
 *  - 로그인(#page=auth): 이메일 → 비밀번호(보기) → 비밀번호 찾기 → 로그인 → 회원가입(보조).
 *    서버에 연결된 소셜 로그인만 아래 그룹에 보인다.
 *  - 회원가입(#page=signup): 정보 입력 → 이메일 인증(6자리 코드 또는 메일 속 링크) → 가입 완료.
 *    인증을 마쳐야 로그인 토큰이 나온다. 비밀번호는 화면 주소·저장소 어디에도 남기지 않는다.
 *  - 로그인 뒤에는 로그인하러 오기 전에 보던 화면(과 이어서 하려던 저장)으로 돌아간다.
 *  - 메뉴: <html data-auth="guest|member"> 로 웹 상단 메뉴와 하단 탭이 함께 바뀐다.
 */

import { api, startSocialLogin, getAccessToken, setAccessToken, clearAccessToken, takeHashParam } from './redesign-api-adapter.js';
import { navigate, getCurrent, getMeta, goBack } from './redesign-navigation.js';
import { $, showToast } from './redesign-ui.js';
import { PW_RULE_TEXT, checkEmail, checkNickname, checkPassword, displayName } from './redesign-auth-rules.js';

let appState = null;
const NICK_KEY = 'tst_nick_v1';          // 첫 그림에서 메뉴가 깜빡이지 않게 닉네임만 기억(토큰과 함께 지운다)
const RETURN_KEY = 'tst_auth_return_v1'; // 로그인하러 오기 전 화면 {page, meta}
const SIGNUP_KEY = 'tst_signup_v1';      // 인증 대기 중인 가입 {email, nickname, at} — 비밀번호는 넣지 않는다

const _ss = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (_) { return null; } },
  set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};

/* ============ 공통 조각 ============ */
function _err(id, msg) {
  const el = $('#' + id);
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  const input = el.closest('.acct-field')?.querySelector('input');
  if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
function _busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '처리 중…'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; btn.removeAttribute('aria-busy'); }
}
const _detail = (e) => e?.body?.detail;
const _detailCode = (e) => { const d = _detail(e); return d && typeof d === 'object' && !Array.isArray(d) ? d.code : ''; };
function _apiMessage(e, fallback) {
  if (e?.message === 'NETWORK_ERROR' || (!e?.status && !e?.body)) return '서버에 연결하지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요.';
  if (e?.status === 429) return _detail(e)?.message || '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.';
  const d = _detail(e);
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg.replace(/^Value error,\s*/, '');
  if (d && typeof d === 'object' && d.message) return d.message;
  if (typeof d === 'string' && /[가-힣]/.test(d)) return d;
  return fallback || '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

/* ============ 시작 ============ */
export function initAuth(state) {
  appState = state;

  document.querySelectorAll('[data-oauth-provider]').forEach(b => b.addEventListener('click', (e) => {
    e.preventDefault();
    startSocialLogin(b.dataset.oauthProvider);
  }));
  document.querySelectorAll('[data-pw-toggle]').forEach(b => b.addEventListener('click', () => {
    const input = $('#' + b.dataset.pwToggle);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? '숨기기' : '보기';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
  }));
  document.querySelectorAll('[data-policy]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('policy', { meta: { doc: a.dataset.policy } });
  }));

  // 입력칸 지우기(✕) — 내용이 있을 때만 보인다
  document.querySelectorAll('[data-clear]').forEach(b => {
    const input = $('#' + b.dataset.clear);
    if (!input) return;
    const sync = () => { b.hidden = !input.value; };
    input.addEventListener('input', sync);
    b.addEventListener('click', () => { input.value = ''; sync(); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); });
    sync();
  });
  // 이메일 저장 — 이 기기에만 이메일만 기억한다(비밀번호는 저장하지 않음)
  try {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved && $('#authEmail') && !$('#authEmail').value) { $('#authEmail').value = saved; $('#authEmail').dispatchEvent(new Event('input')); }
    if ($('#authRemember')) $('#authRemember').checked = !!saved;
  } catch (_) {}

  // 로그인
  $('#authForm')?.addEventListener('submit', (e) => { e.preventDefault(); _login(); });
  $('#authEmail')?.addEventListener('input', () => { _err('authEmailErr', ''); _err('authFormErr', ''); });
  $('#authPw')?.addEventListener('input', () => { _err('authPwErr', ''); _err('authFormErr', ''); });
  $('#authToSignup')?.addEventListener('click', () => {
    const email = $('#authEmail')?.value.trim();
    if (email && !$('#suEmail').value) $('#suEmail').value = email;
    navigate('signup', { meta: { from: 'auth' } });
  });

  // 회원가입
  $('#signupForm')?.addEventListener('submit', (e) => { e.preventDefault(); _signup(); });
  $('#signupBack')?.addEventListener('click', _signupBack);
  $('#signupLogin')?.addEventListener('click', () => _toLogin());
  $('#suPw')?.addEventListener('input', () => {
    const v = $('#suPw').value;
    _err('suPwErr', v ? checkPassword(v) : '');
    if ($('#suPw2').value) _err('suPw2Err', v === $('#suPw2').value ? '' : '두 비밀번호가 달라요.');
  });
  $('#suPw2')?.addEventListener('input', () => _err('suPw2Err', $('#suPw2').value && $('#suPw2').value !== $('#suPw').value ? '두 비밀번호가 달라요.' : ''));
  $('#suEmail')?.addEventListener('input', () => _err('suEmailErr', ''));
  $('#suNick')?.addEventListener('input', () => _err('suNickErr', ''));
  $('#suAgreeAll')?.addEventListener('change', (e) => { document.querySelectorAll('[data-consent]').forEach(c => { c.checked = e.target.checked; }); _err('suConsentErr', ''); });
  document.querySelectorAll('[data-consent]').forEach(c => c.addEventListener('change', () => {
    $('#suAgreeAll').checked = [...document.querySelectorAll('[data-consent]')].every(x => x.checked);
    _err('suConsentErr', '');
  }));
  const rule = $('#suPwRule'); if (rule) rule.textContent = PW_RULE_TEXT;
  const rrule = $('#resetPwRule'); if (rrule) rrule.textContent = PW_RULE_TEXT;

  // 이메일 인증
  $('#verifyForm')?.addEventListener('submit', (e) => { e.preventDefault(); _verifyCode(); });
  $('#verifyCode')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    _err('verifyErr', '');
    if (e.target.value.length === 6) _verifyCode();
  });
  $('#verifyResend')?.addEventListener('click', _resend);
  $('#verifyEdit')?.addEventListener('click', () => _step('info', { focus: '#suEmail' }));
  $('#signupContinue')?.addEventListener('click', () => _goReturn());

  // 비밀번호 찾기
  $('#authForgot')?.addEventListener('click', () => _showReset('request'));
  $('#resetBack')?.addEventListener('click', () => _hideReset());
  $('#resetForm')?.addEventListener('submit', (e) => { e.preventDefault(); _submitReset(); });

  // 정책 문서
  $('#policyBack')?.addEventListener('click', () => goBack());

  // 마이 화면 버튼
  $('#profileAuthBtn')?.addEventListener('click', () => {
    if (appState.currentUser) _logout();
    else if (appState.authOffline) refreshCurrentUser().then(me => showToast(me ? '다시 연결됐어요' : '아직 서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요'));
    else navigate('auth', { meta: { return: 'my' } });
  });
  $('#myLogoutBtn')?.addEventListener('click', _logout);

  document.addEventListener('redesign:nav', (e) => {
    const { page, meta } = e.detail || {};
    if (page === 'auth') {
      if (meta?.return) _ss.set(RETURN_KEY, _normReturn(meta.return));
      if (appState.currentUser) { _goReturn(); return; }
      _paintNotice(); _hideReset(true);
    }
    if (page === 'signup') _enterSignup(meta);
    if (page === 'policy') _showPolicy(meta?.doc);
  });

  _renderProfile();
  _initFeatures();
}

/* ============ 로그인 뒤 돌아갈 곳 ============ */
function _normReturn(r) {
  if (!r) return null;
  if (typeof r === 'string') return { page: r, meta: {} };
  return r.page ? { page: r.page, meta: r.meta || {} } : null;
}
function _goReturn() {
  const r = _ss.get(RETURN_KEY);
  _ss.set(RETURN_KEY, null);
  const page = r?.page && !['auth', 'signup', 'policy'].includes(r.page) ? r.page : 'my';
  navigate(page, { replace: true, meta: r?.meta || {} });
}
function _toLogin() {
  if ((getMeta() || {}).from === 'auth') goBack();     // 로그인 화면에서 왔다면 뒤로 = 로그인
  else navigate('auth', { replace: true });
}

/* ============ 로그인 ============ */
let _loginBusy = false;
async function _login() {
  if (_loginBusy) return;
  const email = $('#authEmail').value.trim();
  const pw = $('#authPw').value;
  const eErr = checkEmail(email);
  _err('authEmailErr', eErr);
  _err('authPwErr', pw ? '' : '비밀번호를 입력해 주세요.');
  _err('authFormErr', '');
  if (eErr) { $('#authEmail').focus(); return; }
  if (!pw) { $('#authPw').focus(); return; }
  _loginBusy = true;
  const btn = $('#authSubmit');
  _busy(btn, true, '로그인 중…');
  try {
    const res = await api.loginEmail({ email, password: pw });
    if (res?.access_token) setAccessToken(res.access_token);
    try { if ($('#authRemember')?.checked) localStorage.setItem(REMEMBER_KEY, email); else localStorage.removeItem(REMEMBER_KEY); } catch (_) {}
    $('#authPw').value = ''; $('#authPw').dispatchEvent(new Event('input'));
    await refreshCurrentUser({ fromLogin: true });
    showToast('로그인되었어요');
  } catch (e) {
    if (e?.status === 401) _err('authFormErr', '이메일 또는 비밀번호가 맞지 않아요. 다시 확인하거나 비밀번호 찾기를 이용해 주세요.');
    else if (_detailCode(e) === 'email_unverified') {
      // 가입은 했지만 인증 전 — 인증 화면으로(코드를 다시 받을 수 있다)
      _ss.set(SIGNUP_KEY, { email, nickname: '', at: Date.now(), resendAt: Date.now() + (Number(_detail(e)?.resend_after) || 0) * 1000 });
      $('#suEmail').value = email;
      $('#authPw').value = '';
      navigate('signup', { meta: { from: 'auth', step: 'verify' } });
      showToast('이메일 인증을 마쳐야 로그인할 수 있어요', 3200);
    } else _err('authFormErr', _apiMessage(e));
  } finally {
    _busy(btn, false);
    _loginBusy = false;
  }
}

/* ============ 회원가입 ============ */
let _signupStep = 'info';
function _step(step, { focus } = {}) {
  _signupStep = step;
  $('#signupForm').hidden = step !== 'info';
  $('#verifyForm').hidden = step !== 'verify';
  $('#signupDone').hidden = step !== 'done';
  $('#signupToLogin').hidden = step === 'done';
  document.querySelectorAll('.acct-steps li').forEach(li => {
    if (li.dataset.step === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  if (step === 'verify') _paintVerify();
  requestAnimationFrame(() => { const f = focus ? $(focus) : (step === 'verify' ? $('#verifyCode') : step === 'done' ? $('#signupContinue') : null); f?.focus(); });
}

function _enterSignup(meta) {
  if (appState.currentUser && _signupStep !== 'done') { navigate('my', { replace: true }); return; }
  const pending = _ss.get(SIGNUP_KEY);
  if (_signupStep === 'done' && appState.currentUser) _step('done');
  else if ((meta?.step === 'verify' || _signupStep === 'verify') && pending) _step('verify');
  else _step('info');
}

function _signupBack() {
  if (_signupStep === 'verify') { _step('info'); return; }
  _toLogin();
}

let _signupBusy = false;
async function _signup() {
  if (_signupBusy) return;
  const email = $('#suEmail').value.trim(), pw = $('#suPw').value, pw2 = $('#suPw2').value, nick = $('#suNick').value.trim();
  const errs = {
    suEmailErr: checkEmail(email),
    suPwErr: checkPassword(pw),
    suPw2Err: !pw2 ? '비밀번호를 한 번 더 입력해 주세요.' : pw2 !== pw ? '두 비밀번호가 달라요.' : '',
    suNickErr: checkNickname(nick),
    suConsentErr: [...document.querySelectorAll('[data-consent]')].every(c => c.checked) ? '' : '[필수] 항목에 모두 동의해야 가입할 수 있어요.',
  };
  Object.entries(errs).forEach(([k, v]) => _err(k, v));
  _err('suFormErr', '');
  const first = Object.entries(errs).find(([, v]) => v);
  if (first) { ({ suEmailErr: $('#suEmail'), suPwErr: $('#suPw'), suPw2Err: $('#suPw2'), suNickErr: $('#suNick'), suConsentErr: $('#suAgreeAge') })[first[0]]?.focus(); return; }
  _signupBusy = true;
  const btn = $('#suSubmit');
  _busy(btn, true, '보내는 중…');
  try {
    const r = await api.signup({ email, password: pw, nickname: nick, agree_terms: true, agree_privacy: true, agree_age: true });
    _ss.set(SIGNUP_KEY, { email: r?.email || email, nickname: nick, at: Date.now(), resendAt: Date.now() + (Number(r?.resend_after) || 0) * 1000, devCode: r?.dev_code || null, sent: !!r?.sent });
    $('#suPw').value = ''; $('#suPw2').value = '';       // 비밀번호는 인증 단계로 가져가지 않는다
    _step('verify');
  } catch (e) {
    const msg = _apiMessage(e);
    if (e?.status === 409 && /닉네임/.test(msg)) { _err('suNickErr', msg); $('#suNick').focus(); }
    else if (e?.status === 409) { _err('suEmailErr', msg); $('#suEmail').focus(); }
    else if (e?.status === 422 && /비밀번호/.test(msg)) { _err('suPwErr', msg); $('#suPw').focus(); }
    else _err('suFormErr', msg);
  } finally {
    _busy(btn, false);
    _signupBusy = false;
  }
}

/* ============ 이메일 인증 ============ */
let _resendTimer = 0;
function _paintVerify() {
  const p = _ss.get(SIGNUP_KEY) || {};
  const lead = $('#verifyLead');
  if (lead) lead.replaceChildren(
    document.createTextNode('아래 주소로 6자리 인증 코드를 보냈어요. 15분 동안 쓸 수 있어요.'),
    Object.assign(document.createElement('strong'), { className: 'acct-mail', textContent: p.email || '' }),
  );
  const hint = $('#verifyHint');
  if (hint) hint.textContent = p.devCode
    ? `개발용 서버라 메일 대신 여기에 코드를 보여 드려요: ${p.devCode}`
    : '메일이 안 보이면 스팸함을 확인하거나 코드를 다시 받아 주세요. 다른 기기에서는 메일 속 링크를 눌러도 인증돼요.';
  _tickResend();
}
function _tickResend() {
  clearInterval(_resendTimer);
  const b = $('#verifyResend');
  const paint = () => {
    const p = _ss.get(SIGNUP_KEY) || {};
    const left = Math.ceil(((p.resendAt || 0) - Date.now()) / 1000);
    if (!b) return;
    b.disabled = left > 0;
    b.textContent = left > 0 ? `코드 다시 받기 (${left}초)` : '코드 다시 받기';
    if (left <= 0) clearInterval(_resendTimer);
  };
  paint();
  _resendTimer = setInterval(paint, 1000);
}

let _verifyBusy = false;
async function _verifyCode() {
  if (_verifyBusy) return;
  const p = _ss.get(SIGNUP_KEY) || {};
  const code = $('#verifyCode').value.trim();
  if (!/^\d{6}$/.test(code)) { _err('verifyErr', '메일로 받은 6자리 숫자를 넣어 주세요.'); return; }
  _verifyBusy = true;
  const btn = $('#verifySubmit');
  _busy(btn, true, '확인 중…');
  try {
    const res = await api.verifyEmail({ email: p.email, code });
    await _verified(res);
  } catch (e) {
    const c = _detailCode(e);
    _err('verifyErr', _apiMessage(e));
    if (c === 'already_verified') { _ss.set(SIGNUP_KEY, null); _toLogin(); showToast('이미 인증된 계정이에요. 로그인해 주세요', 3200); }
    else if (c === 'locked' || c === 'expired') $('#verifyResend')?.focus();
    else $('#verifyCode').select?.();
  } finally {
    _busy(btn, false);
    _verifyBusy = false;
  }
}

async function _verified(res) {
  if (res?.access_token) setAccessToken(res.access_token);
  const intent = peekPendingIntent();
  if (intent) setPendingIntent({ ...intent, viaSignup: true });   // 저장하러 왔다면 가입 완료를 알리고 곧장 그 일정으로
  _ss.set(SIGNUP_KEY, null);
  $('#verifyCode').value = '';
  _step('done');
  await refreshCurrentUser({ stay: true });
  const lead = $('#signupDoneLead');
  if (lead) lead.textContent = `${displayName(appState.currentUser)}님, 가입을 마쳤어요. 이메일 인증 완료 상태로 로그인됐어요.`;
  const r = _ss.get(RETURN_KEY);
  const cont = $('#signupContinue');
  if (cont) cont.textContent = r?.page === 'schedule' ? '만들던 일정으로 돌아가기' : r?.page === 'create-trip' ? '만들던 여행으로 돌아가기' : '계속하기';
}

let _resendBusy = false;
async function _resend() {
  if (_resendBusy) return;
  const p = _ss.get(SIGNUP_KEY) || {};
  if (!p.email) { _step('info'); return; }
  _resendBusy = true;
  try {
    const r = await api.resendVerification(p.email);
    _ss.set(SIGNUP_KEY, { ...p, resendAt: Date.now() + (Number(r?.resend_after) || 60) * 1000, devCode: r?.dev_code || null });
    _err('verifyErr', '');
    _paintVerify();
    showToast('새 인증 코드를 보냈어요. 이전 코드는 더 쓸 수 없어요');
  } catch (e) {
    const wait = Number(_detail(e)?.retry_after) || 0;
    if (wait) _ss.set(SIGNUP_KEY, { ...p, resendAt: Date.now() + wait * 1000 });
    _err('verifyErr', _apiMessage(e));
    _tickResend();
  } finally { _resendBusy = false; }
}

/* ============ 로그인 상태 ============ */
export async function refreshCurrentUser({ fromLogin = false, stay = false } = {}) {
  const hadToken = !!getAccessToken();
  try {
    const me = await api.me();
    appState.currentUser = me;
    appState.authOffline = false;
    _renderProfile();
    // 방금 로그인했다면 로그인하러 오기 전에 보던 화면으로 돌아간다(만들던 일정은 그대로 이어진다).
    if (!stay && ['auth', 'signup'].includes(getCurrent())) _goReturn();
    document.dispatchEvent(new CustomEvent('redesign:auth-ready'));
    return me;
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) {
      clearAccessToken();
      appState.currentUser = null;
      appState.authOffline = false;
      if (hadToken && !fromLogin) showToast(e?.body?.detail === 'token_revoked'
        ? '비밀번호가 바뀌어 이 기기에서 로그아웃됐어요. 새 비밀번호로 다시 로그인해 주세요. 만들던 일정은 그대로 있어요'
        : '로그인이 만료됐어요. 만들던 일정은 이 기기에 그대로 있어요', 4200);
    } else {
      appState.authOffline = hadToken;       // 서버에 닿지 못함 — 로그아웃시키지 않는다
    }
    if (e?.status === 401 || e?.status === 403 || !hadToken) appState.currentUser = null;
    _renderProfile();
    document.dispatchEvent(new CustomEvent('redesign:auth-ready'));
    return null;
  }
}

/** 서버 호출 없이 이 기기의 로그인 상태만 지운다(모든 기기 로그아웃·계정 삭제 뒤 등). */
export function signOutLocally(message) {
  clearAccessToken();
  appState.currentUser = null;
  // 계정에 저장된 일정은 이 기기 화면에서 내린다 — 다음 사람(다른 계정)이 이전 계정의 일정을 보지 않게.
  // 로그인하지 않고 만든(계정과 연결되지 않은) 일정은 이 기기 것이라 그대로 둔다.
  if (appState.generated?.savedScheduleId) {
    appState.generated = null;
    document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
    if (getCurrent() === 'schedule') navigate('home', { replace: true });
  }
  _renderProfile();
  document.dispatchEvent(new CustomEvent('redesign:auth-ready'));
  if (message) showToast(message, 3600);
}

async function _logout() {
  try { await api.logout(); } catch (_) {}
  signOutLocally();
  // 회원 전용 화면에 있었다면 홈으로 — 이전 계정의 내용이 화면에 남지 않게
  if (['my', 'my-saved', 'my-roadmaps', 'my-reviews', 'my-blogs'].includes(getCurrent())) navigate('home', { replace: true });
  showToast('로그아웃되었어요');
}

/** 메뉴(웹 상단·앱 하단)와 마이 카드를 로그인 상태에 맞춘다. 닉네임이 바뀔 때도 이걸 부른다. */
export function paintAuthState() { _renderProfile(); }

function _renderProfile() {
  const me = appState?.currentUser;
  const offline = !!appState?.authOffline;
  const root = document.documentElement;
  // 연결이 안 돼 확인하지 못했지만 토큰이 있으면 회원 메뉴를 유지한다(깜빡이지 않게)
  root.dataset.auth = me || (offline && getAccessToken()) ? 'member' : 'guest';
  let label = '내 계정';
  try {
    if (me) { label = displayName(me); localStorage.setItem(NICK_KEY, label); }
    else if (getAccessToken()) label = localStorage.getItem(NICK_KEY) || label;
    else localStorage.removeItem(NICK_KEY);
  } catch (_) { if (me) label = displayName(me); }
  document.querySelectorAll('[data-nick-label]').forEach(n => { n.textContent = label; n.title = label; });

  const name = $('#profileName'), mail = $('#profileEmail'), av = $('#profileAvatar'), btn = $('#profileAuthBtn'), lo = $('#myLogoutBtn');
  if (me) {
    if (name) name.textContent = me.nickname || me.email || '내 계정';
    if (mail) mail.textContent = [me.email, me.provider === 'local' && me.email_verified_at ? '이메일 인증 완료' : ''].filter(Boolean).join(' · ');
    if (av) av.textContent = (me.nickname || me.email || '?').slice(0, 1).toUpperCase();
    if (btn) btn.textContent = '로그아웃';
    if (lo) lo.hidden = false;
  } else {
    if (name) name.textContent = offline ? '연결 확인 중' : '게스트';
    if (mail) mail.textContent = offline
      ? '서버에 연결하지 못해 로그인 상태를 확인하지 못했어요. 이 기기의 일정은 그대로 볼 수 있어요.'
      : '로그인하면 일정을 계정에 보관하고 다른 기기에서도 볼 수 있어요';
    if (av) av.textContent = '3';
    if (btn) btn.textContent = offline ? '다시 연결' : '로그인';
    if (lo) lo.hidden = true;
  }
}

/* ============ 로그인 뒤 이어서 할 일 ============
 * 비회원이 '저장'을 눌러 로그인하러 가면, 가입·인증처럼 시간이 걸려도
 * 돌아와서 하려던 일을 이어서 하도록 sessionStorage 에 남긴다(30분).
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
  cancelled: '로그인을 취소했어요. 만들던 일정은 이 기기에 그대로 있어요. 이메일로 로그인하거나 다시 시도해 주세요.',
  state: '로그인 확인이 만료됐어요. 한 번 더 시도해 주세요.',
  failed: '소셜 로그인에 실패했어요. 잠시 뒤 다시 시도하거나 이메일로 로그인해 주세요.',
};

function _paintNotice(extra) {
  const box = $('#authNotice');
  if (!box) return;
  const intent = peekPendingIntent();
  const parts = [];
  if (extra) parts.push(extra);
  if (intent?.action === 'save-trip') parts.push('로그인하면 만들던 일정을 바로 계정에 저장해요. 가입 중이어도 일정은 이 기기에 그대로 있어요.');
  box.textContent = parts.join(' ');
  box.hidden = parts.length === 0;
  box.classList.toggle('is-error', !!extra);
}

/* 앱을 열 때 한 번: 소셜 로그인 오류, 비밀번호 재설정 링크, 이메일 인증 링크를 꺼내 둔다(첫 화면 이동 전에). */
let _captured = { err: null, token: null, verify: null };
export function captureAuthHash() {
  _captured = { err: takeHashParam('login_error'), token: takeHashParam('reset_token'), verify: takeHashParam('verify_token') };
}
export function handleAuthReturn() {
  const { err, token, verify } = _captured;
  _captured = { err: null, token: null, verify: null };
  if (err) { navigate('auth', { replace: true }); _paintNotice(LOGIN_ERRORS[err] || LOGIN_ERRORS.failed); }
  if (token) { resetToken = token; navigate('auth', { replace: true, meta: { return: 'my' } }); _showReset('confirm'); }
  if (verify) _verifyLink(verify);
}

async function _verifyLink(token) {
  navigate('signup', { replace: true, meta: {} });
  _step('verify');
  const lead = $('#verifyLead'); if (lead) lead.textContent = '메일 속 링크로 인증하는 중이에요…';
  const parts = $('#verifyForm').querySelectorAll('.acct-field, #verifySubmit, .acct-row-split');
  parts.forEach(n => { n.hidden = true; });
  try {
    const res = await api.verifyEmail({ token });
    await _verified(res);
  } catch (e) {
    if (_detailCode(e) === 'already_verified') { navigate('auth', { replace: true }); _paintNotice('이미 인증을 마친 링크예요. 로그인해 주세요.'); }
    else { _step('info'); _err('suFormErr', '인증 링크가 만료되었거나 올바르지 않아요. 이미 가입했다면 로그인하면 인증 화면으로 이어지고, 새 코드를 받을 수 있어요.'); }
  } finally {
    parts.forEach(n => { n.hidden = false; });
  }
}

/* ============ 비밀번호 찾기 ============ */
let resetToken = null;
let resetMode = 'request';   // request | confirm | done
const REMEMBER_KEY = 'tst_saved_email_v1';

function _showReset(mode) {
  resetMode = mode;
  $('#authForm').hidden = true;
  $('#authSocial').hidden = true;
  if ($('#authSwitch')) $('#authSwitch').hidden = true;
  $('#resetForm').hidden = false;
  $('#resetEmailRow').hidden = mode !== 'request';
  $('#resetPwRow').hidden = mode !== 'confirm';
  $('#resetPw2Row').hidden = mode !== 'confirm';
  $('#resetSubmit').hidden = mode === 'done';
  $('#resetSubmit').textContent = mode === 'confirm' ? '새 비밀번호 저장' : '재설정 링크 받기';
  $('#resetTitle').textContent = mode === 'confirm' ? '새 비밀번호 정하기' : mode === 'done' ? '비밀번호를 바꿨어요' : '비밀번호 찾기';
  $('#resetBack').textContent = mode === 'done' ? '로그인하기' : '로그인으로 돌아가기';
  if (mode === 'request' && !$('#resetEmail').value) $('#resetEmail').value = $('#authEmail').value.trim();
  $('#resetMsg').textContent = mode === 'request'
    ? '가입한 이메일로 30분 동안 쓸 수 있는 재설정 링크를 보내요.'
    : mode === 'confirm' ? '' : '새 비밀번호로 로그인해 주세요. 다른 기기의 로그인은 모두 끊었어요.';
  requestAnimationFrame(() => (mode === 'confirm' ? $('#resetPw') : mode === 'done' ? $('#resetBack') : $('#resetEmail'))?.focus());
}

function _hideReset(silent) {
  if ($('#resetForm').hidden) return;
  $('#resetForm').hidden = true;
  $('#authForm').hidden = false;
  $('#authSocial').hidden = !_socialOn;
  if ($('#authSwitch')) $('#authSwitch').hidden = false;
  resetToken = null;
  if (silent !== true) $('#authForgot')?.focus();
}

let _resetBusy = false;
async function _submitReset() {
  if (_resetBusy) return;
  const msg = $('#resetMsg');
  const btn = $('#resetSubmit');
  if (resetMode === 'request') {
    const email = $('#resetEmail').value.trim();
    const eErr = checkEmail(email);
    if (eErr) { msg.textContent = eErr; $('#resetEmail').focus(); return; }
    _resetBusy = true; _busy(btn, true, '보내는 중…');
    try {
      await api.requestPasswordReset(email);
      msg.textContent = '가입된 이메일이라면 재설정 링크를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요. 링크는 30분 동안 쓸 수 있어요. 오지 않으면 몇 분 뒤 다시 요청해 주세요.';
    } catch (e) {
      msg.textContent = e?.status === 503 ? '지금은 재설정 메일을 보낼 수 없어요. 마이 › 의견 보내기로 알려 주시면 도와드릴게요.' : _apiMessage(e);
    } finally { _busy(btn, false); _resetBusy = false; }
    return;
  }
  if (resetMode === 'confirm') {
    const pw = $('#resetPw').value, pw2 = $('#resetPw2').value;
    const pErr = checkPassword(pw);
    if (pErr) { msg.textContent = pErr; $('#resetPw').focus(); return; }
    if (pw !== pw2) { msg.textContent = '두 비밀번호가 달라요.'; $('#resetPw2').focus(); return; }
    _resetBusy = true; _busy(btn, true, '저장하는 중…');
    try {
      await api.confirmPasswordReset(resetToken, pw);
      resetToken = null;
      $('#resetPw').value = ''; $('#resetPw2').value = '';
      _showReset('done');
    } catch (e) {
      if (e?.status === 400) {
        resetToken = null;
        _showReset('request');
        msg.textContent = '링크가 만료되었거나 이미 사용되었어요. 재설정 링크를 다시 받아 주세요.';
      } else msg.textContent = _apiMessage(e);
    } finally { _busy(btn, false); _resetBusy = false; }
  }
}

/* ============ 정책 문서 ============ */
const POLICY = { terms: { title: '이용약관', url: 'terms.html' }, privacy: { title: '개인정보 처리방침', url: 'privacy.html' } };
async function _showPolicy(doc) {
  const d = POLICY[doc] || POLICY.terms;
  const title = $('#policyTitle'); if (title) title.textContent = d.title;
  document.title = `${d.title} · 3초 여행`;
  const box = $('#policyDoc');
  if (!box) return;
  box.replaceChildren(Object.assign(document.createElement('p'), { textContent: '불러오는 중…' }));
  try {
    const html = await fetch(d.url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); });
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const art = parsed.querySelector('main article') || parsed.querySelector('main');
    art?.querySelectorAll('h1, script').forEach(h => h.remove());
    box.replaceChildren(...[...(art?.childNodes || [])].map(n => document.importNode(n, true)));
  } catch (_) {
    const a = Object.assign(document.createElement('a'), { href: d.url, target: '_blank', rel: 'noopener', textContent: '새 창에서 열기' });
    box.replaceChildren(Object.assign(document.createElement('p'), { textContent: '문서를 불러오지 못했어요. 연결을 확인하고 다시 열거나 ' }), a);
  }
}

/* ============ 서버 기능 ============ */
let _socialOn = false;
async function _initFeatures() {
  const f = await api.features();
  const forgot = $('#authForgot'); if (forgot) forgot.hidden = !f.passwordReset;
  let any = false;       // 서버에 연결된 소셜 로그인만 보인다
  document.querySelectorAll('[data-oauth-provider]').forEach(b => {
    const on = !!f.oauth?.[b.dataset.oauthProvider];
    b.hidden = !on; any = any || on;
  });
  _socialOn = any;
  const box = $('#authSocial'); if (box && $('#resetForm').hidden) box.hidden = !any;
  if (f.emailSignup === false && !f.unknown) {
    const b = $('#suSubmit'); if (b) { b.disabled = true; b.title = '지금은 가입할 수 없어요'; }
    _err('suFormErr', '인증 메일을 보낼 수 없어 지금은 가입을 받지 않아요. 잠시 뒤 다시 시도해 주세요.');
  }
}
