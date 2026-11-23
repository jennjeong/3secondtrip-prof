/* 3초 여행 — 설정 시트
 *  - 화면 테마: 시스템 / 라이트 / 다크
 *  - 알림: 지원 여부와 브라우저 권한을 그대로 보여 준다(앱은 아직 알림을 보내지 않음)
 *  - 언어: 한국어만 번역돼 있어 다른 언어는 '준비 중'으로 안내
 *  - 이 기기 데이터 초기화: 무엇이 지워지고 무엇이 남는지 먼저 보여 준다
 */

import { $, $$, el, showToast } from './redesign-ui.js';
import { api, setAccessToken } from './redesign-api-adapter.js';
import { signOutLocally } from './redesign-auth.js';

const THEME_KEY = 'tst_theme_v1';
const OLD_DARK_KEY = 'tst_dark_v1';
const LANG_KEY = 'tst_lang_v1';

let appState = null;

/* ============ 테마 ============ */
function _theme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'system' || v === 'light' || v === 'dark') return v;
    // 기본은 기기 설정을 따른다(홈 화면 앱 시작 이미지와 같은 밝기).
    // 예전 '다크 모드' 토글을 직접 끈 사람('0')만 라이트로 둔다.
    return localStorage.getItem(OLD_DARK_KEY) === '0' ? 'light' : 'system';
  } catch (_) { return 'light'; }
}
const _sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function applyTheme(mode = _theme()) {
  const r = document.documentElement;
  r.classList.toggle('allow-dark', mode === 'system');   // 시스템 설정을 따른다
  r.classList.toggle('theme-dark', mode === 'dark');     // 항상 어둡게
  const dark = mode === 'dark' || (mode === 'system' && _sysDark());
  r.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111418' : '#F4F5F7');
  const note = $('#themeNote');
  if (note) note.textContent = mode === 'system'
    ? `기기 설정을 따라요 · 지금은 ${_sysDark() ? '다크' : '라이트'}`
    : mode === 'dark' ? '항상 어두운 화면으로 보여요' : '항상 밝은 화면으로 보여요';
}

/* ============ 알림 ============ */
function _paintNoti() {
  const box = $('#notiNote');
  if (!box) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  let support;
  if (!('Notification' in window)) {
    support = ios && !standalone
      ? '이 브라우저에서는 웹 알림을 쓸 수 없어요(iPhone은 홈 화면에 추가한 앱에서만 지원).'
      : '이 브라우저는 웹 알림을 지원하지 않아요.';
  } else {
    const p = Notification.permission;
    support = p === 'granted' ? '브라우저 알림 권한: 허용됨'
      : p === 'denied' ? '브라우저 알림 권한: 차단됨 (브라우저 설정에서 바꿀 수 있어요)'
      : '브라우저 알림 권한: 아직 묻지 않음';
  }
  box.textContent = `3초 여행은 아직 알림을 보내지 않아요(준비 중). ${support}`;
}

/* ============ 초기화 ============ */
function _has(k) { try { return localStorage.getItem(k) != null; } catch (_) { return false; } }

function _resetItems() {
  const g = appState?.generated;
  const items = [];
  items.push(g
    ? `지금 보고 있는 일정${g.city ? ` (${g.city})` : ''}${g.savedScheduleId ? ' — 계정에도 저장돼 있어요' : ' — 계정에 저장하지 않아 복구할 수 없어요'}`
    : '이 기기에 저장된 일정 (지금은 없음)');
  if (_has('tst_app_state_v1')) items.push('작성 중인 새 여행 초안 · 지출 기록 · 예약 후보');
  if (_has('tst_blog_draft_v1')) items.push('블로그 초안');
  if (_has('tst_reviews_v1')) items.push('이 기기에만 있는 후기');
  if (_has('tst_feedback_log_v1')) items.push('보낸 피드백의 기기 사본');
  if (_has('tst_pref_v1')) items.push('취향 분석 결과');
  if (_has('tst_collab_manage_v1')) items.push('공유 링크 관리 권한 — 이 기기에서 만든 공유 링크를 더는 회수할 수 없어요');
  items.push('설정 (테마)');
  items.push(appState?.currentUser ? '로그인 상태 — 이 기기에서 로그아웃돼요' : '로그인 기록');
  return { items, risky: !!(g && !g.savedScheduleId) };
}

