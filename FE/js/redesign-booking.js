/* 3초 여행 — 예약 후보
 *
 * 3초 여행은 결제·예약을 하지 않는다.  이 시트는 세 가지를 분리해서 다룬다.
 *   1) 외부에서 찾기  — 항목별 실제 검색 페이지(새 창)
 *   2) 후보로 저장    — 고른 항목을 이 여행(g.bookingCandidates)에 남긴다
 *   3) 예약했어요     — 사용자가 외부에서 직접 예약을 마쳤다고 표시(예약번호는 선택)
 * 실시간 조회값이 아닌 금액은 모두 '추정가'로 표시하고, 편명·좌석·객실은
 * 확정값처럼 보여 주지 않는다.  후보는 일정과 함께 기기·계정에 저장된다.
 *
 * 기존 규칙 유지: 항공(기차·버스 여행은 표 한 장) 왕복 1건 + 가격대 대안, 숙소 대안, 예약이 필요한
 * 식당·액티비티만, 공항 이동 왕복, 교통패스.
 */

import { trackEvent } from './redesign-api-adapter.js';
import { el, $, formatCurrency, showToast } from './redesign-ui.js';
import { RIDE, rideOf } from './redesign-ground.js';

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

function _store() {
  const g = appState?.generated;
  if (!g) return {};
  if (!g.bookingCandidates || typeof g.bookingCandidates !== 'object') g.bookingCandidates = {};
  return g.bookingCandidates;
}
function _changed() {
  document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
  document.dispatchEvent(new CustomEvent('redesign:booking-changed'));
}

export function initBooking(state) {
  appState = state;

  document.addEventListener('redesign:open-booking', _open);

  $('#bookingClose')?.addEventListener('click', _close);
  $('#bookingBackdrop')?.addEventListener('click', _close);

  $('#bookingFilters')?.addEventListener('click', (e) => {
    const c = e.target.closest?.('[data-book-cat]');
    if (!c) return;
    activeFilter = c.dataset.bookCat;
    $('#bookingFilters').querySelectorAll('.chip').forEach(x => {
      const on = x === c;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-pressed', String(on));
    });
    c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    _renderList();
  });

  $('#bookingConfirm')?.addEventListener('click', () => {
    const chosen = items.filter(it => selected.has(it.id));
    if (chosen.length === 0) { _paintFoot(true); return; }
    const store = _store();
    const now = new Date().toISOString();
    chosen.forEach(it => {
      const prev = store[it.id];
      store[it.id] = {
        cat: it.cat, name: it.name, price: it.price, estimated: !!it.estimated,
        status: prev?.status === 'booked' ? 'booked' : 'candidate',
        ref: prev?.ref || '', savedAt: prev?.savedAt || now,
      };
    });
    _changed();
    trackEvent('booking_candidates_saved');
    const where = appState.generated?.savedScheduleId ? '이 기기와 계정' : '이 기기';
    showToast(`${chosen.length}개를 예약 후보로 저장했어요 · ${where}에 일정과 함께 보관돼요`, 3200);
    selected = new Set();
    _renderList(); _paintFoot();
  });
}

/** 기차·버스 여행이면 ‘항공 · 공항이동’을 ‘기차 · 역 이동’으로 부른다. */
function _syncRideLabels(g) {
  const W = RIDE[rideOf(g)];
  CATS.flight.label = W.label;
  CATS.airport.label = W === RIDE.air ? '공항이동' : `${W.hub} 이동`;
  ['flight', 'airport'].forEach(k => { const c = $(`#bookingFilters [data-book-cat="${k}"]`); if (c) c.textContent = CATS[k].label; });
}

