/* 3초 여행 — Redesign Booking
 * Bottom-sheet booking modal.  Preserves the original filter behavior:
 *   - Flight items deduped as a single round-trip
 *   - Hotel deduped to one item
 *   - Restaurant / activity filtered by required_reservation flag
 *   - Airport transfer always available
 *   - "Extra options" excludes hotel/flight, includes restaurant/transport
 *   - Price right-aligned, category label vertically centered.
 *
 * Currently uses mock items; replace _buildItems() with a real API call
 * (e.g. apiRequest('/bookings/options?city=...')) when the backend ships.
 */

import { api } from './redesign-api-adapter.js';
import { el, $, formatCurrency, showToast } from './redesign-ui.js';

const CATS = {
  flight:     { label: '항공',     order: 1 },
  hotel:      { label: '숙소',     order: 2 },
  restaurant: { label: '맛집',     order: 3 },
  activity:   { label: '액티비티', order: 4 },
  transport:  { label: '교통',     order: 5 },
  airport:    { label: '공항이동', order: 6 },
};

let appState = null;
let items = [];
let selected = new Set();
let activeFilter = 'all';
let airlineType = 'all'; // all | full-service | low-cost

export function initBooking(state) {
  appState = state;

  document.addEventListener('redesign:open-booking', _open);

  $('#bookingClose')?.addEventListener('click', _close);
  $('#bookingBackdrop')?.addEventListener('click', _close);

  $('#bookingFilters')?.addEventListener('click', (e) => {
    const c = e.target.closest?.('[data-book-cat]');
    if (!c) return;
    activeFilter = c.dataset.bookCat;
    $('#bookingFilters').querySelectorAll('.chip').forEach(x => x.classList.toggle('is-active', x === c));
    _renderList();
  });

  $('#bookingConfirm')?.addEventListener('click', async () => {
    const chosen = items.filter(it => selected.has(it.id));
    if (chosen.length === 0) { showToast('선택된 항목이 없어요'); return; }
    try {
      await api.saveBooking({ items: chosen, total: _total(), city: appState.generated?.city });
      showToast(`${chosen.length}건의 예약 정보를 저장했어요`);
      _close();
    } catch (e) {
      console.error('[booking] save failed', e);
      showToast('예약 저장에 실패했어요');
    }
  });
}

function _open() {
  if (!appState?.generated) { showToast('일정이 없어요'); return; }
  items = _buildItems(appState.generated);
  selected = new Set();
  activeFilter = 'all';
  $('#bookingFilters').querySelectorAll('.chip').forEach(x => x.classList.toggle('is-active', x.dataset.bookCat === 'all'));
  _renderList();
  _updateTotal();
  $('#bookingBackdrop').hidden = false;
  $('#bookingSheet').hidden = false;
  requestAnimationFrame(() => {
    $('#bookingBackdrop').classList.add('is-visible');
    $('#bookingSheet').classList.add('is-visible');
  });
}

function _close() {
  $('#bookingBackdrop').classList.remove('is-visible');
  $('#bookingSheet').classList.remove('is-visible');
  setTimeout(() => { $('#bookingBackdrop').hidden = true; $('#bookingSheet').hidden = true; }, 250);
}

/* ============ Build items ============
 * Applies all preservation rules from the legacy app:
 *   - Flights collapsed into single round-trip
 *   - Hotels deduped (one per accommodation type per stay)
 *   - Restaurants/activities: only those flagged required_reservation
 *   - Airport transfer pair (도착·출국) always included
 */
