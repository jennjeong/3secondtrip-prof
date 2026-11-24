/* 3초 여행 — Redesign Trip Tools
 * 일정 아래의 여행 도구 묶음: 날씨, 환율, 경비 기록, 준비물, 내보내기.
 * 날씨·환율은 키가 필요 없는 공개 API를 쓰고, 실패하면 그 줄만 숨긴다.
 * 경비와 준비물은 기기에만 저장한다(localStorage).
 */

import { api, trackEvent } from './redesign-api-adapter.js';
import { $, el, formatCurrency, showToast } from './redesign-ui.js';
import { timeZoneFor, utcOffsetMin, utcLabel } from './redesign-cities.js';

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
/** 여행마다 고정된 번호 — 기간·도시를 바꿔 다시 만들어도 경비·준비물이 따라온다.
 *  예전 방식(도시|출발일|일수)으로 저장된 기록은 처음 열 때 새 번호로 옮긴다. */
function _legacyKey(g) { return `${g.city}|${g.days[0]?.date || ''}|${g.days.length}`; }
function _tripKey(g) {
  if (!g.tripUid) {
    g.tripUid = 'trip-' + String(g.createdAt || Date.now()).replace(/[^0-9A-Za-z]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
    document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
  }
  const store = _readStore();
  const old = _legacyKey(g);
  if (!store[g.tripUid] && store[old]) {
    store[g.tripUid] = store[old]; delete store[old];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  }
  return g.tripUid;
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
    _section('weather', '날씨', el('div', { id: 'toolWeather', class: 'tool-weather' }, '불러오는 중…')),
    _section('rate', '환율', el('p', { id: 'toolRate', class: 'tool-note' }, '불러오는 중…')),
    _section('expense', '경비 기록', _expenseEl(g)),
    _section('checklist', '준비물', _checklistEl(g)),
    _section('export', '내보내기', _exportEl(g)),
  );
  _loadWeather(g, key);
  _loadRate(g, key);
}

