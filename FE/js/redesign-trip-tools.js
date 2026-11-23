/* 3초 여행 — Redesign Trip Tools
 * 일정 아래의 여행 도구 묶음: 날씨, 환율, 경비 기록, 준비물, 내보내기.
 * 날씨·환율은 키가 필요 없는 공개 API를 쓰고, 실패하면 그 줄만 숨긴다.
 * 경비와 준비물은 기기에만 저장한다(localStorage).
 */

import { trackEvent } from './redesign-api-adapter.js';
import { $, el, formatCurrency, showToast } from './redesign-ui.js';

const STORE_KEY = 'tst_trip_tools_v1';
const MAX_STORED_TRIPS = 20;
const FORECAST_DAYS = 16;   // Open-Meteo 예보 범위

const CURRENCY_BY_COUNTRY = {
  일본: 'JPY', 미국: 'USD', 괌: 'USD', 북마리아나: 'USD', 영국: 'GBP', 중국: 'CNY', 홍콩: 'HKD',
  싱가포르: 'SGD', 태국: 'THB', 말레이시아: 'MYR', 인도네시아: 'IDR', 필리핀: 'PHP', 인도: 'INR',
  호주: 'AUD', 뉴질랜드: 'NZD', 캐나다: 'CAD', 스위스: 'CHF', 스웨덴: 'SEK', 노르웨이: 'NOK',
  덴마크: 'DKK', 체코: 'CZK', 헝가리: 'HUF', 폴란드: 'PLN', 튀르키예: 'TRY', 멕시코: 'MXN',
  브라질: 'BRL', 이스라엘: 'ILS', 남아공: 'ZAR', 아이슬란드: 'ISK', 루마니아: 'RON',
  프랑스: 'EUR', 이탈리아: 'EUR', 스페인: 'EUR', 포르투갈: 'EUR', 네덜란드: 'EUR', 벨기에: 'EUR',
  독일: 'EUR', 오스트리아: 'EUR', 핀란드: 'EUR', 아일랜드: 'EUR', 그리스: 'EUR', 룩셈부르크: 'EUR',
  모나코: 'EUR', 에스토니아: 'EUR', 라트비아: 'EUR', 리투아니아: 'EUR', 크로아티아: 'EUR', 슬로베니아: 'EUR',
};

const BASE_CHECKLIST = ['여권·신분증', '항공권·숙소 예약 확인', '카드·현지 통화', '휴대폰 충전기', '상비약', '여행자 보험'];

let appState = null;
let lastKey = '';
const fetched = {};   // 같은 여행의 날씨·환율을 다시 부르지 않도록 메모리에 보관

export function initTripTools(state) {
  appState = state;
  document.addEventListener('redesign:schedule-changed', render);
}

/* ============ 저장 ============ */
function _tripKey(g) {
  return `${g.city}|${g.days[0]?.date || ''}|${g.days.length}`;
}
function _readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (_) { return {}; }
}
function _tripData(g) {
  const d = _readStore()[_tripKey(g)] || {};
  return {
    expenses: Array.isArray(d.expenses) ? d.expenses : [],
    checked: Array.isArray(d.checked) ? d.checked : [],
    members: Array.isArray(d.members) && d.members.length ? d.members : ['나'],
  };
}
function _saveTripData(g, data) {
  const store = _readStore();
  store[_tripKey(g)] = { ...data, updatedAt: Date.now() };
  const keys = Object.keys(store).sort((a, b) => (store[b].updatedAt || 0) - (store[a].updatedAt || 0));
  keys.slice(MAX_STORED_TRIPS).forEach(k => delete store[k]);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
}

/* ============ 화면 ============ */
export function render() {
  const wrap = $('#tripTools');
  const g = appState?.generated;
  if (!wrap) return;
  if (!g?.days?.length) { wrap.hidden = true; lastKey = ''; return; }
  wrap.hidden = false;
  const key = _tripKey(g);
  if (key === lastKey) return;   // 날짜 칩 이동마다 다시 그리면 입력 중인 값이 지워진다
  lastKey = key;

  wrap.innerHTML = '';
  wrap.append(
    _section('날씨', el('div', { id: 'toolWeather', class: 'tool-weather' }, '불러오는 중…')),
    _section('환율', el('p', { id: 'toolRate', class: 'tool-note' }, '불러오는 중…')),
    _section('경비 기록', _expenseEl(g)),
    _section('준비물', _checklistEl(g)),
    _section('내보내기', _exportEl(g)),
  );
  _loadWeather(g, key);
  _loadRate(g, key);
}

