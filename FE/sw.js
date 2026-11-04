/* 3초 여행 — 서비스 워커.
 * 같은 사이트의 파일만 다룬다.  늘 최신 파일을 먼저 받고, 인터넷이 끊겼을
 * 때만 저장본을 쓴다.  일정은 localStorage 에 있어 오프라인에서도 보인다.
 */
const CACHE = 'tst-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

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
      const res = await fetch(request);
      if (res.ok) await cache.put(request, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(request)
        || (request.mode === 'navigate' ? await cache.match('/index-redesign.html') : undefined);
      if (hit) return hit;
      throw err;
    }
  })());
});
