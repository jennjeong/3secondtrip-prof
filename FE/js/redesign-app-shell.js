/* 3초 여행 — 앱 설치, 방문 통계, 화면 오류 집계.
 * 개발 환경에서는 켜지 않는다.  오류는 내용 없이 횟수만 센다
 * (메시지에 일정이나 개인정보가 섞일 수 있어서).
 */

import { trackEvent } from './redesign-api-adapter.js';
import { NATIVE } from './redesign-native.js';

const MAX_ERRORS_PER_PAGE = 3;

function _isLocal() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

function _countErrors() {
  let sent = 0;
  const report = () => {
    if (sent >= MAX_ERRORS_PER_PAGE) return;
    sent += 1;
    trackEvent('client_error');
  };
  window.addEventListener('error', report);
  window.addEventListener('unhandledrejection', report);
}


/* 새 배포 받기 — 홈 화면 앱은 오래 켜 둔 채 쓰기 때문에, 앱으로 돌아올 때마다 새 버전을 확인한다.
 * 새 서비스 워커가 자리를 잡으면(=새 배포) 화면·CSS·JS 가 한 묶음이 되도록 다시 연다.
 * 입력 중인 화면(만들기·가입·편집 등)은 끊지 않고, 홈·탐색처럼 입력이 없는 화면에서만 바로 다시 연다. */
const _CALM_PAGES = new Set(['home', 'explore', 'roadmap-detail', 'my', 'my-saved']);
function _watchUpdates(reg) {
  let hadController = !!navigator.serviceWorker.controller;
  let pending = false;
  const calm = () => _CALM_PAGES.has(document.documentElement.dataset.page || '') && !document.querySelector('.bottom-sheet:not([hidden]), dialog[open]');
  const tryReload = () => { if (pending && calm()) { pending = false; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }     // 첫 설치는 새 배포가 아니다
    pending = true;
    if (document.visibilityState === 'visible') tryReload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    reg.update?.().catch(() => {});
    tryReload();
  });
  document.addEventListener('redesign:nav', tryReload);
  window.addEventListener('online', () => reg.update?.().catch(() => {}));
}

export function initAppShell() {
  window.addEventListener('appinstalled', () => trackEvent('app_installed'));
  if ('serviceWorker' in navigator && !NATIVE) {   // 앱은 파일을 앱 안에 담고 있어 서비스 워커가 필요 없다
    navigator.serviceWorker.register('/sw.js').then(_watchUpdates).catch(e => console.warn('[pwa] 등록 실패:', e?.message));
  }
  if (_isLocal()) return;
  _countErrors();
  // 방문 분석은 자체 이벤트(/api/events)로만 한다. Vercel Web Analytics 는 프로젝트에서
  // 켜져 있지 않아 /_vercel/insights/script.js 가 404·MIME 오류를 냈으므로 불러오지 않는다.
}