function _buildItems(g) {
  const out = [];
  const city = g.city;
  const nights = Math.max(1, g.days.length - 1);

  // ── 사용자 선택 + 전체 예산 ────────────────────────────
  const flight = g.flight || {};
  const hotelPref = g.hotelPref || {};
  const totalBudget = g.budget || 0;
  // 카테고리별 추천 분배: 항공 45%, 숙박 30%, 나머지 25%
  const flightBudgetCap = totalBudget > 0 ? Math.round(totalBudget * 0.45) : Infinity;
  const hotelBudgetCap  = totalBudget > 0 ? Math.round(totalBudget * 0.30) : Infinity;

  // ── 항공 다중 옵션 ──────────────────────────────────
  // 일정에 들어있는 공항(이동) 항목에서 실제 가격 합산 (사용자 선택 기준)
  let actualFlightPrice = 0;
  let flightInfoStr = null;
  g.days.forEach((d) => {
    d.activities?.forEach((a) => {
      if (a.category === '이동' && a.flightMeta) {
        actualFlightPrice += a.cost || 0;
        flightInfoStr = flightInfoStr || a.address || null;
      }
    });
  });
  // 옵션 후보군 — 사용자 선택 1개 + 가격대별 대안
  const flightOptions = [];
  const originLabel = g.originName || g.departureCity || '인천';
  // 1) 사용자 선택 (실제 가격)
  if (actualFlightPrice > 0) {
    const userDesc = [];
    if (flight.route === 'direct') userDesc.push('직항');
    else if (flight.route === 'transit') userDesc.push('경유');
    if (flight.airlines && flight.airlines.length) {
      userDesc.push(flight.airlines.slice(0, 3).join('/') + (flight.airlines.length > 3 ? '+' : ''));
    } else if (flight.classType === 'lcc') userDesc.push('저가 항공');
    else if (flight.classType === 'fsc') userDesc.push('대형 항공');
    if (flightInfoStr) userDesc.push(flightInfoStr.split(' · ').slice(0, 2).join(' · '));
    flightOptions.push({
      id: 'flt-pick', cat: 'flight',
      name: `${originLabel} ⇄ ${city} 왕복 (선택 옵션)`,
      desc: userDesc.join(' · ') || '추천 항공편',
      price: actualFlightPrice, required: true, sub: '★ 일정 선택 기준',
    });
  }
  // 2) 가격대 별 대안 3개 (저가/중간/대형)
  const altOptions = [
    { id:'flt-low',  name:'저가 항공 옵션', mult: 0.55, desc:'LCC · 가벼운 짐 위주' },
    { id:'flt-mid',  name:'중급 옵션',     mult: 0.85, desc:'중간 등급 · 위탁 수하물 포함' },
    { id:'flt-high', name:'프리미엄 옵션', mult: 1.30, desc:'대형 항공사 · 풀 서비스' },
  ];
  // 기준 가격 = 실제 가격이 있으면 그것, 없으면 LCC 320k / FSC 580k
  const baseRef = actualFlightPrice || (flight.classType === 'lcc' ? 320000 : 580000);
  altOptions.forEach(opt => {
    const p = Math.round(baseRef * opt.mult / 10000) * 10000;
    flightOptions.push({
      id: opt.id, cat: 'flight',
      name: `${originLabel} ⇄ ${city} 왕복 (${opt.name})`,
      desc: opt.desc, price: p, required: false,
    });
  });
  // 예산 필터 — flightBudgetCap 초과 항목은 숨김 (단, 사용자 선택은 유지)
  flightOptions.forEach(it => {
    if (it.id === 'flt-pick' || it.price <= flightBudgetCap) {
      out.push(it);
    }
  });

  // ── 호텔 다중 옵션 + 예산 필터 ──────────────────────
  // 일정에서 실제 1박 가격 추출
  let userPerNight = 0;
  let hotelNameFromTrip = null;
  for (const d of g.days) {
    for (const a of (d.activities || [])) {
      if (a.category === '숙박' && a.cost && a.cost > 0) {
        userPerNight = a.cost;
        hotelNameFromTrip = a.name?.split(' (')[0] || null;
        break;
      }
    }
    if (userPerNight) break;
  }
  if (!userPerNight) userPerNight = 110000;

  // 라벨 맵
  const typeLabelMap = {
    luxury: '5성급', upscale: '4성급', midscale: '3성급', budget: '2성급·이코노미',
    boutique: '부티크', resort: '리조트', ryokan: '료칸', bnb: 'B&B·민박',
    hostel: '호스텔', apt: '아파트·에어비앤비', capsule: '캡슐호텔',
  };
  const locLabelMap = {
    downtown: '시내중심', station: '역근처', airport: '공항근처',
    beach: '해변', nature: '자연·외곽', shopping: '쇼핑가',
  };
  const amenLabelMap = {
    breakfast: '조식', pool: '수영장', spa: '스파', gym: '피트니스',
    parking: '주차', petfriendly: '반려동물', kitchen: '취사', laundry: '세탁', kids: '키즈',
  };
  const typeLabels = (hotelPref.types || []).map(k => typeLabelMap[k] || k);
  const locLabels  = (hotelPref.locations || []).map(k => locLabelMap[k]  || k);
  const amenLabels = (hotelPref.amenities || []).map(k => amenLabelMap[k] || k);

  // 옵션 후보
  const hotelOptions = [];
  // 1) 사용자 선택 호텔
  const userDescParts = [
    `${nights}박`,
    `1박 ${userPerNight.toLocaleString('ko-KR')}원`,
    `총 ${(userPerNight * nights).toLocaleString('ko-KR')}원`,
  ];
  if (locLabels.length)  userDescParts.push(locLabels.slice(0, 2).join('/'));
  if (amenLabels.length) userDescParts.push(amenLabels.slice(0, 3).join('·'));
  const userHotelName = typeLabels.length
    ? `${city} ${typeLabels.slice(0, 2).join('/')}`
    : (hotelNameFromTrip || `${city} 시내 호텔`);
  hotelOptions.push({
    id: 'htl-pick', cat: 'hotel',
    name: userHotelName,
    desc: userDescParts.join(' · '),
    price: userPerNight * nights,
    perNight: userPerNight, nights, hotelPref,
    required: true, sub: '★ 일정 선택 기준',
  });
  // 2) 가격대별 대안 (저렴·중간·고급)
  const altHotels = [
    { id:'htl-low',  name:`${city} 이코노미 호텔`,    perNight: Math.max(40000,  Math.round(userPerNight * 0.40 / 10000) * 10000), desc:'2~3성급 · 기본 편의시설' },
    { id:'htl-mid',  name:`${city} 중급 호텔`,      perNight: Math.max(80000,  Math.round(userPerNight * 0.70 / 10000) * 10000), desc:'3~4성급 · 조식 포함' },
    { id:'htl-high', name:`${city} 프리미엄 호텔`,  perNight: Math.max(220000, Math.round(userPerNight * 1.40 / 10000) * 10000), desc:'4~5성급 · 풀 서비스' },
  ];
  altHotels.forEach(h => {
    hotelOptions.push({
      id: h.id, cat: 'hotel', name: h.name,
      desc: `${nights}박 · 1박 ${h.perNight.toLocaleString('ko-KR')}원 · ${h.desc}`,
      price: h.perNight * nights,
      perNight: h.perNight, nights,
      required: false,
    });
  });

  // 예산 필터: 사용자 선택은 항상 포함, 그 외엔 hotelBudgetCap 이하만
  hotelOptions.forEach(it => {
    if (it.id === 'htl-pick' || it.price <= hotelBudgetCap) {
      out.push(it);
    }
  });

  // AIRPORT — arrival + departure
  out.push({ id:'ap-in',  cat:'airport', name: `${city} 공항 → 호텔 이동`, desc:'프라이빗 픽업', price: 38000 });
  out.push({ id:'ap-out', cat:'airport', name: `호텔 → ${city} 공항 이동`, desc:'프라이빗 샌딩', price: 38000 });

  // RESTAURANT / ACTIVITY — only required-reservation items
  g.days.forEach((d, di) => {
    d.activities.forEach((a, ai) => {
      const cat = a.category;
      if (cat === '식사' && _needsRes(a)) {
        out.push({ id:`r-${di}-${ai}`, cat:'restaurant', name: a.name, desc:`Day ${di+1} · ${a.time||''}`, price: a.cost || 35000, required:true });
      } else if (cat === '액티비티' && _needsRes(a)) {
        out.push({ id:`a-${di}-${ai}`, cat:'activity', name: a.name, desc:`Day ${di+1} · ${a.time||''}`, price: a.cost || 50000, required:true });
      } else if (cat === '관광' || cat === '카페' || cat === '쇼핑') {
        // Extra options — exclude hotel/flight, include transport when relevant
        if (di === 0 && ai === 1) {
          out.push({ id:`t-${di}-${ai}`, cat:'transport', name:`교통패스 (${city} 1일권)`, desc:'대중교통', price: 8000 });
        }
      }
    });
  });

  out.sort((a, b) => (CATS[a.cat]?.order || 99) - (CATS[b.cat]?.order || 99));
  return out;
}

