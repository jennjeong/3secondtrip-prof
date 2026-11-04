/* 3초 여행 — Redesign Collab
 * 링크를 아는 사람끼리 같은 일정을 고친다.
 * 실시간 연결 대신 몇 초마다 확인한다(무료 서버는 잠들기 때문).
 * 토큰은 URL 해시로만 주고받아 서버 로그나 Referer 에 남지 않게 한다.
 */

import { api, trackEvent } from './redesign-api-adapter.js';
import { $, el, showToast } from './redesign-ui.js';

const TOKEN_KEY = 'tst_collab_v1';
const POLL_MS = 8000;
const SAVE_DELAY_MS = 1500;

let appState = null;
let rerender = () => {};
let token = null;
let version = 0;
let lastSynced = '';
let saveTimer = null;
let pollTimer = null;
let saving = false;

function _setToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

function _link() {
  return `${location.origin}${location.pathname}#page=schedule&collab=${token}`;
}

function _applyRemote(remote) {
  version = remote.version;
  lastSynced = JSON.stringify(remote.data);
  appState.generated = remote.data;
  rerender();
}

async function _pull() {
  if (!token || saving || saveTimer || document.hidden) return;
  try {
    const remote = await api.getSharedTrip(token);
    if (remote.version > version) {
      _applyRemote(remote);
      showToast('같이 편집하는 분이 일정을 바꿨어요');
    }
  } catch (e) {
    if (e?.status === 404) _stop('공유 일정이 만료됐어요');
  }
}

async function _push() {
  saveTimer = null;
  const g = appState.generated;
  if (!token || !g) return;
  const json = JSON.stringify(g);
  if (json === lastSynced) return;
  saving = true;
  try {
    const saved = await api.updateSharedTrip(token, { data: g, version });
    version = saved.version;
    lastSynced = json;
  } catch (e) {
    if (e?.status === 409) {
      _applyRemote(await api.getSharedTrip(token));
      showToast('다른 분의 수정이 먼저 저장돼 최신 일정으로 바꿨어요');
    } else {
      console.warn('[collab] 저장 실패:', e?.message);
    }
  } finally {
    saving = false;
  }
}

function _onChanged() {
  if (!token || !appState.generated) return;
  if (JSON.stringify(appState.generated) === lastSynced) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(_push, SAVE_DELAY_MS);
}

function _start() {
  clearInterval(pollTimer);
  pollTimer = setInterval(_pull, POLL_MS);
  _paint();
}

function _stop(message) {
  clearInterval(pollTimer);
  clearTimeout(saveTimer);
  saveTimer = null;
  _setToken(null);
  _paint();
  if (message) showToast(message);
}

async function _create() {
  const btn = $('#collabStart');
  if (btn) btn.disabled = true;
  try {
    const created = await api.createSharedTrip({ data: appState.generated });
    _setToken(created.token);
    version = created.version;
    lastSynced = JSON.stringify(created.data);
    _start();
    trackEvent('collab_started');
    await _copy();
  } catch (e) {
    showToast(e?.status === 429 ? '잠시 후 다시 시도해 주세요' : '공유 링크를 만들지 못했어요');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _copy() {
  try {
    await navigator.clipboard.writeText(_link());
    showToast('편집 링크를 복사했어요. 링크를 아는 사람은 누구나 고칠 수 있어요');
  } catch (_) {
    window.prompt('이 링크를 복사해 주세요', _link());
  }
}

function _paint() {
  const box = $('#collabPanel');
  if (!box) return;
  box.hidden = !appState?.generated;
  box.textContent = '';
  box.appendChild(el('h3', { class: 'tool-title' }, '함께 편집'));
  if (token) {
    box.append(
      el('p', { class: 'tool-note' }, '편집 중이에요. 링크를 아는 사람은 누구나 이 일정을 보고 고칠 수 있어요.'),
      el('div', { class: 'tool-actions' }, [
        el('button', { type: 'button', class: 'btn btn-soft', onclick: _copy }, '링크 복사'),
        el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _stop('이 기기에서 함께 편집을 끝냈어요') }, '끝내기'),
      ]),
    );
  } else {
    box.append(
      el('p', { class: 'tool-note' }, '동행자에게 링크를 보내 같은 일정을 함께 고쳐요.'),
      el('button', { type: 'button', class: 'btn btn-soft btn-block', id: 'collabStart', onclick: _create }, '편집 링크 만들기'),
    );
  }
}

export async function initCollab(state, renderSchedule) {
  appState = state;
  rerender = renderSchedule;
  document.addEventListener('redesign:schedule-changed', () => { _paint(); _onChanged(); });

  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const fromUrl = params.get('collab');
  if (fromUrl) {
    // 토큰이 주소창과 방문 기록에 남지 않게 바로 지운다.
    history.replaceState(null, '', location.pathname + '#page=schedule');
  }
  let saved = null;
  try { saved = localStorage.getItem(TOKEN_KEY); } catch (_) {}
  const candidate = fromUrl || saved;
  if (!candidate) return;

  try {
    const remote = await api.getSharedTrip(candidate);
    _setToken(candidate);
    _applyRemote(remote);
    _start();
    if (fromUrl) showToast('함께 편집하는 일정을 열었어요');
  } catch (e) {
    if (e?.status === 404) {
      _setToken(null);
      if (fromUrl) showToast('공유 일정을 찾을 수 없어요');
    }
  }
}
