/* 3초 여행 — 설정 시트
 *  - 화면 테마: 시스템 / 라이트 / 다크
 *  - 알림: 지원 여부와 브라우저 권한을 그대로 보여 준다(앱은 아직 알림을 보내지 않음)
 *  - 언어: 한국어만 번역돼 있어 다른 언어는 '준비 중'으로 안내
 *  - 이 기기 데이터 초기화: 무엇이 지워지고 무엇이 남는지 먼저 보여 준다
 */

import { $, $$, el, showToast } from './redesign-ui.js';

const THEME_KEY = 'tst_theme_v1';
const OLD_DARK_KEY = 'tst_dark_v1';
const LANG_KEY = 'tst_lang_v1';

let appState = null;

/* ============ 테마 ============ */
function _theme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'system' || v === 'light' || v === 'dark') return v;
    // 예전 '다크 모드(시스템 따름)' 켜짐 → 시스템
    return localStorage.getItem(OLD_DARK_KEY) === '1' ? 'system' : 'light';
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
}

export function openSettings() {
  const bd = $('#settingsBackdrop'); const sh = $('#settingsSheet');
  if (!bd || !sh) return;
  _paintNoti();
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
