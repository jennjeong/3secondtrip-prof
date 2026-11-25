/* 일정 생성기를 화면 없이 돌려 보는 도우미.
 * 화면 요소는 무엇을 불러도 되는 빈 것으로 바꾸고, 서버 요청은 모두 여기서 답한다(바깥으로 나가는 요청 없음). */
const blank = () => {
  const f = function () {};
  const p = new Proxy(f, {
    get: (_, k) => k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? [][Symbol.iterator].bind([]) : k === 'then' ? undefined
      : k === 'length' || k === 'childElementCount' ? 0 : k === 'value' || k === 'textContent' || k === 'innerHTML' ? '' : k === 'hidden' ? false : p,
    set: () => true, apply: () => p, construct: () => p, has: () => true,
  });
  return p;
};
const node = blank();
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
define('window', new Proxy({ location: { hostname: 'test.local', hash: '', href: 'http://test.local/' }, __API_BASE_URL: 'http://mock.local' }, { get: (o, k) => k in o ? o[k] : globalThis[k] ?? node, set: (o, k, v) => { o[k] = v; return true; } }));
define('document', node);
define('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
define('sessionStorage', globalThis.localStorage);
define('navigator', { onLine: true, userAgent: 'test', sendBeacon: () => true });
define('location', window.location);
define('history', node);
define('requestAnimationFrame', () => 0);
define('matchMedia', () => ({ matches: false, addEventListener() {} }));
define('CustomEvent', class { constructor(t, o) { this.type = t; this.detail = o?.detail; } });

const queries = [];
const CENTER = { 강릉: [37.752, 128.876], 부산: [35.158, 129.06], 제주: [33.5, 126.53], 완도: [34.311, 126.755], 도쿄: [35.68, 139.76], 교토: [35.01, 135.76] };
const HUB = { 강릉역: [37.7645, 128.8995], 부산역: [35.1152, 129.0415], 교토역: [34.9858, 135.7588] };
let n = 0;
define('fetch', async (url, opt = {}) => {
  const ok = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  if (String(url).endsWith('/health')) return ok({ ok: true });
  if (String(url).endsWith('/api/features')) return ok({ live_flights: true, live_hotels: false, ai_summary: false, places: true });
  if (String(url).endsWith('/api/places/search')) {
    const p = JSON.parse(opt.body); queries.push(p.query);
    const hub = Object.keys(HUB).find(k => p.query.includes(k));
    if (hub) return ok({ places: [{ place_id: `hub-${hub}`, name: hub, latitude: HUB[hub][0], longitude: HUB[hub][1] }] });
    const c = p.center_lat ? [p.center_lat, p.center_lng] : CENTER[Object.keys(CENTER).find(k => p.query.includes(k))];
    return ok({ places: c ? Array.from({ length: Math.min(12, p.max_results || 12) }, (_, i) => { n++; return { place_id: `p${n}`, name: `${p.query} ${i}`, latitude: c[0] + (i % 4) * .004, longitude: c[1] + (i % 3) * .004, types: [], rating: 4.3, user_rating_count: 200 }; }) : [] });
  }
  queries.push(String(url));
  return ok({ detail: 'mock' }, 404);
});
console.log = console.warn = () => {};

const { CITIES } = await import('../../../FE/js/redesign-cities.js');
export const Flow = await import('../../../FE/js/redesign-trip-flow.js');
export const state = { trip: {}, generated: null, expenses: {} };
Flow.initTripFlow(state);
const city = (key) => CITIES.find(c => c.key === key);
export const tripOf = (from, to, days = 3, extra = {}) => {
  const a = city(from), b = city(to);
  return { origin: a.key, originName: a.name, originCountry: a.country, city: b.key, cityName: b.name, country: b.country, cityTier: b.tier,
    startDate: '2026-12-08', endDate: `2026-12-${String(7 + days).padStart(2, '0')}`, days, companion: 'couple', adults: 2, children: 0, rooms: 1,
    concept: '균형', styles: [], needs: [], budget: 300, currency: 'KRW', departureAirport: '', arrivalAirport: '', placeMode: 'local',
    flight: { route: 'any', classType: 'any', airlines: [] }, hotelP: { types: [], locations: [], amenities: [] }, includeFlight: true, includeHotel: true, ...extra };
};
export async function generate(from, to, days, extra) {
  queries.length = 0;
  Object.keys(state.trip).forEach(k => delete state.trip[k]);
  Object.assign(state.trip, tripOf(from, to, days, extra));
  state.generated = null;
  if (!await Flow.regenerateSchedule({ skipSync: true, quietFail: true })) throw new Error('일정을 만들지 못했어요');
  return { g: state.generated, queries: [...queries] };
}