function _section(title, body) {
  return el('div', { class: 'tool-card' }, [el('h3', { class: 'tool-title' }, title), body]);
}

/* ============ 날씨 ============ */
function _weatherLabel(code) {
  if (code === 0) return '☀️ 맑음';
  if (code <= 3) return '⛅ 구름';
  if (code <= 48) return '🌫️ 안개';
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️ 비';
  if (code <= 77 || code === 85 || code === 86) return '🌨️ 눈';
  return '⛈️ 뇌우';
}

function _firstCoords(g) {
  for (const d of g.days) {
    for (const a of d.activities || []) {
      const lat = Number(a.latitude ?? a.lat), lng = Number(a.longitude ?? a.lng);
      if (a.category !== '이동' && (a.latitude ?? a.lat) != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }
  return null;
}

async function _fetchWeather(g) {
  const start = g.days[0]?.date, end = g.days.at(-1)?.date;
  const coords = _firstCoords(g);
  if (!start || !end || !coords) return null;
  const qs = new URLSearchParams({
    latitude: coords.lat.toFixed(3), longitude: coords.lng.toFixed(3),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto', start_date: start, end_date: end,
  });
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + qs);
  if (!res.ok) return null;
  const { daily } = await res.json();
  return daily?.time?.map((date, i) => ({
    date,
    code: daily.weather_code[i],
    max: Math.round(daily.temperature_2m_max[i]),
    min: Math.round(daily.temperature_2m_min[i]),
    rain: daily.precipitation_probability_max[i],
  })) || null;
}

async function _loadWeather(g, key) {
  const box = () => (lastKey === key ? $('#toolWeather') : null);
  const start = g.days[0]?.date;
  const daysAway = start ? Math.ceil((new Date(start) - Date.now()) / 86400000) : null;
  if (daysAway != null && daysAway > FORECAST_DAYS - g.days.length) {
    if (box()) box().textContent = `일기예보는 최대 ${FORECAST_DAYS}일 뒤까지만 나와요. 출발 약 ${FORECAST_DAYS - g.days.length + 1}일 전부터 여행 기간 날씨를 보여 드려요.`;
    return;
  }
  let rows = fetched[`w:${key}`];
  if (rows === undefined) {
    try { rows = await _fetchWeather(g); } catch (_) { rows = null; }
    fetched[`w:${key}`] = rows;
  }
  const target = box();
  if (!target) return;
  if (!rows?.length) { target.textContent = '날씨 정보를 불러오지 못했어요.'; return; }
  target.textContent = '';
  rows.forEach((r, i) => target.appendChild(el('div', { class: 'tool-day' }, [
    el('strong', {}, `${i + 1}일차 · ${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`),
    el('span', {}, _weatherLabel(r.code)),
    el('span', {}, `${r.min}° / ${r.max}°`),
    el('span', { class: 'tool-note' }, `비 ${r.rain ?? '-'}%`),
  ])));
  target.appendChild(el('p', { class: 'tool-note' }, `출처: Open-Meteo 일기예보 (여행지 현지 날짜 기준 · ${new Date().toLocaleDateString('ko-KR')} 조회). 출발이 가까울수록 정확해져요.`));
  _addWeatherItems(g, rows);
}

/* ============ 환율 ============ */
async function _loadRate(g, key) {
  const target = () => (lastKey === key ? $('#toolRate') : null);
  const currency = CURRENCY_BY_COUNTRY[g.country];
  if (!currency) {
    target()?.closest('.tool-card')?.remove();
    return;
  }
  let rate = fetched[`r:${currency}`];
  if (rate === undefined) {
    try {
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=KRW&symbols=${currency}`);
      const j = res.ok ? await res.json() : null;
      rate = j?.rates?.[currency] ? { value: j.rates[currency], date: j.date || '' } : null;
    } catch (_) { rate = null; }
    fetched[`r:${currency}`] = rate;
  }
  const box = target();
  if (!box) return;
  if (!rate) { box.textContent = '환율 정보를 불러오지 못했어요.'; return; }
  const krwPerUnit = (currency === 'JPY' || currency === 'IDR' ? 100 : 1) / rate.value;
  const unit = currency === 'JPY' || currency === 'IDR' ? 100 : 1;
  box.textContent = `${unit.toLocaleString('ko-KR')} ${currency} ≈ ${Math.round(krwPerUnit).toLocaleString('ko-KR')}원 · ${rate.date ? rate.date + ' ' : ''}유럽중앙은행 고시 기준 (Frankfurter). 실제 환전·카드 결제 금액은 수수료 때문에 달라요.`;
}

/* ============ 경비 ============ */
const EXP_CATS = ['식비', '교통', '숙소', '입장·체험', '쇼핑', '기타'];

/** 정산 — 각자 낸 돈과 똑같이 나눈 몫의 차이로 '누가 누구에게 얼마'를 만든다. */
export function settle(expenses, members) {
  const names = members.length ? members : ['나'];
  const total = expenses.reduce((s, x) => s + x.amount, 0);
  const share = total / names.length;
  const bal = Object.fromEntries(names.map(n => [n, -share]));
  expenses.forEach(x => { const p = names.includes(x.paidBy) ? x.paidBy : names[0]; bal[p] += x.amount; });
  const give = names.filter(n => bal[n] < -0.5).map(n => ({ n, v: -bal[n] })).sort((a, b) => b.v - a.v);
  const get = names.filter(n => bal[n] > 0.5).map(n => ({ n, v: bal[n] })).sort((a, b) => b.v - a.v);
  const moves = [];
  let i = 0, j = 0;
  while (i < give.length && j < get.length) {
    const v = Math.min(give[i].v, get[j].v);
    moves.push({ from: give[i].n, to: get[j].n, amount: Math.round(v) });
    give[i].v -= v; get[j].v -= v;
    if (give[i].v < 0.5) i++;
    if (get[j].v < 0.5) j++;
  }
  return { total, share: Math.round(share), moves };
}

function _csvCell(v) {
  const s = String(v ?? '');
  // 수식으로 해석되지 않게 막고, 쉼표·따옴표·줄바꿈은 따옴표로 감싼다.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function _downloadCsv(g, data) {
  const rows = [['날짜', '항목', '분류', '낸 사람', '금액(원)']];
  data.expenses.forEach(x => rows.push([x.date || '', x.name, x.cat || '기타', x.paidBy || '나', x.amount]));
  const st = settle(data.expenses, data.members);
  rows.push([], ['합계', '', '', '', st.total], ['1인당', '', '', '', st.share]);
  st.moves.forEach(m => rows.push(['정산', `${m.from} → ${m.to}`, '', '', m.amount]));
  const csv = '﻿' + rows.map(r => r.map(_csvCell).join(',')).join('\r\n');   // BOM — 엑셀에서 한글이 깨지지 않게
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `3초여행-경비-${g.city}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  trackEvent('trip_exported');
  showToast('경비 기록을 CSV 파일로 저장했어요');
}

function _expenseEl(g) {
  const wrap = el('div', { class: 'exp' });
  const list = el('div', { class: 'tool-list' });
  const byCat = el('dl', { class: 'money-rows exp-cats' });
  const settleBox = el('div', { class: 'exp-settle' });
  const summary = el('p', { class: 'tool-note', role: 'status' });
  const name = el('input', { class: 'form-input', type: 'text', placeholder: '예: 점심', maxLength: 40, id: 'expName' });
  const amount = el('input', { class: 'form-input', type: 'number', min: '1', placeholder: '원', inputMode: 'numeric', id: 'expAmount' });
  const cat = el('select', { class: 'form-input', id: 'expCat' }, EXP_CATS.map(c => el('option', { value: c }, c)));
  const payer = el('select', { class: 'form-input', id: 'expPayer' });
  const membersInput = el('input', { class: 'form-input', type: 'text', id: 'expMembers', placeholder: '예: 나, 민지, 준호', maxLength: 120 });

  const paint = () => {
    const d = _tripData(g);
    membersInput.value = d.members.join(', ');
    payer.replaceChildren(...d.members.map(m => el('option', { value: m }, m)));
    list.replaceChildren(...d.expenses.map((x, i) => el('div', { class: 'tool-row exp-row' }, [
      el('span', {}, [x.name, el('small', {}, ` ${x.cat || '기타'} · ${x.paidBy || d.members[0]} 냄`)]),
      el('span', { class: 'nowrap' }, formatCurrency(x.amount, 'KRW')),
      el('button', {
        type: 'button', class: 'tool-remove', 'aria-label': `${x.name} 지우기`,
        onclick: () => {
          if (!confirm(`‘${x.name}’ 기록을 지울까요?`)) return;
          const n = _tripData(g); n.expenses.splice(i, 1); _saveTripData(g, n); paint();
        },
      }, '×'),
    ])));
    const sums = {};
    d.expenses.forEach(x => { const c = x.cat || '기타'; sums[c] = (sums[c] || 0) + x.amount; });
    byCat.replaceChildren(...Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
      el('div', { class: 'money-row' }, [el('dt', {}, c), el('dd', {}, formatCurrency(v, 'KRW'))])));
    byCat.hidden = !d.expenses.length;
    const st = settle(d.expenses, d.members);
    summary.textContent = `쓴 돈 ${formatCurrency(st.total, 'KRW')}` + (g.budget ? ` · 예산 ${formatCurrency(g.budget, 'KRW')} 중 ${Math.round(st.total / g.budget * 100)}%` : '');
    settleBox.replaceChildren(...(d.members.length > 1 && d.expenses.length ? [
      el('p', { class: 'exp-settle-h' }, `똑같이 나누면 1인당 ${formatCurrency(st.share, 'KRW')}`),
      ...(st.moves.length ? st.moves.map(m => el('p', {}, `${m.from} → ${m.to} ${formatCurrency(m.amount, 'KRW')}`)) : [el('p', {}, '정산할 금액이 없어요')]),
    ] : []));
    exportBtn.disabled = !d.expenses.length;
  };

  const add = el('button', {
    type: 'button', class: 'btn btn-soft',
    onclick: () => {
      const value = Math.round(Number(amount.value));
      if (!name.value.trim() || !Number.isFinite(value) || value <= 0 || value > 1e10) {
        showToast('항목과 금액을 입력해 주세요');
        (name.value.trim() ? amount : name).focus();
        return;
      }
      const d = _tripData(g);
      d.expenses.push({ name: name.value.trim(), amount: value, cat: cat.value, paidBy: payer.value || d.members[0], date: new Date().toISOString().slice(0, 10) });
      _saveTripData(g, d);
      name.value = ''; amount.value = '';
      paint();
      name.focus();
    },
  }, '추가');
  membersInput.addEventListener('change', () => {
    const names = [...new Set(membersInput.value.split(/[,，]/).map(s => s.trim()).filter(Boolean))].slice(0, 12);
    const d = _tripData(g); d.members = names.length ? names : ['나']; _saveTripData(g, d); paint();
  });
  const exportBtn = el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _downloadCsv(g, _tripData(g)) }, 'CSV로 내보내기');

  const field = (id, label, input) => el('div', { class: 'exp-field' }, [el('label', { class: 'form-label', for: id }, label), input]);
  wrap.append(
    field('expMembers', '함께 쓰는 사람 (쉼표로 구분)', membersInput),
    el('div', { class: 'exp-form' }, [
      field('expName', '항목', name), field('expAmount', '금액(원)', amount),
      field('expCat', '분류', cat), field('expPayer', '낸 사람', payer),
    ]),
    add, list, summary, byCat, settleBox, el('div', { class: 'tool-actions' }, [exportBtn]),
    el('p', { class: 'tool-note' }, '경비 기록은 이 기기에만 저장돼요.'),
  );
  paint();
  return wrap;
}