function _open() {
  if (!appState?.generated) { showToast('일정이 없어요'); return; }
  _syncRideLabels(appState.generated);
  trackEvent('booking_opened');
  items = _buildItems(appState.generated);
  selected = new Set();
  activeFilter = 'all';
  $('#bookingFilters').querySelectorAll('.chip').forEach(x => {
    const on = x.dataset.bookCat === 'all';
    x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', String(on));
  });
  _renderList();
  _paintFoot();
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

/* ============ 외부 검색 링크 ============ */
function _googleFlightsUrl(g) {
  const from = g.originName || g.departureCity || '';
  const dates = g.days[0]?.date && g.days.at(-1)?.date
    ? ` on ${g.days[0].date} through ${g.days.at(-1).date}` : '';
  return 'https://www.google.com/travel/flights?q='
    + encodeURIComponent(`Flights from ${from} to ${g.city}${dates}`);
}
/** 역·터미널 사이 대중교통 길찾기 */
function _transitUrl(fm, g) {
  return 'https://www.google.com/maps/dir/?api=1&travelmode=transit&origin=' + encodeURIComponent(fm.from || g.originName || '') + '&destination=' + encodeURIComponent(fm.to || g.city);
}
function _hotelUrl(g, query) {
  const aid = window.__AFFILIATE?.bookingAid;
  if (aid) {
    return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(g.city)}&aid=${encodeURIComponent(aid)}`;
  }
  return 'https://www.google.com/travel/search?q=' + encodeURIComponent(query || `${g.city} 호텔`);
}
function _googleMapsUrl(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
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
  const ground = rideOf(g) !== 'air' ? g.days.flatMap(d => d.activities || []).find(a => a.category === '이동' && a.flightMeta) : null;
  if (ground && actualFlightPrice > 0) {       // 기차·버스는 예매할 표 하나만 — 항공 등급별 대안은 없다
    const fm = ground.flightMeta;
    out.push({ id: 'flt-pick', cat: 'flight', name: `${fm.from} ⇄ ${fm.to} 왕복 ${fm.line}`,
      desc: `1인 편도 약 ${(fm.farePerPerson || 0).toLocaleString('ko-KR')}원 · 시간표·좌석은 예매할 때 확인`,
      price: actualFlightPrice, required: true, sub: '★ 일정 선택 기준', estimated: true, url: _transitUrl(fm, g) });
  }
  const flightOptions = [];
  const flightUrl = _googleFlightsUrl(g);
  const originLabel = g.originName || g.departureCity || '인천';
  // 1) 사용자 선택 (실제 가격)
  if (!ground && actualFlightPrice > 0) {
    const userDesc = [];
    if (flight.route === 'direct') userDesc.push('직항');
    else if (flight.route === 'transit') userDesc.push('경유');
    if (flight.airlines && flight.airlines.length) {
      userDesc.push(flight.airlines.slice(0, 3).join('/') + (flight.airlines.length > 3 ? '+' : ''));
    } else if (flight.classType === 'lcc') userDesc.push('저가 항공');
    else if (flight.classType === 'fsc') userDesc.push('대형 항공');
    // 편명은 실시간 조회로 받은 값일 때만 '조회된 항공편'으로 보여 준다(확정 아님).
    if (flightInfoStr && g.flightPriceSource === 'serpapi') userDesc.push('조회된 항공편 ' + flightInfoStr.split(' · ').slice(0, 2).join(' · '));
    userDesc.push('편명·좌석은 예약 사이트에서 확인');
    flightOptions.push({
      id: 'flt-pick', cat: 'flight',
      name: `${originLabel} ⇄ ${city} 왕복 (선택 옵션)`,
      desc: userDesc.join(' · ') || '추천 항공편',
      price: actualFlightPrice, required: true, sub: '★ 일정 선택 기준',
      estimated: g.flightPriceSource !== 'serpapi', live: g.flightPriceSource === 'serpapi',
      liveFailed: !!g.flightLiveFailed, url: flightUrl,
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
  if (!ground) altOptions.forEach(opt => {
    const p = Math.round(baseRef * opt.mult / 10000) * 10000;
    flightOptions.push({
      id: opt.id, cat: 'flight',
      name: `${originLabel} ⇄ ${city} 왕복 (${opt.name})`,
      desc: opt.desc, price: p, required: false, estimated: true, liveFailed: !!g.flightLiveFailed, url: flightUrl,
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
  userDescParts.push('객실·잔여는 예약 사이트에서 확인');
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
    estimated: g.hotelPriceSource !== 'serpapi', live: g.hotelPriceSource === 'serpapi',
    liveFailed: !!g.hotelLiveFailed, url: _hotelUrl(g, userHotelName),
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
      required: false, estimated: true, url: _hotelUrl(g, h.name),
    });
  });

  // 예산 필터: 사용자 선택은 항상 포함, 그 외엔 hotelBudgetCap 이하만
  hotelOptions.forEach(it => {
    if (it.id === 'htl-pick' || it.price <= hotelBudgetCap) {
      out.push(it);
    }
  });

  // AIRPORT — arrival + departure
  if (ground) {
    out.push({ id:'ap-in',  cat:'airport', name: `${ground.flightMeta.to} → 숙소 이동`, desc:'택시 어림', price: 10000, estimated: true, url: _googleMapsUrl(`${ground.flightMeta.to} 택시`) });
    out.push({ id:'ap-out', cat:'airport', name: `숙소 → ${ground.flightMeta.to} 이동`, desc:'택시 어림', price: 10000, estimated: true, url: _googleMapsUrl(`${ground.flightMeta.to} 택시`) });
  } else {
  out.push({ id:'ap-in',  cat:'airport', name: `${city} 공항 → 호텔 이동`, desc:'프라이빗 픽업', price: 38000, estimated: true, url: _googleMapsUrl(`${city} 공항 픽업`) });
  out.push({ id:'ap-out', cat:'airport', name: `호텔 → ${city} 공항 이동`, desc:'프라이빗 샌딩', price: 38000, estimated: true, url: _googleMapsUrl(`${city} 공항 샌딩`) });
  }

  // RESTAURANT / ACTIVITY — only required-reservation items
  g.days.forEach((d, di) => {
    d.activities.forEach((a, ai) => {
      const cat = a.category;
      if (cat === '식사' && _needsRes(a)) {
        out.push({ id:`r-${di}-${ai}`, cat:'restaurant', name: a.name, desc:`${di+1}일차 · ${a.time||''}`, price: a.cost || 35000, required:true, estimated: !a.cost, url: _googleMapsUrl(`${a.name} ${city}`) });
      } else if (cat === '액티비티' && _needsRes(a)) {
        out.push({ id:`a-${di}-${ai}`, cat:'activity', name: a.name, desc:`${di+1}일차 · ${a.time||''}`, price: a.cost || 50000, required:true, estimated: !a.cost, url: _googleMapsUrl(`${a.name} ${city}`) });
      } else if (cat === '관광' || cat === '카페' || cat === '쇼핑') {
        // Extra options — exclude hotel/flight, include transport when relevant
        if (di === 0 && ai === 1) {
          out.push({ id:`t-${di}-${ai}`, cat:'transport', name:`교통패스 (${city} 1일권)`, desc:'대중교통', price: 8000, estimated: true, url: _googleMapsUrl(`${city} 교통패스`) });
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
  _paintSummary();

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
    const sec = el('section', { class: 'book-section', ariaLabel: CATS[catKey]?.label || catKey }, [
      el('h4', {}, CATS[catKey]?.label || catKey),
      ...groups[catKey].map(it => _rowEl(it)),
    ]);
    wrap.appendChild(sec);
  });
}

/** 저장된 후보·예약 완료 개수를 시트 위쪽에 알려 준다. */
function _paintSummary() {
  const box = $('#bookingSaved');
  if (!box) return;
  const all = Object.values(_store());
  const booked = all.filter(x => x.status === 'booked').length;
  const cand = all.length - booked;
  box.hidden = all.length === 0;
  box.textContent = all.length ? `저장한 후보 ${cand}개 · 예약했다고 표시한 항목 ${booked}개` : '';
}

function _priceKind(it) {
  if (!it.estimated) return it.live ? '조회 당시 가격 · 지금은 다를 수 있어요' : '일정의 예상 금액';
  return it.liveFailed ? '조회 실패 · 추정가' : '추정가';
}

function _rowEl(it) {
  const st = _store()[it.id];
  const cbId = `bk-${it.id}`;
  const cb = el('input', {
    type: 'checkbox', id: cbId, class: 'book-check',
    checked: selected.has(it.id),
    onchange: (e) => {
      if (e.target.checked) selected.add(it.id); else selected.delete(it.id);
      row.classList.toggle('is-selected', e.target.checked);
      _paintFoot();
    },
  });
  const label = el('label', { class: 'book-check-label', for: cbId }, [
    cb,
    el('span', { class: 'sr-only' }, `${it.name} 후보로 선택, ${_priceKind(it)} ${formatCurrency(it.price, 'KRW')}`),
  ]);

  const badge = st ? el('span', { class: 'book-badge' + (st.status === 'booked' ? ' is-booked' : '') },
    st.status === 'booked' ? '예약했다고 표시함' : '후보 저장됨') : null;

  const actions = el('div', { class: 'book-actions' }, [
    it.url ? el('a', {
      class: 'book-link', href: it.url, target: '_blank',
      rel: it.url.includes('aid=') ? 'noopener noreferrer sponsored' : 'noopener noreferrer',
      ariaLabel: `${it.name} 예약 사이트 새 창으로 열기`,
      onclick: () => trackEvent('booking_link_clicked'),
    }, '예약 사이트 열기 ↗') : el('span', { class: 'book-desc' }, '연결된 예약처 없음'),
    el('button', {
      type: 'button', class: 'book-mark' + (st?.status === 'booked' ? ' is-on' : ''),
      ariaPressed: String(st?.status === 'booked'),
      ariaLabel: st?.status === 'booked' ? `${it.name} 예약 완료 표시 취소` : `${it.name} 외부에서 예약을 마쳤다고 표시`,
      onclick: () => _toggleBooked(it),
    }, st?.status === 'booked' ? '예약 완료 취소' : '예약 완료로 표시'),
  ]);

  const refBox = st?.status === 'booked' ? el('div', { class: 'book-ref' }, [
    el('label', { for: `ref-${it.id}` }, '예약번호 (선택)'),
    el('input', {
      id: `ref-${it.id}`, class: 'form-input', type: 'text', maxLength: 40, value: st.ref || '',
      placeholder: '예약 사이트의 번호', autocomplete: 'off',
      onchange: (e) => { st.ref = e.target.value.trim(); _changed(); },
    }),
  ]) : null;

  const row = el('div', { class: 'book-row' + (selected.has(it.id) ? ' is-selected' : '') }, [
    label,
    el('div', { class: 'book-info' }, [
      el('div', { class: 'book-head' }, [
        el('div', { class: 'book-name' }, [it.name, badge ? ' ' : null, badge].filter(Boolean)),
        el('div', { class: 'book-price' }, [formatCurrency(it.price, 'KRW'), el('div', { class: 'book-estimate' }, _priceKind(it))]),
      ]),
      it.desc ? el('div', { class: 'book-desc' }, it.desc) : null,
      actions,
      refBox,
    ].filter(Boolean)),
  ]);
  return row;
}

function _toggleBooked(it) {
  const store = _store();
  const st = store[it.id];
  if (st?.status === 'booked') {
    st.status = 'candidate';
    showToast('예약 완료 표시를 지웠어요 · 후보로 남겨 둘게요');
  } else {
    store[it.id] = {
      cat: it.cat, name: it.name, price: it.price, estimated: !!it.estimated,
      status: 'booked', ref: st?.ref || '', savedAt: st?.savedAt || new Date().toISOString(),
      bookedAt: new Date().toISOString(),
    };
    trackEvent('booking_marked_booked');
    showToast('예약했다고 표시했어요 · 실제 예약 내역은 예약한 사이트에서 확인해 주세요', 3200);
  }
  _changed();
  _renderList();
  // 다시 그린 뒤 같은 버튼으로 초점을 돌려준다
  requestAnimationFrame(() => $(`#bookingList input#bk-${CSS.escape(it.id)}`)?.closest('.book-row')?.querySelector('.book-mark')?.focus());
}

function _total() {
  return items.filter(it => selected.has(it.id)).reduce((s, it) => s + (it.price || 0), 0);
}
function _paintFoot(nudge = false) {
  const n = selected.size;
  const t = $('#bookingTotal'); if (t) t.textContent = formatCurrency(_total(), 'KRW');
  const c = $('#bookingCount'); if (c) c.textContent = `선택 ${n}개`;
  const btn = $('#bookingConfirm');
  if (btn) {
    btn.setAttribute('aria-disabled', String(n === 0));
    btn.textContent = n ? `${n}개 후보로 저장` : '후보로 저장';
  }
  const hint = $('#bookingHint');
  if (hint) {
    hint.hidden = n > 0;
    hint.classList.toggle('is-nudge', !!nudge && n === 0);
  }
}
