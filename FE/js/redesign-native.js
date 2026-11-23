/* 3초 여행 — 앱(iOS·Android, Capacitor) 연결
 *
 * 같은 웹 코드가 브라우저와 앱에서 함께 돈다. 앱에서만 달라지는 것:
 *  - 공유 링크는 앱 주소(capacitor://localhost 등)가 아니라 공개 웹 주소로 만든다.
 *  - 공유는 기기 공유 시트(Share 플러그인)를 쓴다.
 *  - Android 뒤로 가기: 열린 시트 → 앱 안 이전 화면 → 홈 → 앱 종료 순.
 *  - 상태바 글자색을 테마에 맞추고, 키보드 높이를 --kb 로 알려 고정 버튼이 가리지 않게 한다.
 * 플러그인은 window.Capacitor.Plugins 로 쓴다(번들러 없이).
 */

const cap = (typeof window !== 'undefined') ? window.Capacitor : null;
export const NATIVE = !!cap?.isNativePlatform?.();
export const PLATFORM = NATIVE ? cap.getPlatform() : 'web';
export const PUBLIC_WEB = 'https://3secondtrip-prof.vercel.app/';
const P = () => cap?.Plugins || {};

/** 공유용 주소 — 앱이면 공개 웹 주소, 웹이면 지금 주소 기준. hash 는 '#page=...' 형태. */
export function publicLink(hash = '') {
  return NATIVE ? PUBLIC_WEB + hash : `${location.origin}${location.pathname}${hash}`;
}
/** 공개 웹의 다른 경로(예: 'trips/tokyo.html') */
export function publicPath(path) {
  return NATIVE ? PUBLIC_WEB + path.replace(/^\//, '') : `${location.origin}/${path.replace(/^\//, '')}`;
}

/** 기기 공유 시트. 공유했거나 사용자가 닫았으면 true, 공유 기능이 없으면 false(호출한 쪽이 복사로 대신). */
export async function shareLink({ title, text, url }) {
  if (NATIVE && P().Share) {
    try { await P().Share.share({ title, text, url, dialogTitle: title }); }
    catch (e) { /* 사용자가 닫음 — 공유한 것으로 본다 */ }
    return true;
  }
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); }
    catch (e) { if (e?.name !== 'AbortError') return false; }
    return true;
  }
  return false;
}

function _openSheet() {
  return [...document.querySelectorAll('.bottom-sheet, .cal-sheet, [role="dialog"]')]
    .find(s => !s.hidden && s.offsetParent !== null && getComputedStyle(s).visibility !== 'hidden');
}

function _themeIsDark() {
  const r = document.documentElement;
  return r.classList.contains('theme-dark') || (r.classList.contains('allow-dark') && matchMedia('(prefers-color-scheme: dark)').matches);
}

function _syncStatusBar() {
  const sb = P().StatusBar;
  if (!sb) return;
  sb.setStyle({ style: _themeIsDark() ? 'DARK' : 'LIGHT' }).catch(() => {});
  if (PLATFORM === 'android') sb.setBackgroundColor({ color: _themeIsDark() ? '#111418' : '#F7F8FA' }).catch(() => {});
}

export function initNative({ goBack } = {}) {
  if (!NATIVE) return;
  const root = document.documentElement;
  root.classList.add('is-app', `is-${PLATFORM}`);

  _syncStatusBar();
  new MutationObserver(_syncStatusBar).observe(root, { attributes: true, attributeFilter: ['class'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', _syncStatusBar);

  // Android 뒤로 가기
  P().App?.addListener?.('backButton', () => {
    const sheet = _openSheet();
    if (sheet) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    if (!(goBack && goBack())) P().App.exitApp();
  });

  // 키보드 높이 — 고정 버튼·시트 아래 여백에 쓴다
  const kb = P().Keyboard;
  kb?.addListener?.('keyboardWillShow', (info) => { root.style.setProperty('--kb', `${info.keyboardHeight || 0}px`); root.classList.add('kb-open'); });
  kb?.addListener?.('keyboardWillHide', () => { root.style.setProperty('--kb', '0px'); root.classList.remove('kb-open'); });

  // 첫 화면이 그려진 뒤에 네이티브 시작 화면을 닫는다(웹 화면이 준비되기 전 빈 화면이 보이지 않게)
  requestAnimationFrame(() => requestAnimationFrame(() => P().SplashScreen?.hide?.({ fadeOutDuration: 200 }).catch?.(() => {})));

  // 앱을 나갔다 돌아오면 — 화면 위치는 그대로 두고, 날짜가 바뀌었을 수 있으니 다시 그린다
  P().App?.addListener?.('resume', () => document.dispatchEvent(new CustomEvent('redesign:app-resume')));
}