/* ============ 준비물 ============ */
function _checklistItems(g) {
  const items = [...BASE_CHECKLIST];
  if (g.country === '대한민국') items.splice(0, 1, '신분증');
  if (CURRENCY_BY_COUNTRY[g.country]) items.push('여행지 전원 어댑터');
  if (g.companion === 'family') items.push('아이 간식·놀이용품');
  return items;
}

function _checklistEl(g) {
  const box = el('div', { class: 'tool-list', id: 'toolChecklist' });
  _paintChecklist(g, box, _checklistItems(g));
  return box;
}

function _paintChecklist(g, box, items) {
  const { checked } = _tripData(g);
  box.textContent = '';
  items.forEach(item => {
    const cb = el('input', {
      type: 'checkbox', checked: checked.includes(item),
      onchange: (e) => {
        const d = _tripData(g);
        d.checked = e.target.checked ? [...new Set([...d.checked, item])] : d.checked.filter(x => x !== item);
        _saveTripData(g, d);
      },
    });
    box.appendChild(el('label', { class: 'tool-check' }, [cb, item]));
  });
}

/** 예보가 나오면 날씨에 맞는 준비물을 더한다. */
function _addWeatherItems(g, rows) {
  const box = $('#toolChecklist');
  if (!box) return;
  const items = _checklistItems(g);
  if (rows.some(r => (r.rain ?? 0) >= 50)) items.push('우산·우비');
  if (rows.some(r => r.min <= 5)) items.push('두꺼운 외투');
  if (rows.some(r => r.max >= 28)) items.push('자외선 차단제');
  _paintChecklist(g, box, items);
}