function _openReset() {
  const panel = $('#resetPanel');
  if (!panel) return;
  const { items, risky } = _resetItems();
  const list = $('#resetList');
  list.innerHTML = '';
  items.forEach(t => list.appendChild(el('li', {}, t)));
  const warn = $('#resetWarn');
  warn.hidden = !risky;
  warn.textContent = risky ? '계정에 저장하지 않은 일정이 있어요. 남기려면 먼저 로그인해서 저장해 주세요.' : '';
  panel.hidden = false;
  $('#settingReset')?.setAttribute('aria-expanded', 'true');
  panel.scrollIntoView({ block: 'nearest' });
  $('#resetCancel')?.focus();
}

function _closeReset() {
  const panel = $('#resetPanel');
  if (panel) panel.hidden = true;
  $('#settingReset')?.setAttribute('aria-expanded', 'false');
  $('#settingReset')?.focus();
}

function _doReset() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tst_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    try { sessionStorage.clear(); } catch (_) {}
    showToast('이 기기의 3초 여행 데이터를 지웠어요. 새로 고칠게요');
    setTimeout(() => location.reload(), 700);
  } catch (e) { showToast('지우지 못했어요. 브라우저 설정에서 사이트 데이터를 지워 주세요'); }
}

/* ============ 계정: 비밀번호 변경 · 모든 기기에서 로그아웃 ============ */
function _paintAccount() {
  const me = appState?.currentUser;
  const box = $('#accountSettings');
  if (!box) return;
  box.hidden = !me;
  if (!me) return;
  const local = me.provider === 'local';
  $('#settingPw').hidden = !local;
  $('#pwSocialNote').hidden = local;
  _togglePanel('pwPanel', 'settingPw', false);
  _togglePanel('logoutAllPanel', 'settingLogoutAll', false);
}

function _togglePanel(panelId, btnId, open) {
  const panel = $('#' + panelId), btn = $('#' + btnId);
  if (!panel) return;
  panel.hidden = !open;
  btn?.setAttribute('aria-expanded', String(open));
}

