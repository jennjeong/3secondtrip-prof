/* 3초 여행 — 잠든 서버 깨우기
 *
 * 서버(Render 무료)는 15분 동안 요청이 없으면 잠들고, 다시 켜지는 데 30~60초 걸린다.
 *  - 앱을 열면(첫 HTML 에서 바로) 조용히 깨운다 — 사용자가 여행지를 고르는 동안 준비된다.
 *  - 앱을 화면에 띄워 둔 동안에는 10분마다 확인해 잠들지 않게 한다(가려진 탭은 하지 않음).
 *  - 다른 앱을 쓰다가 돌아오면 그때 깨운다.
 *  - 일정 만들기처럼 제한 시간이 있는 작업은 ensure() 로 깨어난 것을 확인한 뒤 시작한다.
 *    (그러지 않으면 장소 검색 제한 12초가 먼저 지나 예시 장소로 채워진다.)
 */
export const FRESH_MS = 12 * 60e3;        // 마지막 응답이 이보다 최근이면 깨어 있다고 본다(잠드는 기준 15분보다 짧게)
const KEEP_MS = 10 * 60e3;
const RETURN_MS = 5 * 60e3;
const RETRY_MS = [1000, 2000, 3000, 5000];

/** ping(signal) 은 서버가 직접 답했으면 true. 시각·대기는 테스트에서 바꿔 넣는다. */
export function createWaker({ ping, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), online = () => true }) {
  let last = -Infinity;
  let pending = null;
  const touch = () => { last = now(); };
  const age = () => now() - last;
  const isFresh = () => age() < FRESH_MS;

  async function run(maxMs) {
    const end = now() + maxMs;
    for (let i = 0; online(); i++) {
      const left = end - now();
      if (left <= 0) return false;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), left);
      let ok = false;
      try { ok = await ping(ac.signal); } catch (_) { /* 연결 실패 — 다시 시도 */ } finally { clearTimeout(timer); }
      if (ok) { touch(); return true; }
      await sleep(Math.min(RETRY_MS[Math.min(i, RETRY_MS.length - 1)], Math.max(0, end - now())));
    }
    return false;
  }
  /** 서버가 깨어 있게 한다. 이미 깨우는 중이면 그 결과를 함께 기다린다. */
  function wake(maxMs = 70e3) {
    return (pending ||= run(maxMs).finally(() => { pending = null; }));
  }
  /** 최근에 응답이 있었으면 바로 true, 아니면 깨운 뒤 true. 끝내 응답이 없으면 false. */
  async function ensure({ maxMs = 70e3, onWait, waitAfter = 1200 } = {}) {
    if (isFresh()) return true;
    let timer = onWait ? setTimeout(onWait, waitAfter) : null;
    try { return await wake(maxMs); } finally { clearTimeout(timer); timer = null; }
  }
  /** 화면에 보이는 동안만 깨워 둔다. */
  function watch(doc, every = setInterval) {
    const visible = () => doc.visibilityState !== 'hidden';
    doc.addEventListener('visibilitychange', () => { if (visible() && age() > RETURN_MS) wake(); });
    every(() => { if (visible() && age() >= KEEP_MS - 5e3) wake(); }, 60e3);
  }
  return { touch, isFresh, wake, ensure, watch };
}
