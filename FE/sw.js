/* 3초 여행 — 서비스 워커.
 * 같은 사이트의 파일만 다룬다.  늘 최신 파일을 먼저 받고(HTTP 캐시도 건너뛰고 서버에 확인),
 * 인터넷이 끊겼을 때만 저장본을 쓴다.  일정은 localStorage 에 있어 오프라인에서도 보인다.
 *
 * 설치할 때 앱 화면을 이루는 파일(SHELL)을 미리 받아 둔다.  첫 방문의 요청은
 * 서비스 워커가 아직 관리하지 않아 저장되지 않기 때문에, 미리 받지 않으면
 * 홈 화면 앱을 오프라인에서 처음 열 때 빈 오류 화면이 뜬다.
 * 새 JS·CSS 파일을 추가하면 SHELL 목록에도 넣는다.
 */
const CACHE = 'tst-shell-v4';
const SHELL = [
  '/index-redesign.html',
  '/manifest.webmanifest',
  '/css/redesign-reset.css', '/css/redesign-layout.css', '/css/redesign-components.css',
  '/css/redesign-responsive.css', '/css/redesign-effects.css', '/css/redesign-system.css',
  '/js/redesign-main.js', '/js/redesign-api-adapter.js', '/js/redesign-app-shell.js',
  '/js/redesign-auth.js', '/js/redesign-blog.js', '/js/redesign-calendar.js', '/js/redesign-cities.js',
  '/js/redesign-collab.js', '/js/redesign-course-samples.js', '/js/redesign-feedback.js',
  '/js/redesign-my-pages.js', '/js/redesign-navigation.js', '/js/redesign-reviews.js',
  '/js/redesign-roadmaps.js', '/js/redesign-schedule.js', '/js/redesign-settings.js',
  '/js/redesign-subscription.js', '/js/redesign-survey.js', '/js/redesign-trip-flow.js',
  '/js/redesign-ui.js', '/js/redesign-booking.js', '/js/redesign-map.js', '/js/redesign-trip-tools.js',
  '/assets/logo_wordmark.png', '/assets/icon-192.png', '/assets/apple-touch-icon.png', '/assets/favicon-32.png',
];

const OFFLINE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>3초 여행 · 오프라인</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,system-ui,sans-serif;background:#F4F5F7;color:#1E222A;padding:24px;text-align:center}
button{margin-top:16px;min-height:44px;padding:0 20px;border-radius:12px;border:0;background:#1E222A;color:#fff;font-weight:700;font-size:15px}</style></head>
<body><div><h1 style="font-size:20px">인터넷에 연결되지 않았어요</h1>
<p>연결되면 다시 열어 주세요. 이 기기에 저장한 일정은 지워지지 않았어요.</p>
<button onclick="location.reload()">다시 시도</button></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 하나가 실패해도 나머지는 저장한다.
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (_) { /* 다음 방문 때 다시 받는다 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 브라우저 HTTP 캐시에 남은 옛 파일을 쓰지 않도록 매번 서버에 확인한다(ETag 로 304).
      const res = await fetch(request, { cache: 'no-cache' });
      if (res.ok) await cache.put(request, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' ? await cache.match('/index-redesign.html') : undefined);
      if (hit) return hit;
      if (request.mode === 'navigate') {
        return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      throw err;
    }
  })());
});
