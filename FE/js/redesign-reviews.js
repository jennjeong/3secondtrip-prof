/* 3초 여행 — Redesign Reviews
 * Posts reviews via api.saveReview() (tolerates 404/501 from stub),
 * caches them locally so we always have something to show, and renders
 * both the form (schedule page) and the preview (home page).
 */

import { api } from './redesign-api-adapter.js';
import { $, $$, el, showToast } from './redesign-ui.js';

const LOCAL_KEY = 'tst_reviews_v1';
let appState = null;
let star = 0;
const tags = new Set();

const MOCK_REVIEWS = [
  // 실제 후기가 쌓이기 전까지 보여 주는 예시 — 화면에 '예시' 배지를 붙인다.
  { stars: 5, text: '날짜와 예산만 넣었는데 하루씩 일정이 나와서 편했어요.', tags: ['효율','가성비'], city: '도쿄', at: '2026-04-12', sample: true },
  { stars: 4, text: '제주 힐링 코스를 바탕으로 동선만 조금 고쳐서 썼어요.', tags: ['힐링'],         city: '제주', at: '2026-04-03', sample: true },
  { stars: 5, text: '예상 비용이 날짜별로 나뉘어 있어 예산 잡기 쉬웠어요.',   tags: ['프리미엄'],     city: '파리', at: '2026-03-28', sample: true },
];

let sending = false;
let lastSentKey = '';

function _paintStars() {
  $$('#starRow .star').forEach(s => {
    const n = Number(s.dataset.star);
    s.classList.toggle('is-on', n <= star);
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', String(n === star));
  });
  const out = $('#starValue'); if (out) out.textContent = star ? `별점 ${star}점 선택됨` : '';
}

export function initReviews(state) {
  appState = state;
  _paintStars();
  $$('#reviewTags [data-rtag]').forEach(b => b.setAttribute('aria-pressed', 'false'));

  $('#starRow')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-star]');
    if (!b) return;
    star = Number(b.dataset.star);
    _paintStars();
  });
  // 호버 시에도 1~n 별이 누적으로 칠해지도록(CSS :hover는 단일 별만 칠해짐)
  $('#starRow')?.addEventListener('mouseover', (e) => {
    const b = e.target.closest?.('[data-star]'); if (!b) return;
    const n = Number(b.dataset.star);
    $$('#starRow .star').forEach(s => s.classList.toggle('hov', Number(s.dataset.star) <= n));
  });
  $('#starRow')?.addEventListener('mouseleave', () => {
    $$('#starRow .star').forEach(s => s.classList.remove('hov'));
  });
  $('#reviewTags')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-rtag]');
    if (!b) return;
    const t = b.dataset.rtag;
    if (tags.has(t)) tags.delete(t); else tags.add(t);
    b.classList.toggle('is-active', tags.has(t));
    b.setAttribute('aria-pressed', String(tags.has(t)));
  });
  $('#reviewForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _submit();
  });
}

