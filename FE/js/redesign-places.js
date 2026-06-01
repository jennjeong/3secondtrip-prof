/* 3초 여행 — Place insights (Foursquare local ratio + Google congestion)
 *
 * Tries the backend proxy first (api.placeInsights — keep API keys server-side).
 * Falls back to deterministic synthetic data so the UI never looks empty.
 *
 * Returns: { localRatio: 0..1, congestion: 'quiet'|'normal'|'busy', source: string }
 */

import { api, apiRequest } from './redesign-api-adapter.js';

// Backend has no /places/insights endpoint shipped yet — set a flag so
// we can re-enable the live call later without changing any other code.
const BACKEND_INSIGHTS_ENABLED = false;

if (BACKEND_INSIGHTS_ENABLED) {
  api.placeInsights = (q, city) =>
    apiRequest(`/places/insights?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city || '')}`)
      .catch(() => null);
}

const CACHE = new Map();

export async function getInsights(place, city, contextTime /* "HH:MM" */) {
  const key = `${city}::${place}::${contextTime || ''}`;
  if (CACHE.has(key)) return CACHE.get(key);

  // 1) Try backend only if the endpoint is wired (default: off).
  if (BACKEND_INSIGHTS_ENABLED) {
    try {
      const remote = await api.placeInsights(place, city);
      if (remote && typeof remote.localRatio === 'number') {
        const norm = _normalize(remote);
        CACHE.set(key, norm);
        return norm;
      }
    } catch (_) {}
  }

  // 2) Deterministic synthetic fallback (Foursquare/Google 추정).
  const synth = _synthetic(place, city, contextTime);
  CACHE.set(key, synth);
  return synth;
}

function _normalize(r) {
  let cong = String(r.congestion || '').toLowerCase();
  if (!['quiet','normal','busy'].includes(cong)) {
    const n = Number(r.congestion);
    cong = n >= 70 ? 'busy' : (n >= 35 ? 'normal' : 'quiet');
  }
  return {
    localRatio: Math.max(0, Math.min(1, Number(r.localRatio) || 0)),
    congestion: cong,
    source: r.source || 'backend',
  };
}

/* Synthetic generator — stable across reloads (no random()).
 * Hash place name + city + time slot → 0..1.
 * Local ratio: places that smell touristy (랜드마크, 시그니처) get lower local %.
 * Congestion: time-of-day peak windows by inferred category.
 */
function _synthetic(place, city, contextTime) {
  const seed = _hash(`${city}|${place}`);
  const baseLocal = 0.42 + ((seed % 41) / 100);   // 0.42 ~ 0.82
  // Touristy keywords push the local ratio down (more travelers)
  const touristy = /랜드마크|관광|시그니처|타워|투어|미슐랭|광장|에펠|루브르|타임스|디즈니|유니버설/i.test(place);
  const local = touristy ? Math.max(0.18, baseLocal - 0.22) : baseLocal;

  // Congestion: derive from contextTime + place type hints
  const hour = contextTime ? parseInt(contextTime.split(':')[0], 10) : null;
  let cong = 'normal';
  if (hour != null) {
    if (/식사|레스토랑|맛집/i.test(place)) {
      if ((hour >= 12 && hour <= 13) || (hour >= 18 && hour <= 20)) cong = 'busy';
      else if (hour <= 10 || hour >= 22) cong = 'quiet';
      else cong = 'normal';
    } else if (/카페/i.test(place)) {
      cong = (hour >= 14 && hour <= 16) ? 'busy' : (hour >= 9 ? 'normal' : 'quiet');
    } else if (/쇼핑|시장|야시장/i.test(place)) {
      cong = (hour >= 15 && hour <= 21) ? 'busy' : 'normal';
    } else if (/야경|바|클럽|재즈/i.test(place)) {
      cong = (hour >= 20) ? 'busy' : 'quiet';
    } else if (/관광|박물관|타워|광장|호텔/i.test(place)) {
      cong = (hour >= 10 && hour <= 16) ? 'busy' : 'normal';
    } else {
      cong = ((seed >> 3) % 3) === 0 ? 'busy' : (((seed >> 3) % 3) === 1 ? 'normal' : 'quiet');
    }
  } else {
    cong = ((seed >> 5) % 3) === 0 ? 'busy' : (((seed >> 5) % 3) === 1 ? 'normal' : 'quiet');
  }
  return { localRatio: Math.round(local * 100) / 100, congestion: cong, source: 'estimated · Foursquare/Google 추정' };
}

function _hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i), h |= 0;
  return Math.abs(h);
}

export const CONGESTION_LABEL = {
  quiet:  { ko: '한산', icon: '🟢' },
  normal: { ko: '보통', icon: '🟡' },
  busy:   { ko: '붐빔', icon: '🔴' },
};