/* ============ 내보내기 ============ */
function _icsText(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/* 여행지 현지 시간대 — 캘린더 앱이 현지 시각 그대로 넣도록 TZID 를 붙인다. 모르면 시간대 없이(기기 시간) 둔다. */
const TZ_BY_CITY = { 뉴욕: 'America/New_York', 로스앤젤레스: 'America/Los_Angeles', 샌프란시스코: 'America/Los_Angeles', 라스베이거스: 'America/Los_Angeles', 하와이: 'Pacific/Honolulu', 호놀룰루: 'Pacific/Honolulu', 시카고: 'America/Chicago', 발리: 'Asia/Makassar', 퍼스: 'Australia/Perth', 밴쿠버: 'America/Vancouver', 토론토: 'America/Toronto' };
const TZ_BY_COUNTRY = {
  대한민국: 'Asia/Seoul', 일본: 'Asia/Tokyo', 중국: 'Asia/Shanghai', 홍콩: 'Asia/Hong_Kong', 대만: 'Asia/Taipei', 마카오: 'Asia/Macau',
  태국: 'Asia/Bangkok', 베트남: 'Asia/Ho_Chi_Minh', 싱가포르: 'Asia/Singapore', 말레이시아: 'Asia/Kuala_Lumpur', 필리핀: 'Asia/Manila',
  인도네시아: 'Asia/Jakarta', 인도: 'Asia/Kolkata', 괌: 'Pacific/Guam', 북마리아나: 'Pacific/Saipan', 호주: 'Australia/Sydney', 뉴질랜드: 'Pacific/Auckland',
  미국: 'America/New_York', 캐나다: 'America/Toronto', 영국: 'Europe/London', 프랑스: 'Europe/Paris', 독일: 'Europe/Berlin', 이탈리아: 'Europe/Rome',
  스페인: 'Europe/Madrid', 포르투갈: 'Europe/Lisbon', 네덜란드: 'Europe/Amsterdam', 스위스: 'Europe/Zurich', 오스트리아: 'Europe/Vienna', 체코: 'Europe/Prague',
  그리스: 'Europe/Athens', 튀르키예: 'Europe/Istanbul', 터키: 'Europe/Istanbul', 아랍에미리트: 'Asia/Dubai', 스웨덴: 'Europe/Stockholm', 노르웨이: 'Europe/Oslo',
};
function _tzFor(g) { return TZ_BY_CITY[g.city] || TZ_BY_COUNTRY[g.country] || ''; }

function _addMinutes(date, hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h, m + minutes));
}
function _icsTime(d) {
  return d.toISOString().slice(0, 16).replace(/[-:]/g, '') + '00';
}