async function _submit() {
  if (sending) return;                                  // 두 번 눌러도 한 번만 보낸다
  const err = $('#reviewError');
  const fail = (msg, focusSel) => { if (err) { err.textContent = msg; err.hidden = false; } $(focusSel)?.focus(); };
  if (err) err.hidden = true;
  if (star < 1) return fail('별점을 골라 주세요.', '#starRow .star');
  const text = $('#reviewText').value.trim();
  if (text.length < 3) return fail('후기를 세 글자 이상 적어 주세요.', '#reviewText');
  const vis = document.querySelector('input[name="reviewVisibility"]:checked')?.value;
  if (!vis) return fail('공개 범위를 골라 주세요.', 'input[name="reviewVisibility"]');
  // 서버 형식(rating·content·concept_tags·is_public)으로 보낸다.
  const payload = {
    rating: star,
    content: text,
    concept_tags: [...tags],
    is_public: vis === 'public',
    city: appState.generated?.city || '',
  };
  const key = JSON.stringify(payload);
  if (key === lastSentKey) { showToast('이미 등록한 후기예요'); return; }
  // 공개 후기는 다른 여행자에게 보이므로 게시 전에 한 번 확인한다.
  if (payload.is_public && !confirm(`이 후기를 공개로 게시할까요?\n다른 여행자가 볼 수 있어요(닉네임·도시·별점·내용). 메모·경비·일정 세부는 올라가지 않아요.`)) return;

  const btn = $('#reviewForm [type="submit"]');
  sending = true;
  if (btn) { btn.disabled = true; btn.textContent = '등록하는 중…'; }
  try {
    if (!appState.currentUser) {
      _cacheLocal({ stars: star, text, tags: [...tags], city: payload.city, at: new Date().toISOString().slice(0, 10), local: true });
      lastSentKey = key;
      showToast('이 기기에만 저장했어요. 로그인하면 후기를 게시할 수 있어요', 3000);
      _resetForm();
    } else {
      await api.saveReview(payload);
      lastSentKey = key;
      showToast(payload.is_public ? '후기를 공개로 게시했어요 · 마이 › 내 후기에서 고칠 수 있어요' : '나만 보는 후기로 저장했어요 · 마이 › 내 후기에서 고칠 수 있어요', 3000);
      _resetForm();
    }
  } catch (e) {
    // 실패하면 입력은 그대로 두고 다시 시도할 수 있게 한다.
    fail(e?.status === 401 ? '로그인이 만료됐어요. 다시 로그인한 뒤 등록해 주세요.' : '후기를 등록하지 못했어요. 입력한 내용은 그대로 있으니 다시 눌러 주세요.', '#reviewForm [type="submit"]');
  } finally {
    sending = false;
    if (btn) { btn.disabled = false; btn.textContent = '후기 등록'; }
  }
  renderReviewSection();
  renderReviewPreview();
}

function _resetForm() {
  star = 0; tags.clear();
  _paintStars();
  $$('#reviewTags .chip-mini').forEach(c => { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
  $('#reviewText').value = '';
  $$('input[name="reviewVisibility"]').forEach(r => { r.checked = false; });
}

function _cacheLocal(r) {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    arr.unshift(r);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr.slice(0, 50)));
  } catch (_) {}
}

function _allReviews() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (_) {}
  return [...local, ...MOCK_REVIEWS];
}

export function renderReviewSection() {
  const wrap = $('#reviewList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const list = _allReviews().slice(0, 5);
  list.forEach(r => wrap.appendChild(_itemEl(r)));
}

export function renderReviewPreview() {
  const wrap = $('#reviewPreviewList');
  const sec = $('#reviewPreviewSection');
  if (!wrap || !sec) return;
  const list = _allReviews().slice(0, 4);
  if (list.length === 0) { sec.hidden = true; return; }
  sec.hidden = false;
  wrap.innerHTML = '';
  list.forEach(r => wrap.appendChild(_previewEl(r)));
}

function _itemEl(r) {
  return el('div', { class: 'review-item' }, [
    el('div', { class: 'rv-stars' }, [
      el('span', { 'aria-label': `별점 5점 중 ${r.stars}점`, role: 'img' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)),
      r.sample ? el('span', { class: 'rv-sample' }, '예시') : null,
    ]),
    el('div', { class: 'rv-text' }, r.text),
    el('div', { class: 'rv-meta' }, `${r.city || ''} · ${(r.tags || []).join(' · ') || ''} · ${r.at || ''}`),
  ]);
}

function _previewEl(r) {
  return el('div', { class: 'review-preview' }, [
    el('div', { class: 'rv-stars' }, [
      el('span', { 'aria-label': `별점 5점 중 ${r.stars}점`, role: 'img' }, '★'.repeat(r.stars)),
      r.sample ? el('span', { class: 'rv-sample' }, '예시') : null,
    ]),
    el('div', { class: 'rv-text' }, r.text),
    el('div', { class: 'rv-meta' }, `${r.city || ''} · ${r.at || ''}`),
  ]);
}
