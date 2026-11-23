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


export function initAppShell() {
  window.addEventListener('appinstalled', () => trackEvent('app_installed'));
  if ('serviceWorker' in navigator && !NATIVE) {   // 앱은 파일을 앱 안에 담고 있어 서비스 워커가 필요 없다
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[pwa] 등록 실패:', e?.message));
  }
  if (_isLocal()) return;
  _countErrors();
  // 방문 분석은 자체 이벤트(/api/events)로만 한다. Vercel Web Analytics 는 프로젝트에서
  // 켜져 있지 않아 /_vercel/insights/script.js 가 404·MIME 오류를 냈으므로 불러오지 않는다.
}