export function buildIcs(g) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//3 Second Trip//KO', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${_icsText(g.title || g.city + ' 여행')}`];
  const tz = _tzFor(g);
  const dt = (name, d) => tz ? `${name};TZID=${tz}:${_icsTime(d)}` : `${name}:${_icsTime(d)}`;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  g.days.forEach((d, di) => {
    (d.activities || []).forEach((a, ai) => {
      if (!d.date || !/^\d{1,2}:\d{2}$/.test(a.time || '')) return;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${di}-${ai}-${stamp}@3secondtrip`,
        `DTSTAMP:${stamp}`,
        dt('DTSTART', _addMinutes(d.date, a.time, 0)),
        dt('DTEND', _addMinutes(d.date, a.time, 60)),
        `SUMMARY:${_icsText(a.name)}`,
        `LOCATION:${_icsText(a.address || a.name)}`,
        `DESCRIPTION:${_icsText([`${di + 1}일차 · ${a.category || ''}`, a.memo].filter(Boolean).join('\n'))}`,
        'END:VEVENT',
      );
    });
  });
  lines.push('END:VCALENDAR');
  return lines.map(_fold).join('\r\n') + '\r\n';
}

/** iCalendar 는 한 줄 75바이트 — 한글 장소명이 길면 접어서 이어 쓴다. */
function _fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function _downloadIcs(g) {
  const url = URL.createObjectURL(new Blob([buildIcs(g)], { type: 'text/calendar;charset=utf-8' }));
  const a = el('a', { href: url, download: `3초여행-${g.city}.ics` });
  a.click();
  URL.revokeObjectURL(url);
  trackEvent('trip_exported');
  showToast('캘린더 파일을 저장했어요');
}

function _exportEl(g) {
  return el('div', { class: 'tool-actions' }, [
    el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _downloadIcs(g) }, '캘린더 저장'),
    el('button', {
      type: 'button', class: 'btn btn-soft',
      onclick: () => { trackEvent('trip_exported'); _printAll(g); },
    }, 'PDF로 저장'),
    el('p', { class: 'tool-note' }, `캘린더 파일은 ${_tzFor(g) ? '여행지 현지 시간대' : '이 기기 시간대'}로 들어가요. PDF는 인쇄 창에서 ‘PDF로 저장’을 고르세요.`),
  ]);
}

/** PDF(인쇄) — 화면에 보이는 하루가 아니라 전체 일정을 한 문서로 만든다. */
function _printAll(g) {
  document.getElementById('printSheet')?.remove();
  const sheet = el('div', { id: 'printSheet', 'aria-hidden': 'true' }, [
    el('h1', {}, g.title || `${g.originName ? g.originName + ' → ' : ''}${g.city} 여행`),
    el('p', { class: 'ps-sub' }, `${g.days[0]?.date || ''} ~ ${g.days.at(-1)?.date || ''} · ${g.days.length}일`),
    ...g.days.map((d, di) => el('section', { class: 'ps-day' }, [
      el('h2', {}, `${di + 1}일차 · ${d.date}`),
      el('table', {}, [el('tbody', {}, (d.activities || []).map(a => el('tr', {}, [
        el('td', { class: 'ps-time' }, a.time || ''),
        el('td', {}, [el('strong', {}, a.name || ''), a.address ? el('div', { class: 'ps-addr' }, a.address) : null, a.memo ? el('div', { class: 'ps-addr' }, '메모: ' + a.memo) : null]),
        el('td', { class: 'ps-cat' }, a.category || ''),
      ])))]),
    ])),
    el('p', { class: 'ps-sub' }, '3초 여행에서 만든 일정 · 금액과 영업시간은 방문 전에 확인해 주세요.'),
  ]);
  document.body.appendChild(sheet);
  const done = () => { sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