function _needsRes(a) {
  // Heuristic: signature/popular/required hints. Real data would carry a flag.
  const n = (a.name || '').toLowerCase();
  return /시그니처|미슐랭|예약|투어|테마파크|레스토랑|bbq|bistro|fine|premium/i.test(n) || (a.cost && a.cost > 30000);
}

function _renderList() {
  const wrap = $('#bookingList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const groups = {};
  items.forEach(it => {
    if (activeFilter !== 'all' && it.cat !== activeFilter) return;
    if (!groups[it.cat]) groups[it.cat] = [];
    groups[it.cat].push(it);
  });

  if (Object.keys(groups).length === 0) {
    wrap.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, '🧳'),
      el('p', { class: 'empty-text' }, '조건에 맞는 항목이 없어요'),
    ]));
    return;
  }

  Object.keys(groups).sort((a, b) => (CATS[a]?.order || 99) - (CATS[b]?.order || 99)).forEach(catKey => {
    const sec = el('div', { class: 'book-section' }, [
      el('h4', {}, CATS[catKey]?.label || catKey),
      ...groups[catKey].map(it => _rowEl(it)),
    ]);
    wrap.appendChild(sec);
  });
}

function _rowEl(it) {
  const cb = el('button', {
    type: 'button',
    class: 'book-cb' + (selected.has(it.id) ? ' is-checked' : ''),
    ariaPressed: String(selected.has(it.id)),
    onclick: () => {
      if (selected.has(it.id)) selected.delete(it.id); else selected.add(it.id);
      cb.classList.toggle('is-checked');
      _updateTotal();
    },
  }, selected.has(it.id) ? '✓' : '');

  return el('div', { class: 'book-row' }, [
    el('div', { class: 'book-info' }, [
      el('span', { class: 'book-cat-label' }, CATS[it.cat]?.label || it.cat),
      el('div', { class: 'book-name' }, it.name),
      el('div', { class: 'book-desc' }, it.desc || ''),
    ]),
    el('div', { style: { display:'flex', alignItems:'center', gap:'10px' } }, [
      el('div', { class: 'book-price' }, formatCurrency(it.price, 'KRW')),
      cb,
    ]),
  ]);
}

function _total() {
  return items.filter(it => selected.has(it.id)).reduce((s, it) => s + (it.price || 0), 0);
}
function _updateTotal() {
  $('#bookingTotal').textContent = formatCurrency(_total(), 'KRW');
}
