/* 3초 여행 — 요금제 화면
 *
 * 아직 결제(PG)와 서버의 구독 기록이 없다.  그래서 개인별 무료 체험 남은 기간이나
 * '구독 중' 같은 상태를 지어내지 않고, 출시 예정 요금제와 '지금은 결제 없이 이용'을
 * 사실대로 보여 준다.  결제가 연결되면 서버의 구독 상태를 읽어 이 화면을 채운다.
 */
import { navigate } from './redesign-navigation.js';
import { $, $$ } from './redesign-ui.js';

const OLD_KEY = 'tst_subscription_v1';   // 예전 '결제 시뮬레이션' 기록 — 실제 결제가 아니므로 지운다
let appState = null;

function _paint() {
  const me = appState?.currentUser;
  const meta = $('#subscriptionStatus');
  if (meta) meta.textContent = me ? '결제 없이 이용 중' : '요금제 안내';
  const note = $('#subStatusNote');
  if (note) {
    note.textContent = me
      ? `${me.nickname || '회원'}님은 지금 결제 없이 모든 기능을 쓰고 있어요. 결제·갱신 기록이 없어요.`
      : '로그인하지 않아도 모든 기능을 쓸 수 있어요. 요금제가 시작되면 이곳에서 내 이용 상태를 볼 수 있어요.';
  }
  $$('[data-plan-cta]').forEach(btn => {
    btn.disabled = true;
    btn.classList.remove('sub-cta--current');
    btn.textContent = btn.dataset.planCta === 'free' ? '지금은 모두 무료' : '출시 예정';
  });
  const cancel = $('#subCancelBlock');
  if (cancel) cancel.hidden = true;
}

export function initSubscription(state) {
  appState = state || appState;
  try { localStorage.removeItem(OLD_KEY); } catch (_) {}

  $('#openSubscriptionBtn')?.addEventListener('click', () => navigate('subscription'));
  document.addEventListener('redesign:nav', (e) => {
    if (e.detail.page === 'subscription' || e.detail.page === 'my') _paint();
  });
  document.addEventListener('redesign:auth-ready', _paint);

  // 월 구독 / 회당 결제 요금표 전환
  $$('.sub-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.sub-toggle-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
      const grid = $('#subGrid');
      if (grid) grid.dataset.billing = btn.dataset.billing;
    });
  });
  const grid = $('#subGrid');
  if (grid) grid.dataset.billing = 'monthly';
  _paint();
}
