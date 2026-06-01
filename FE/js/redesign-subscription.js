/* 3초 여행 — Subscription Page */
import { navigate } from './redesign-navigation.js';
import { $, $$, showToast } from './redesign-ui.js';

const SUB_KEY = 'tst_subscription_v1';

/** localStorage 에서 구독 상태 읽기 */
function getSubState() {
  try {
    const raw = localStorage.getItem(SUB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  // 기본: 가입 시점 자동으로 7일 무료 체험 시작
  const start = Date.now();
  const state = { plan: 'free', trialStart: start, paygCredits: 0, expiresAt: start + 7 * 24 * 3600 * 1000 };
  try { localStorage.setItem(SUB_KEY, JSON.stringify(state)); } catch (_) {}
  return state;
}

function setSubState(state) {
  try { localStorage.setItem(SUB_KEY, JSON.stringify(state)); } catch (_) {}
}

function formatRemaining(ms) {
  if (ms <= 0) return '만료됨';
  const d = Math.floor(ms / (24 * 3600 * 1000));
  if (d > 0) return `${d}일 남음`;
  const h = Math.floor(ms / (3600 * 1000));
  return `${h}시간 남음`;
}

/** 마이 페이지의 구독 상태 라벨 갱신 */
function refreshSubStatus() {
  const el = $('#subscriptionStatus');
  if (!el) return;
  const s = getSubState();
  if (s.plan === 'standard' || s.plan === 'premium') el.textContent = 'Standard 구독중';
  else if (s.plan === 'payg' && s.expiresAt && s.expiresAt > Date.now()) el.textContent = '무제한 사용중';
  else if (s.plan === 'payg' && s.paygCredits > 0) el.textContent = `${s.paygCredits}회 남음`;
  else if (s.plan === 'free' && s.expiresAt && s.expiresAt > Date.now()) el.textContent = formatRemaining(s.expiresAt - Date.now()) + ' · 무료체험';
  else el.textContent = '구독 만료 · 결제 필요';
}

export function initSubscription() {
  // 마이 → 구독 버튼
  $('#openSubscriptionBtn')?.addEventListener('click', () => {
    navigate('subscription');
  });

  // 페이지 진입 시 갱신
  document.addEventListener('redesign:nav', (e) => {
    if (e.detail.page === 'subscription') _renderActiveCTA();
    if (e.detail.page === 'my')           refreshSubStatus();
  });

  // monthly / payg 토글
  $$('.sub-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.sub-toggle-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
      const billing = btn.dataset.billing;
      const grid = $('#subGrid');
      if (grid) grid.dataset.billing = billing;
    });
  });
  // initial state — monthly
  const grid = $('#subGrid');
  if (grid) grid.dataset.billing = 'monthly';

  // 결제 버튼
  $$('[data-plan-cta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.planCta;
      _purchase(plan);
    });
  });

  // 구독 취소 버튼
  $('#btnCancelSubscription')?.addEventListener('click', _cancelSubscription);

  // 첫 라벨 갱신
  refreshSubStatus();
}

function _purchase(plan) {
  const cur = getSubState();
  if (plan === 'free') {
    showToast(cur.plan === 'free' && cur.expiresAt > Date.now()
      ? '이미 무료 체험을 사용 중이에요.'
      : '무료 체험은 가입 시 자동 시작됩니다.');
    return;
  }
  // 결제는 외부 PG가 필요하므로 현재는 mock confirm 후 상태 저장
  let label = plan;
  let next = { ...cur };
  if (plan === 'standard') { label = '월 5,900원 Standard'; next = { plan: 'standard', startedAt: Date.now() }; }
  else if (plan === 'payg') {
    const opt = document.querySelector('input[name="paygOpt"]:checked')?.value || '5';
    if (opt === '5')  { label = '5회 묶음 1,900원';  next = { plan: 'payg', paygCredits: (cur.paygCredits || 0) + 5,  startedAt: Date.now() }; }
    if (opt === '10') { label = '10회 묶음 2,900원'; next = { plan: 'payg', paygCredits: (cur.paygCredits || 0) + 10, startedAt: Date.now() }; }
    if (opt === 'unlimited') { label = '30일 무제한 4,900원'; next = { plan: 'payg', paygCredits: -1, expiresAt: Date.now() + 30*24*3600*1000, startedAt: Date.now() }; }
  }
  if (!confirm(`${label}를 결제할까요?\n\n* 결제는 시뮬레이션입니다 — 실제 PG 연동 전 단계.`)) return;
  setSubState(next);
  showToast('구독이 활성화되었어요!');
  _renderActiveCTA();
  refreshSubStatus();
}

