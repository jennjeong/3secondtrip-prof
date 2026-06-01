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
  { stars: 5, text: '3초 만에 일정이 나와서 정말 편했어요!', tags: ['효율','가성비'], city: '도쿄', at: '2026-04-12' },
  { stars: 4, text: '제주 힐링 루트 추천해줘서 좋았습니다.',     tags: ['힐링'],         city: '제주', at: '2026-04-03' },
  { stars: 5, text: '예약까지 한 번에 해결되니 신세계네요.',     tags: ['프리미엄'],     city: '파리', at: '2026-03-28' },
];

export function initReviews(state) {
  appState = state;

  $('#starRow')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-star]');
    if (!b) return;
    star = Number(b.dataset.star);
    $$('#starRow .star').forEach(s => s.classList.toggle('is-on', Number(s.dataset.star) <= star));
  });
  $('#reviewTags')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-rtag]');
    if (!b) return;
    const t = b.dataset.rtag;
    if (tags.has(t)) tags.delete(t); else tags.add(t);
    b.classList.toggle('is-active');
  });
  $('#reviewForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _submit();
  });
}

async function _submit() {
  if (star < 1) { showToast('별점을 선택해 주세요'); return; }
  const text = $('#reviewText').value.trim();
  if (text.length < 3) { showToast('짧은 후기를 적어주세요'); return; }
  const payload = {
    stars: star,
    text,
    tags: [...tags],
    public: !!$('#reviewPublic').checked,
    city: appState.generated?.city || '',
    at: new Date().toISOString().slice(0, 10),
  };
  const res = await api.saveReview(payload);
  // Always store locally so the user sees their review immediately
  _cacheLocal(payload);
  if (res) showToast('후기가 등록되었어요');
  else showToast('후기를 임시 저장했어요');
  // Reset
  star = 0; tags.clear();
  $$('#starRow .star').forEach(s => s.classList.remove('is-on'));
  $$('#reviewTags .chip-mini').forEach(c => c.classList.remove('is-active'));
  $('#reviewText').value = '';
  renderReviewSection();
  renderReviewPreview();
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
    el('div', { class: 'rv-stars' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)),
    el('div', { class: 'rv-text' }, r.text),
    el('div', { class: 'rv-meta' }, `${r.city || ''} · ${(r.tags || []).join(' · ') || ''} · ${r.at || ''}`),
  ]);
}

function _previewEl(r) {
  return el('div', { class: 'review-preview' }, [
    el('div', { class: 'rv-stars' }, '★'.repeat(r.stars)),
    el('div', { class: 'rv-text' }, r.text),
    el('div', { class: 'rv-meta' }, `${r.city || ''} · ${r.at || ''}`),
  ]);
}