function _section(key, title, body) {
  return el('section', { class: 'tool-card', dataset: { tool: key }, 'aria-label': title }, [el('h3', { class: 'tool-title' }, title), body]);
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
    fetched[`wt:${key}`] = new Date();
  }
  const target = box();
  if (!target) return;
  if (!rows?.length) { target.textContent = '날씨 정보를 불러오지 못했어요.'; return; }
  target.textContent = '';
  rows.forEach((r, i) => target.appendChild(el('div', { class: 'tool-day' }, [
    el('strong', {}, `${i + 1}일차 · ${r.date.slice(5, 7)}/${r.date.slice(8, 10)}`),
    el('span', {}, _weatherLabel(r.code)),
    el('span', {}, `${r.min}° / ${r.max}°`),
    el('span', { class: 'tool-note' }, `비 ${r.rain ?? '-'}%`),
  ])));
  _rainSwapOffer(g, rows, target);
  target.appendChild(el('p', { class: 'tool-note' }, `출처: Open-Meteo 일기예보 · 여행지 현지 날짜 기준 · ${(fetched[`wt:${key}`] || new Date()).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회. 출발이 가까울수록 정확해져요.`));
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
      rate = j?.rates?.[currency] ? { value: j.rates[currency], date: j.date || '', at: new Date() } : null;
    } catch (_) { rate = null; }
    fetched[`r:${currency}`] = rate;
  }
  const box = target();
  if (!box) return;
  if (!rate) { box.textContent = '환율 정보를 불러오지 못했어요.'; return; }
  const krwPerUnit = (currency === 'JPY' || currency === 'IDR' ? 100 : 1) / rate.value;
  const unit = currency === 'JPY' || currency === 'IDR' ? 100 : 1;
  box.textContent = `${unit.toLocaleString('ko-KR')} ${currency} ≈ ${Math.round(krwPerUnit).toLocaleString('ko-KR')}원 · ${rate.date ? rate.date + ' ' : ''}유럽중앙은행 고시 기준 (Frankfurter, ${rate.at ? rate.at.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' 조회' : '조회 시각 모름'}). 실제 환전·카드 결제 금액은 수수료 때문에 달라요.`;
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

  let editing = -1;          // 수정 중인 기록 번호
  let lastDeleted = null;    // { item, index } — 되돌리기용
  const undoBar = el('div', { class: 'exp-undo', role: 'status', hidden: true });
  const resetForm = () => {
    editing = -1; name.value = ''; amount.value = '';
    add.textContent = '추가'; cancelEdit.hidden = true;
  };
  const startEdit = (i) => {
    const x = _tripData(g).expenses[i]; if (!x) return;
    editing = i; name.value = x.name; amount.value = x.amount; cat.value = x.cat || '기타';
    payer.value = x.paidBy || payer.value;
    add.textContent = '수정 저장'; cancelEdit.hidden = false; name.focus();
  };
  const showUndo = () => {
    if (!lastDeleted) { undoBar.hidden = true; return; }
    undoBar.replaceChildren(`‘${lastDeleted.item.name}’ 기록을 지웠어요`, el('button', { type: 'button', class: 'btn-text', onclick: () => {
      const n = _tripData(g); n.expenses.splice(Math.min(lastDeleted.index, n.expenses.length), 0, lastDeleted.item);
      _saveTripData(g, n); lastDeleted = null; paint(); showUndo(); showToast('되돌렸어요');
    } }, '되돌리기'));
    undoBar.hidden = false;
    clearTimeout(showUndo._t); showUndo._t = setTimeout(() => { lastDeleted = null; undoBar.hidden = true; }, 8000);
  };

  const paint = () => {
    const d = _tripData(g);
    membersInput.value = d.members.join(', ');
    payer.replaceChildren(...d.members.map(m => el('option', { value: m }, m)));
    list.replaceChildren(...d.expenses.map((x, i) => el('div', { class: 'tool-row exp-row' }, [
      el('span', {}, [x.name, el('small', {}, ` ${x.cat || '기타'} · ${x.paidBy || d.members[0]} 냄`)]),
      el('span', { class: 'nowrap' }, formatCurrency(x.amount, 'KRW')),
      el('button', { type: 'button', class: 'tool-edit', 'aria-label': `${x.name} 수정`, onclick: () => startEdit(i) }, '수정'),
      el('button', {
        type: 'button', class: 'tool-remove', 'aria-label': `${x.name} 지우기`,
        onclick: () => {
          const n = _tripData(g); const [item] = n.expenses.splice(i, 1); _saveTripData(g, n);
          lastDeleted = { item, index: i }; if (editing === i) resetForm(); paint(); showUndo();
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
    type: 'button', class: 'btn btn-primary',
    onclick: () => {
      const value = Math.round(Number(amount.value));
      if (!name.value.trim() || !Number.isFinite(value) || value <= 0 || value > 1e10) {
        showToast('항목과 금액을 입력해 주세요');
        (name.value.trim() ? amount : name).focus();
        return;
      }
      const d = _tripData(g);
      const rec = { name: name.value.trim(), amount: value, cat: cat.value, paidBy: payer.value || d.members[0] };
      if (editing >= 0 && d.expenses[editing]) {
        d.expenses[editing] = { ...d.expenses[editing], ...rec, editedAt: new Date().toISOString() };
        showToast('기록을 고쳤어요');
      } else {
        d.expenses.push({ ...rec, date: new Date().toISOString().slice(0, 10) });
      }
      _saveTripData(g, d);
      resetForm();
      paint();
      name.focus();
    },
  }, '추가');
  const cancelEdit = el('button', { type: 'button', class: 'btn btn-ghost', hidden: true, onclick: () => { resetForm(); name.focus(); } }, '수정 취소');
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
    el('div', { class: 'exp-actions' }, [add, cancelEdit]), undoBar, list, summary, byCat, settleBox, el('div', { class: 'tool-actions' }, [exportBtn]),
    el('p', { class: 'tool-note' }, '경비·준비물은 이 여행에 묶여 이 기기에 저장돼요. 조건을 바꿔 다시 만들어도 남아요.'),
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
/* ============ 비 오는 날 실내 위주로 ============
 * 비 올 확률 60% 이상인 날, 야외 장소(관광·액티비티 중 실내가 아닌 곳)를 실내 장소로 바꾸자고 제안한다.
 * 고정한 장소·숙소·이동은 건드리지 않고, 시각은 그대로 둔다. */
const RAIN_LIMIT = 60;
const INDOOR_RE = /박물관|미술관|갤러리|수족관|아쿠아|쇼핑|몰|백화점|시장|카페|실내|전시|museum|gallery|aquarium|mall|market|theater|극장|공연|스파|온천/i;
const OUTDOOR_CATS = new Set(['관광', '액티비티']);

function _rainyDayIndexes(g, rows) {
  const out = [];
  rows.forEach(r => {
    if ((r.rain ?? 0) < RAIN_LIMIT) return;
    const di = g.days.findIndex(d => d.date === r.date);
    if (di < 0) return;
    const n = (g.days[di].activities || []).filter(a => OUTDOOR_CATS.has(a.category) && !a.pinned && !INDOOR_RE.test(a.name || '')).length;
    if (n) out.push({ di, n, rain: r.rain });
  });
  return out;
}

function _rainSwapOffer(g, rows, target) {
  const days = _rainyDayIndexes(g, rows);
  if (!days.length) return;
  target.appendChild(el('div', { class: 'rain-offer' }, days.map(x => el('div', { class: 'rain-row' }, [
    el('span', {}, `${x.di + 1}일차 비 ${x.rain}% · 야외 일정 ${x.n}곳`),
    el('button', { type: 'button', class: 'btn btn-soft', onclick: async (e) => { const row = e.currentTarget.closest('.rain-row'); if (await _swapIndoor(x.di) && row) row.hidden = true; } }, '실내 위주로 바꾸기'),
  ]))));
}

async function _swapIndoor(di) {
  const g = appState?.generated;
  const day = g?.days?.[di];
  if (!day) return;
  const targets = day.activities.map((a, i) => ({ a, i })).filter(({ a }) => OUTDOOR_CATS.has(a.category) && !a.pinned && !INDOOR_RE.test(a.name || ''));
  if (!targets.length) return false;
  if (!confirm(`${di + 1}일차 야외 일정 ${targets.length}곳을 실내 장소로 바꿀까요?\n고정한 장소와 숙소·이동은 그대로 두고, 시각도 그대로예요.`)) return false;
  // 실내 후보 — 장소 검색이 되면 실제 장소, 안 되면 예시 장소
  let cands = [];
  try {
    const f = await api.features();
    if (f.places !== false) {
      const res = await api.searchPlaces({ query: `${g.city} 실내 박물관 미술관 수족관`, language_code: 'ko', language: 'ko', max_results: 12 });
      cands = (res?.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    }
  } catch (_) { cands = []; }
  const used = new Set(g.days.flatMap(d => d.activities.map(a => a.placeId)));
  const samples = ['시립 박물관', '현대 미술관', '수족관', '대형 쇼핑몰', '실내 전시관'];
  let si = 0;
  targets.forEach(({ a }) => {
    const pick = cands.find(c => !used.has(c.place_id));
    const before = a.name;
    if (pick) {
      used.add(pick.place_id);
      Object.assign(a, { name: pick.name, placeId: pick.place_id, latitude: pick.latitude, longitude: pick.longitude,
        address: pick.address || '', googleMapsQuery: pick.name, openingPeriods: pick.opening_periods || null, sample: false });
    } else {
      const n = samples[si++ % samples.length];
      Object.assign(a, { name: `${n} · ${g.city}`, placeId: `${g.city}-indoor-${di}-${si}`, address: '', googleMapsQuery: `${n} ${g.city}`,
        latitude: undefined, longitude: undefined, openingPeriods: null, sample: true });
    }
    a.category = '관광';
    a.edited = true;
    a.rainSwap = before;
  });
  document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
  document.dispatchEvent(new CustomEvent('redesign:activities-resolved'));
  trackEvent('rain_swap_applied');
  showToast(`${di + 1}일차 야외 일정 ${targets.length}곳을 실내 장소로 바꿨어요${cands.length ? '' : ' · 예시 장소라 실제 장소로 바꿔 주세요'}`, 3600);
  return true;
}

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

/* 캘린더 파일 — 일정의 시각은 여행지 현지 시각이다.
 * TZID 만 붙이면(VTIMEZONE 없이) 일부 캘린더 앱이 기기 시간대로 읽어 시각이 어긋나므로,
 * 그날의 시차로 UTC 로 바꿔 'Z' 시각으로 적는다 — 어느 앱에서나 같은 순간을 가리킨다.
 * 같은 일정을 다시 내보내면 UID 가 같아서 캘린더가 새로 만들지 않고 고친다. */
const _DWELL = { '식사': 75, '카페': 60, '관광': 90, '쇼핑': 90, '액티비티': 120, '숙박': 30, '이동': 60 };
function _tzFor(g) { return g.timeZone || timeZoneFor(g.city, g.country) || ''; }

/** 현지 날짜·시각(+분) → UTC Date.  시간대를 모르면 null(기기 시간으로 적는다). */
function _utcFromLocal(date, hhmm, plusMin, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, m + plusMin);
  const off = tz ? utcOffsetMin(tz, date) : null;
  return off == null ? null : new Date(asUtc - off * 60000);
}
function _floating(date, hhmm, plusMin) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m + plusMin)).toISOString().slice(0, 16).replace(/[-:]/g, '') + '00';
}
function _utcStamp(d) { return d.toISOString().slice(0, 16).replace(/[-:]/g, '') + '00Z'; }

export function buildIcs(g) {
  const tz = _tzFor(g);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//3 Second Trip//KO', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${_icsText(g.title || g.city + ' 여행')}`, ...(tz ? [`X-WR-TIMEZONE:${tz}`] : [])];
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const tripId = String(g.createdAt || g.startDate || g.city).replace(/[^0-9A-Za-z]/g, '');
  const at = (name, date, time, plus) => {
    const u = _utcFromLocal(date, time, plus, tz);
    return u ? `${name}:${_utcStamp(u)}` : `${name}:${_floating(date, time, plus)}`;   // 모르면 '떠 있는 시각'
  };
  g.days.forEach((d, di) => {
    const acts = (d.activities || []);
    acts.forEach((a, ai) => {
      if (!d.date || !/^\d{1,2}:\d{2}$/.test(a.time || '')) return;
      // 끝 시각: 다음 장소 시작 전까지(최대 체류 시간), 없으면 장소 종류별 체류 시간
      const next = acts.slice(ai + 1).find(x => /^\d{1,2}:\d{2}$/.test(x.time || ''));
      const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const dwell = _DWELL[a.category] ?? 60;
      let len = dwell;
      if (next) { const gap = toMin(next.time) - toMin(a.time); if (gap > 0) len = Math.min(dwell, gap); }
      len = Math.max(15, len);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${tripId}-${di}-${ai}@3secondtrip`,
        `DTSTAMP:${stamp}`,
        at('DTSTART', d.date, a.time, 0),
        at('DTEND', d.date, a.time, len),
        `SUMMARY:${_icsText(a.name)}`,
        `LOCATION:${_icsText(a.address && !/예시 항공편/.test(a.address) ? a.address : a.name)}`,
        `DESCRIPTION:${_icsText([`${di + 1}일차 · ${a.category || ''} · 현지 ${a.time}`, a.memo].filter(Boolean).join('\n'))}`,
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
    el('p', { class: 'tool-note' }, _tzFor(g)
      ? `캘린더에는 여행지 현지 시각(${utcLabel(utcOffsetMin(_tzFor(g), g.days[0]?.date))}) 그대로 들어가요. 휴대폰이 한국 시간이면 한국 시각으로 바꿔 보여 줘요. 다시 내보내면 새로 만들지 않고 고쳐져요. PDF는 인쇄 창에서 ‘PDF로 저장’을 고르세요.`
      : '여행지 시간대를 몰라 이 기기 시간대로 들어가요. PDF는 인쇄 창에서 ‘PDF로 저장’을 고르세요.'),
  ]);
}

/** PDF(인쇄) — 화면에 보이는 하루가 아니라 전체 일정을 한 문서로 만든다. */
function _printAll(g) {
  document.getElementById('printSheet')?.remove();
  const sheet = el('div', { id: 'printSheet', 'aria-hidden': 'true' }, [
    el('h1', {}, g.title || `${g.originName ? g.originName + ' → ' : ''}${g.city} 여행`),
    el('p', { class: 'ps-sub' }, `${g.days[0]?.date || ''} ~ ${g.days.at(-1)?.date || ''} · ${g.days.length}일${_tzFor(g) ? ` · 시각은 현지 시각(${utcLabel(utcOffsetMin(_tzFor(g), g.days[0]?.date))})` : ''}`),
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

/* ============ 여행 도구 목록 · 도구 창 ============
 * 일정 아래에는 도구 이름과 지금 상태만 한 줄씩 보이고, 누르면 창에서 그 도구 하나를 쓴다.
 * 도구 본문(#costSummary · #tripTools · #collabPanel)은 창 안에 있고, 고른 것에만 is-current 를 붙인다. */
const TOOL_TITLE = { cost: '비용 자세히', weather: '날씨', rate: '환율', expense: '경비 기록', checklist: '준비물', export: '내보내기', collab: '함께 편집' };
let toolOpen = '';

function _toolNode(key) {
  if (key === 'cost') return $('#costSummary');
  if (key === 'collab') return $('#collabPanel');
  return document.querySelector(`#tripTools .tool-card[data-tool="${key}"]`);
}
function _toolMeta(key) {
  const g = appState?.generated;
  if (!g) return '';
  if (key === 'cost') return $('#costRows .money-row--total dd')?.textContent || '';
  if (key === 'weather') {
    const n = document.querySelectorAll('#toolWeather .tool-day').length;
    return n ? `${n}일 예보` : /출발/.test($('#toolWeather')?.textContent || '') ? '출발 전에 볼 수 있어요' : '';
  }
  if (key === 'rate') return ($('#toolRate')?.textContent || '').match(/^[\d,]+ [A-Z]{3} ≈ [\d,]+원/)?.[0] || '';
  if (key === 'expense') {
    const sum = _tripData(g).expenses.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    return sum ? formatCurrency(sum, 'KRW') + ' 씀' : '기록 없음';
  }
  if (key === 'checklist') {
    const all = document.querySelectorAll('#toolChecklist input').length;
    const on = document.querySelectorAll('#toolChecklist input:checked').length;
    return all ? `${on}/${all}개 챙김` : '';
  }
  if (key === 'export') return '캘린더, PDF';
  if (key === 'collab') return $('#collabStart') ? '링크로 같이 고치기' : '편집 중';
  return '';
}

function _paintToolMenu() {
  const box = $('#toolMenuRows');
  if (!box) return;
  const keys = Object.keys(TOOL_TITLE).filter(k => { const n = _toolNode(k); return n && !n.hidden; });
  // 줄이 그대로면 글자만 바꾼다(누르는 중에 줄이 다시 만들어지지 않게)
  if (box.dataset.keys !== keys.join()) {
    box.dataset.keys = keys.join();
    box.replaceChildren(...keys.map(k => el('button', {
      type: 'button', class: 'setting-row', dataset: { toolOpen: k }, 'aria-haspopup': 'dialog', onclick: () => openTool(k),
    }, [
      el('span', { class: 'sr-label' }, TOOL_TITLE[k]),
      el('span', { class: 'setting-meta' }, _toolMeta(k)),
      el('span', { class: 'setting-arrow', 'aria-hidden': 'true' }, '›'),
    ])));
  } else {
    keys.forEach(k => {
      const m = box.querySelector(`[data-tool-open="${k}"] .setting-meta`);
      const t = _toolMeta(k);
      if (m && m.textContent !== t) m.textContent = t;
    });
  }
  if (toolOpen) _markCurrent();
}
function _markCurrent() {
  const cur = _toolNode(toolOpen);
  document.querySelectorAll('#toolSheet .is-current').forEach(n => { if (n !== cur) n.classList.remove('is-current'); });
  cur?.classList.add('is-current');
}

export function openTool(key) {
  const bd = $('#toolBackdrop'), sh = $('#toolSheet');
  const node = _toolNode(key);
  if (!bd || !sh || !node) return;
  toolOpen = key;
  _markCurrent();
  const t = $('#toolSheetTitle'); if (t) t.textContent = TOOL_TITLE[key];
  bd.hidden = false; sh.hidden = false;
  const body = sh.querySelector('.sheet-body'); if (body) body.scrollTop = 0;
  requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); });
}
export function closeTool() {
  const bd = $('#toolBackdrop'), sh = $('#toolSheet');
  if (!bd || !sh || sh.hidden) return;
  bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
  toolOpen = '';
  _paintToolMenu();
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 240);
}

export function initToolMenu() {
  const sh = $('#toolSheet');
  if (!sh || sh.dataset.bound) return;
  sh.dataset.bound = '1';
  $('#toolSheetClose')?.addEventListener('click', closeTool);
  $('#toolBackdrop')?.addEventListener('click', closeTool);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sh.hidden) closeTool(); });
  document.addEventListener('redesign:tool-open', (e) => openTool(e.detail));
  window.addEventListener('hashchange', closeTool);      // 다른 화면으로 가면 창도 닫는다
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; _paintToolMenu(); }); };
  const body = sh.querySelector('.sheet-body');
  new MutationObserver(later).observe(body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  body.addEventListener('change', later);
  document.addEventListener('redesign:schedule-changed', later);
  later();
}
