/* 3초 여행 — 앱 설치, 방문 통계, 화면 오류 집계.
 * 개발 환경에서는 켜지 않는다.  오류는 내용 없이 횟수만 센다
 * (메시지에 일정이나 개인정보가 섞일 수 있어서).
 */

import { trackEvent } from './redesign-api-adapter.js';

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

function _loadVercelAnalytics() {
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
}

export function initAppShell() {
  window.addEventListener('appinstalled', () => trackEvent('app_installed'));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[pwa] 등록 실패:', e?.message));
  }
  if (_isLocal()) return;
  _countErrors();
  _loadVercelAnalytics();
}