function _renderActiveCTA() {
  const s = getSubState();
  const map = { free: 'free', standard: 'standard', payg: 'payg' };
  $$('[data-plan-cta]').forEach(btn => {
    const plan = btn.dataset.planCta;
    const active = map[s.plan] === plan;
    btn.classList.toggle('sub-cta--current', active);
    if (active) {
      btn.textContent = '현재 사용중';
    } else if (plan === 'free') btn.textContent = '무료 체험';
    else if (plan === 'payg')    btn.textContent = '결제하기';
    else                         btn.textContent = '구독하기';
  });
  _renderCancelBlock(s);
}

function _renderCancelBlock(s) {
  const block = $('#subCancelBlock');
  const planEl = $('#subCancelPlan');
  if (!block) return;
  // 활성 결제 구독일 때만 표시 (Free 또는 만료된 상태는 숨김)
  const isPaid = (
    s.plan === 'standard' || s.plan === 'premium' /* 구버전 호환 */ ||
    (s.plan === 'payg' && (s.paygCredits > 0 || (s.expiresAt && s.expiresAt > Date.now())))
  );
  if (!isPaid) { block.hidden = true; return; }
  block.hidden = false;
  let label = '-';
  if (s.plan === 'standard' || s.plan === 'premium') label = 'Standard · 월 5,900원';
  else if (s.plan === 'payg' && s.paygCredits > 0) label = `회당 결제 · ${s.paygCredits}회 남음`;
  else if (s.plan === 'payg' && s.expiresAt > Date.now()) {
    const d = Math.max(1, Math.ceil((s.expiresAt - Date.now()) / (24 * 3600 * 1000)));
    label = `회당 결제 · 30일 무제한 (${d}일 남음)`;
  }
  if (planEl) planEl.textContent = label;
}

function _cancelSubscription() {
  const s = getSubState();
  let msg = '구독을 취소하시겠어요?';
  if (s.plan === 'standard' || s.plan === 'premium') {  // premium 은 구버전 사용자 호환용
    msg = '월 구독을 취소하시겠어요?\n\n현재 결제 주기 종료일까지 사용 가능하며, 다음 결제부터 중단됩니다.';
  } else if (s.plan === 'payg' && s.paygCredits > 0) {
    msg = `남은 ${s.paygCredits}회를 환불 없이 소멸시킬까요?\n\n* 시뮬레이션 — 실제 PG 연동 시 환불 로직 추가 필요.`;
  } else if (s.plan === 'payg' && s.expiresAt > Date.now()) {
    msg = '30일 무제한 구독을 취소하시겠어요?\n\n남은 기간은 환불되지 않으며, 기간 종료 후 자동으로 Free 플랜으로 전환됩니다.';
  }
  if (!confirm(msg)) return;
  // Reset to Free with 0 trial remaining (이미 체험 종료 가정)
  const next = { plan: 'free', trialStart: s.trialStart || Date.now(), paygCredits: 0, expiresAt: 0, canceledAt: Date.now() };
  setSubState(next);
  showToast('구독이 취소되었어요.', 2400);
  _renderActiveCTA();
  refreshSubStatus();
}
