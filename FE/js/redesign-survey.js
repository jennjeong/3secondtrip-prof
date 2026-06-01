/* 3초 여행 — Redesign Taste Survey
 * Multi-step survey.  Saves to appState.preferences and localStorage so
 * future schedule generation can be biased by the user's taste.
 */

import { $, el, showToast } from './redesign-ui.js';
import { navigate } from './redesign-navigation.js';

const KEY = 'tst_pref_v1';
const SECTIONS = [
  { id: 'pace',    title: '여행 페이스',  options: ['느긋하게','적당히','빡빡하게'] },
  { id: 'food',    title: '음식 취향',    options: ['로컬 맛집','유명 맛집','카페','가성비'] },
  { id: 'activity',title: '활동 취향',    options: ['자연','쇼핑','문화','액티비티','사진'] },
  { id: 'budget',  title: '예산 선호',    options: ['절약','균형','프리미엄'] },
  { id: 'mobility',title: '이동 선호',    options: ['도보','대중교통','택시','렌터카'] },
];

let appState = null;
let step = 0;
let answers = {};

export function initSurvey(state) {
  appState = state;
  try { answers = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { answers = {}; }
  appState.preferences = answers;

  $('#surveyPrev')?.addEventListener('click', () => { if (step > 0) { step--; renderSurvey(); } else { navigate('my'); } });
  $('#surveyNext')?.addEventListener('click', () => {
    const s = SECTIONS[step];
    if (!answers[s.id]) { showToast('하나만 선택해 주세요'); return; }
    if (step < SECTIONS.length - 1) { step++; renderSurvey(); }
  });
  $('#surveyDone')?.addEventListener('click', _done);
}

export function renderSurvey() {
  const pane = $('#surveyPane');
  const prog = $('#surveyProgress');
  if (!pane || !prog) return;
  // Progress
  prog.innerHTML = '';
  SECTIONS.forEach((s, i) => {
    const dot = el('div', { class: 'step-dot' + (i === step ? ' is-active' : (i < step ? ' is-done' : '')) }, String(i + 1));
    prog.appendChild(dot);
    if (i < SECTIONS.length - 1) prog.appendChild(el('div', { class: 'step-line' + (i < step ? ' is-done' : '') }));
  });

  const s = SECTIONS[step];
  pane.innerHTML = '';
  pane.appendChild(el('h3', { class: 'step-h' }, s.title));
  const grid = el('div', { class: 'choice-grid choice-grid--3' });
  s.options.forEach(opt => {
    const isActive = answers[s.id] === opt;
    const card = el('button', {
      type: 'button',
      class: 'choice-card' + (isActive ? ' is-active' : ''),
      onclick: () => {
        answers[s.id] = opt;
        grid.querySelectorAll('.choice-card').forEach(c => c.classList.remove('is-active'));
        card.classList.add('is-active');
      },
    }, [
      el('span', { class: 'ch-emoji' }, _emojiFor(opt)),
      el('span', { class: 'ch-label' }, opt),
    ]);
    grid.appendChild(card);
  });
  pane.appendChild(grid);

  $('#surveyPrev').textContent = step === 0 ? '취소' : '이전';
  $('#surveyNext').hidden = step === SECTIONS.length - 1;
  $('#surveyDone').hidden = step !== SECTIONS.length - 1;
}

function _emojiFor(o) {
  return ({
    '느긋하게':'🐢','적당히':'🚶','빡빡하게':'⚡',
    '로컬 맛집':'🍜','유명 맛집':'🍽️','카페':'☕','가성비':'💰',
    '자연':'🌿','쇼핑':'🛍️','문화':'🏛️','액티비티':'🏃','사진':'📸',
    '절약':'💰','균형':'⚖️','프리미엄':'✨',
    '도보':'🚶','대중교통':'🚇','택시':'🚕','렌터카':'🚗',
  })[o] || '✨';
}

function _done() {
  const s = SECTIONS[step];
  if (!answers[s.id]) { showToast('하나만 선택해 주세요'); return; }
  try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch (_) {}
  appState.preferences = answers;
  showToast('취향이 저장되었어요. 추천에 반영됩니다.');
  navigate('my');
}