function _errText(e, fallback) {
  const d = e?.body?.detail;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg.replace(/^Value error,\s*/, '');
  if (typeof d === 'string' && d !== 'token_revoked') return d;
  if (e?.status === 429) return '시도가 너무 많아요. 10분 뒤 다시 해 주세요.';
  if (e?.status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  return fallback;
}

async function _changePassword(ev) {
  ev?.preventDefault();
  const msg = $('#pwMsg');
  const cur = $('#pwCurrent').value, nw = $('#pwNew').value, nw2 = $('#pwNew2').value;
  if (!cur) { msg.textContent = '현재 비밀번호를 입력해 주세요.'; $('#pwCurrent').focus(); return; }
  if (nw.length < 8 || !/(?=.*[A-Za-z])(?=.*\d)/.test(nw)) { msg.textContent = '새 비밀번호는 영문과 숫자를 모두 넣어 8자 이상으로 정해 주세요.'; $('#pwNew').focus(); return; }
  if (nw !== nw2) { msg.textContent = '새 비밀번호 두 칸이 달라요.'; $('#pwNew2').focus(); return; }
  const btn = $('#pwSave'); btn.disabled = true;
  try {
    const res = await api.changePassword(cur, nw);
    if (res?.access_token) setAccessToken(res.access_token);   // 이 기기는 로그인 유지
    ['#pwCurrent', '#pwNew', '#pwNew2'].forEach(s => { $(s).value = ''; });
    msg.textContent = '';
    _togglePanel('pwPanel', 'settingPw', false);
    $('#settingPw')?.focus();
    showToast('비밀번호를 바꿨어요 · 다른 기기에서는 모두 로그아웃됐어요', 3600);
  } catch (e) {
    msg.textContent = _errText(e, '비밀번호를 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    if (e?.status === 400 && /현재 비밀번호/.test(msg.textContent)) $('#pwCurrent').focus();
  } finally { btn.disabled = false; }
}

async function _logoutAll() {
  const msg = $('#logoutAllMsg');
  const btn = $('#logoutAllConfirm'); btn.disabled = true;
  try {
    await api.logoutAll();
    _togglePanel('logoutAllPanel', 'settingLogoutAll', false);
    closeSettings();
    signOutLocally('모든 기기에서 로그아웃했어요. 이 기기에서 만들던 일정은 그대로 있어요');
  } catch (e) {
    msg.textContent = _errText(e, '로그아웃하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
  } finally { btn.disabled = false; }
}

/* ============ 시트 ============ */
export function initSettings(state) {
  appState = state || appState;
  $('#openSettingsBtn')?.addEventListener('click', openSettings);
  $('#settingsClose')?.addEventListener('click', closeSettings);
  $('#settingsBackdrop')?.addEventListener('click', closeSettings);

  const cur = _theme();
  $$('#themeSeg input').forEach(r => {
    r.checked = r.value === cur;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      try { localStorage.setItem(THEME_KEY, r.value); localStorage.removeItem(OLD_DARK_KEY); } catch (_) {}
      applyTheme(r.value);
    });
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  applyTheme(cur);

  // 번역이 없는 언어를 골라 둔 예전 설정은 한국어로 되돌린다.
  try { localStorage.removeItem(LANG_KEY); } catch (_) {}
  document.documentElement.lang = 'ko';

  $('#settingReset')?.addEventListener('click', () => ($('#resetPanel')?.hidden ? _openReset() : _closeReset()));
  $('#resetCancel')?.addEventListener('click', _closeReset);
  $('#resetConfirm')?.addEventListener('click', _doReset);

  $('#settingPw')?.addEventListener('click', () => {
    const open = $('#pwPanel').hidden;
    _togglePanel('pwPanel', 'settingPw', open);
    if (open) { $('#pwMsg').textContent = ''; $('#pwCurrent')?.focus(); }
  });
  $('#pwCancel')?.addEventListener('click', () => { _togglePanel('pwPanel', 'settingPw', false); $('#settingPw')?.focus(); });
  $('#pwPanel')?.addEventListener('submit', _changePassword);
  $('#settingLogoutAll')?.addEventListener('click', () => {
    const open = $('#logoutAllPanel').hidden;
    _togglePanel('logoutAllPanel', 'settingLogoutAll', open);
    if (open) { $('#logoutAllMsg').textContent = ''; $('#logoutAllCancel')?.focus(); }
  });
  $('#logoutAllCancel')?.addEventListener('click', () => { _togglePanel('logoutAllPanel', 'settingLogoutAll', false); $('#settingLogoutAll')?.focus(); });
  $('#logoutAllConfirm')?.addEventListener('click', _logoutAll);
  document.addEventListener('redesign:auth-ready', _paintAccount);
}

export function openSettings() {
  const bd = $('#settingsBackdrop'); const sh = $('#settingsSheet');
  if (!bd || !sh) return;
  _paintNoti();
  _paintAccount();
  applyTheme();
  const panel = $('#resetPanel'); if (panel) panel.hidden = true;
  bd.hidden = false; sh.hidden = false;
  requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); });
}

export function closeSettings() {
  const bd = $('#settingsBackdrop'); const sh = $('#settingsSheet');
  if (!bd || !sh) return;
  bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 250);
}
