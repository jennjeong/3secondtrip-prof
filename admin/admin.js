/* 3초 여행 — Admin (rewrite v2) */

const API = (window.__ADMIN_API_BASE || '').replace(/\/$/, '');
const TOKEN_KEY = 'tst_admin_token_v1';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ──── 화면 전환 (data-screen) ──── */
function showScreen(name) {
  console.log('[admin] → screen:', name);
  document.body.dataset.screen = name;
}

/* ──── 토스트 ──── */
let _toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.className = 'toast'; }, 2400);
}

/* ──── HTTP wrapper ──── */
async function api(path, opts = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  let res;
  try {
    res = await fetch(API + path, { ...opts, headers });
  } catch (netErr) {
    const e = new Error('서버에 연결할 수 없어요. 백엔드(localhost:8000)가 떠 있는지 확인하세요.');
    e.cause = netErr; throw e;
  }
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = (body && (body.detail || body.message || body.error)) || `HTTP ${res.status}`;
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return body;
}

/* ──── 인증 ──── */
async function loadMe() {
  return api('/admin/me');
}
function saveToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken()  { localStorage.removeItem(TOKEN_KEY); }

/* ──── 부트 ──── */
async function boot() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showScreen('login'); return; }
  try {
    const me = await loadMe();
    enterApp(me);
  } catch (e) {
    console.warn('[admin] auto-login failed:', e.message);
    clearToken();
    showScreen('login');
  }
}

/* ──── 로그인 ──── */
$$('.tab').forEach(t => t.addEventListener('click', () => {
  const which = t.dataset.tab;
  $$('.tab').forEach(x => x.classList.toggle('is-on', x === t));
  $$('.tab-pane').forEach(p => p.classList.toggle('is-on', p.dataset.pane === which));
}));

$('#btnTokenLogin')?.addEventListener('click', async () => {
  const raw = ($('#tokenInput').value || '').trim().replace(/^["']|["']$/g, '');
  const btn = $('#btnTokenLogin'); const err = $('#loginErr');
  err.hidden = true;
  if (!raw) { err.hidden = false; err.textContent = '토큰을 붙여넣어 주세요.'; return; }
  if (raw.split('.').length !== 3) {
    err.hidden = false; err.textContent = 'JWT 형식이 아니에요 (점 2개 포함).'; return;
  }
  btn.disabled = true; btn.textContent = '확인 중…';
  saveToken(raw);
  try {
    const me = await loadMe();
    enterApp(me);
  } catch (e) {
    clearToken();
    err.hidden = false;
    err.textContent =
      e.status === 403 ? '관리자 권한이 없는 계정이에요. BE 폴더에서 `python make_admin.py <이메일>` 실행 필요.' :
      e.status === 401 ? '토큰이 유효하지 않거나 만료됐어요.' :
      `로그인 실패: ${e.message}`;
    btn.disabled = false; btn.textContent = '토큰으로 로그인';
  }
});

$('#btnPwLogin')?.addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  const pw    = $('#loginPw').value;
  const btn = $('#btnPwLogin'); const err = $('#loginErr2');
  err.hidden = true;
  if (!email || !pw) { err.hidden = false; err.textContent = '이메일과 비밀번호를 입력하세요.'; return; }
  btn.disabled = true; btn.textContent = '확인 중…';
  try {
    const r = await api('/users/login', { method: 'POST', body: JSON.stringify({ email, password: pw }) });
    if (!r?.access_token) throw new Error('토큰을 받지 못했어요.');
    saveToken(r.access_token);
    const me = await loadMe();
    enterApp(me);
  } catch (e) {
    clearToken();
    err.hidden = false;
    err.textContent =
      e.status === 403 ? '관리자 권한이 없어요.' :
      e.status === 401 ? '이메일 또는 비밀번호가 잘못됐어요.' :
      `로그인 실패: ${e.message}`;
    btn.disabled = false; btn.textContent = '로그인';
  }
});

$('#btnLogout')?.addEventListener('click', () => {
  clearToken();
  location.reload();
});

/* ──── 앱 진입 ──── */
let _me = null;
function enterApp(me) {
  _me = me || {};
  console.log('[admin] enterApp:', _me);
  const meName  = $('#meName');  if (meName)  meName.textContent  = _me.nickname || _me.email || `#${_me.id}`;
  const meEmail = $('#meEmail'); if (meEmail) meEmail.textContent = _me.email || _me.provider || '';
  showScreen('app');
  // 라우터 시작
  if (!location.hash.startsWith('#')) location.hash = '#dashboard';
  handleRoute();
}

/* ──── Hash 라우터 ──── */
window.addEventListener('hashchange', handleRoute);
$$('.nav-btn').forEach(n => n.addEventListener('click', () => {
  location.hash = '#' + n.dataset.route;
}));

const ROUTES = {
  dashboard: { title: '대시보드', load: renderDashboard },
  users:     { title: '사용자 관리', load: () => renderList('users', 1) },
  roadmaps:  { title: '로드맵 관리', load: () => renderList('roadmaps', 1) },
  reviews:   { title: '리뷰 관리', load: () => renderList('reviews', 1) },
  blogs:     { title: '블로그 관리', load: () => renderList('blogs', 1) },
  feedback:  { title: '사용자 피드백', load: () => renderList('feedback', 1) },
  trips:     { title: '여행 (Trip) 모니터', load: () => renderList('trips', 1) },
  schedules: { title: '저장된 일정 모니터', load: () => renderList('schedules', 1) },
};

function handleRoute() {
  const route = (location.hash || '#dashboard').slice(1) || 'dashboard';
  const r = ROUTES[route] || ROUTES.dashboard;
  $$('.nav-btn').forEach(b => b.classList.toggle('is-on', b.dataset.route === route));
  const t = $('#pageTitle'); if (t) t.textContent = r.title;
  const c = $('#content');   if (c) c.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    r.load();
  } catch (e) {
    console.error('[admin] route load failed:', e);
    if (c) c.innerHTML = `<div class="err">${escapeHtml(e.message)}</div>`;
  }
}

$('#btnRefresh')?.addEventListener('click', () => handleRoute());

/* ──── 대시보드 ──── */
function bar(label, val, max) {
  const pct = max ? Math.round(val / max * 100) : 0;
  return `<div class="bar"><span class="label">${escapeHtml(label)}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="num">${val}</span></div>`;
}
async function renderDashboard() {
  try {
    const s = await api('/admin/stats');
    const stats = [
      ['전체 사용자', s.users?.total ?? 0, `활성 ${s.users?.active ?? 0}`],
      ['여행 (Trip)', s.trips?.total ?? 0, ''],
      ['저장된 일정', `${s.schedules?.saved ?? 0} / ${s.schedules?.total ?? 0}`, ''],
      ['로드맵', s.roadmaps?.total ?? 0, ''],
      ['리뷰', s.reviews?.total ?? 0, ''],
      ['블로그', s.blogs?.total ?? 0, ''],
      ['피드백', s.feedback?.total ?? 0, (s.feedback?.unresolved ? `미처리 ${s.feedback.unresolved}` : '')],
    ];
    const provider = s.users?.by_provider || {};
    const cities = s.trips?.top_cities || [];
    const concepts = s.trips?.by_concept || {};
    const signups = s.users?.signups_7d || {};
    const sKeys = Object.keys(signups).sort();

    const pMax = Math.max(1, ...Object.values(provider));
    const cMax = Math.max(1, ...cities.map(c => c.count));
    const kMax = Math.max(1, ...Object.values(concepts));
    const tMax = Math.max(1, ...Object.values(signups));

    $('#content').innerHTML = `
      <div class="grid-stat">
        ${stats.map(([l, n, sub]) => `
          <div class="stat"><div class="lbl">${escapeHtml(l)}</div>
            <div class="num">${escapeHtml(String(n))}</div>
            ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}</div>
        `).join('')}
      </div>

      <div class="panel"><h3>소셜 제공자별 가입자</h3>
        ${Object.keys(provider).length ? Object.entries(provider).map(([k, v]) => bar(k, v, pMax)).join('') : '<p class="muted">데이터 없음</p>'}
      </div>

      <div class="panel"><h3>인기 도시 TOP 10</h3>
        ${cities.length ? cities.map(c => bar(c.city, c.count, cMax)).join('') : '<p class="muted">데이터 없음</p>'}
      </div>

      <div class="panel"><h3>여행 컨셉 분포</h3>
        ${Object.keys(concepts).length ? Object.entries(concepts).map(([k, v]) => bar(k, v, kMax)).join('') : '<p class="muted">데이터 없음</p>'}
      </div>

      <div class="panel"><h3>최근 7일 가입자</h3>
        ${sKeys.length ? sKeys.map(k => bar(k, signups[k], tMax)).join('') : '<p class="muted">데이터 없음</p>'}
      </div>

      <div class="panel"><h3>피드백 상태</h3>
        ${(() => {
          const fb = s.feedback?.by_status || {};
          const fbMax = Math.max(1, ...Object.values(fb));
          const order = ['new', 'in_progress', 'resolved', 'closed'];
          const sorted = order.filter(k => fb[k] != null).concat(Object.keys(fb).filter(k => !order.includes(k)));
          return sorted.length ? sorted.map(k => bar(_fbStatusLabel(k), fb[k], fbMax)).join('') : '<p class="muted">데이터 없음</p>';
        })()}
      </div>

      <div class="panel"><h3>피드백 유형 분포</h3>
        ${(() => {
          const ft = s.feedback?.by_type || {};
          const ftMax = Math.max(1, ...Object.values(ft));
          return Object.keys(ft).length ? Object.entries(ft).map(([k, v]) => bar(_fbTypeLabel(k), v, ftMax)).join('') : '<p class="muted">데이터 없음</p>';
        })()}
      </div>
    `;
  } catch (e) {
    console.error('[admin] dashboard load failed:', e);
    $('#content').innerHTML = `<div class="err">대시보드 로드 실패: ${escapeHtml(e.message)}</div>`;
  }
}

/* ──── 리스트(통합) ──── */
const _FB_STATUS = { new: '신규', in_progress: '진행중', resolved: '해결됨', closed: '종료' };
const _FB_TYPE   = { bug: '버그', feature: '기능제안', design: '디자인', schedule: '일정', etc: '기타' };
function _fbStatusLabel(k) { return _FB_STATUS[k] || k; }
function _fbTypeLabel(k)   { return _FB_TYPE[k]   || k; }
function _fbStatusBadge(k) {
  const map = { new: 'b', in_progress: 'a', resolved: 'g', closed: 'gray' };
  return `<span class="badge ${map[k] || 'gray'}">${_fbStatusLabel(k)}</span>`;
}

const LIST_CFG = {
  users: {
    endpoint: '/admin/users',
    toolbar: `
      <input id="lf_q" type="search" placeholder="이메일/닉네임 검색" />
      <select id="lf_provider">
        <option value="">전체 제공자</option>
        <option value="local">local</option>
        <option value="google">google</option>
        <option value="kakao">kakao</option>
        <option value="naver">naver</option>
        <option value="apple">apple</option>
      </select>`,
    cols: ['ID', '이메일 / 닉네임', '제공자', '가입일', '상태', '관리'],
    row: (u) => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${escapeHtml(u.email || '-')}</strong><br/><span class="muted" style="font-size:12px">${escapeHtml(u.nickname || '')}</span></td>
        <td><span class="badge gray">${escapeHtml(u.provider)}</span></td>
        <td>${(u.created_at || '').slice(0, 10)}</td>
        <td>
          ${u.is_admin  ? '<span class="badge a">관리자</span> ' : ''}
          ${u.is_active ? '<span class="badge g">활성</span>' : '<span class="badge r">비활성</span>'}
        </td>
        <td>
          <button class="btn mini" data-act="toggle-admin"  data-id="${u.id}" data-flag="${u.is_admin}">${u.is_admin ? '권한해제' : '관리자로'}</button>
          <button class="btn mini" data-act="toggle-active" data-id="${u.id}" data-flag="${u.is_active}">${u.is_active ? '비활성화' : '활성화'}</button>
          <button class="btn mini danger" data-act="delete" data-id="${u.id}">삭제</button>
        </td>
      </tr>`,
    qsBuilder: () => {
      const o = {};
      const q = $('#lf_q')?.value?.trim();         if (q) o.q = q;
      const p = $('#lf_provider')?.value;          if (p) o.provider = p;
      return o;
    },
    actions: {
      'toggle-admin':  (id, flag) => api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_admin: flag !== 'true' }) }),
      'toggle-active': (id, flag) => api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: flag !== 'true' }) }),
      'delete':        (id) => confirm(`사용자 #${id} 를 삭제할까요?`) ? api(`/admin/users/${id}`, { method: 'DELETE' }) : null,
    },
  },
  roadmaps: {
    endpoint: '/admin/roadmaps',
    cols: ['ID', '제목', '도시', '컨셉', '좋아요', '공개', '작성자', ''],
    row: (r) => `
      <tr>
        <td>#${r.id}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.city || '-')} · ${escapeHtml(r.country || '-')}</td>
        <td>${escapeHtml(r.concept || '-')}</td>
        <td>${r.likes ?? 0}</td>
        <td>${r.is_public ? '<span class="badge g">공개</span>' : '<span class="badge gray">비공개</span>'}</td>
        <td>${escapeHtml(r.user_email || r.user_nickname || (r.user_id ? '#'+r.user_id : '-'))}</td>
        <td><button class="btn mini danger" data-act="delete" data-id="${r.id}">삭제</button></td>
      </tr>`,
    actions: { 'delete': (id) => confirm(`로드맵 #${id} 삭제할까요?`) ? api(`/admin/roadmaps/${id}`, { method: 'DELETE' }) : null },
  },
  reviews: {
    endpoint: '/admin/reviews',
    cols: ['ID', '별점', '내용', '도시', '작성자', '날짜', ''],
    row: (rv) => `
      <tr>
        <td>#${rv.id}</td>
        <td>${'★'.repeat(rv.rating || 0)}<span class="muted">${'☆'.repeat(5 - (rv.rating || 0))}</span></td>
        <td style="max-width:380px">${escapeHtml((rv.content || '').slice(0, 120))}${(rv.content || '').length > 120 ? '…' : ''}</td>
        <td>${escapeHtml(rv.city || '-')}</td>
        <td>${escapeHtml(rv.user_email || rv.user_nickname || '-')}</td>
        <td>${(rv.created_at || '').slice(0, 10)}</td>
        <td><button class="btn mini danger" data-act="delete" data-id="${rv.id}">삭제</button></td>
      </tr>`,
    actions: { 'delete': (id) => confirm(`리뷰 #${id} 삭제할까요?`) ? api(`/admin/reviews/${id}`, { method: 'DELETE' }) : null },
  },
  feedback: {
    endpoint: '/admin/feedback',
    toolbar: `
      <select id="lf_status">
        <option value="">전체 상태</option>
        <option value="new">신규</option>
        <option value="in_progress">진행중</option>
        <option value="resolved">해결됨</option>
        <option value="closed">종료</option>
      </select>
      <select id="lf_type">
        <option value="">전체 유형</option>
        <option value="bug">버그</option>
        <option value="feature">기능제안</option>
        <option value="design">디자인</option>
        <option value="schedule">일정</option>
        <option value="etc">기타</option>
      </select>`,
    cols: ['ID', '유형', '제목 / 내용', '작성자', '상태', '날짜', '관리'],
    row: (f) => `
      <tr>
        <td>#${f.id}</td>
        <td><span class="badge gray">${escapeHtml(_fbTypeLabel(f.feedback_type))}</span></td>
        <td>
          ${f.title ? `<strong>${escapeHtml(f.title)}</strong><br/>` : ''}
          <span class="muted" style="font-size:12px;white-space:pre-wrap;display:block;max-width:480px">${escapeHtml((f.content || '').slice(0, 240))}${(f.content || '').length > 240 ? '…' : ''}</span>
        </td>
        <td>${escapeHtml(f.user_email || f.user_nickname || (f.user_id ? '#'+f.user_id : '익명'))}</td>
        <td>${_fbStatusBadge(f.status)}</td>
        <td>${(f.created_at || '').slice(0, 10)}</td>
        <td>
          ${['new','in_progress','resolved','closed'].filter(s => s !== f.status).slice(0, 2).map(s =>
            `<button class="btn mini" data-act="set-status" data-id="${f.id}" data-value="${s}">${_fbStatusLabel(s)}</button>`
          ).join('')}
          <button class="btn mini danger" data-act="delete" data-id="${f.id}">삭제</button>
        </td>
      </tr>`,
    qsBuilder: () => {
      const o = {};
      const st = $('#lf_status')?.value;        if (st) o.status = st;
      const tp = $('#lf_type')?.value;          if (tp) o.feedback_type = tp;
      return o;
    },
    actions: {
      'set-status': (id, _flag, val) => api(`/admin/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status: val }) }),
      'delete': (id) => confirm(`피드백 #${id} 를 삭제할까요?`) ? api(`/admin/feedback/${id}`, { method: 'DELETE' }) : null,
    },
  },
  blogs: {
    endpoint: '/admin/blogs',
    cols: ['ID', '제목', '본문 미리보기', '공개', '작성자', '날짜', ''],
    row: (b) => `
      <tr>
        <td>#${b.id}</td>
        <td>${escapeHtml(b.title)}</td>
        <td class="muted" style="max-width:380px;font-size:12px">${escapeHtml((b.body_preview || '').slice(0, 140))}…</td>
        <td>${b.is_draft ? '<span class="badge a">초안</span>' : (b.visibility === 'public' ? '<span class="badge g">공개</span>' : '<span class="badge gray">' + escapeHtml(b.visibility) + '</span>')}</td>
        <td>${escapeHtml(b.user_email || b.user_nickname || '-')}</td>
        <td>${(b.created_at || '').slice(0, 10)}</td>
        <td><button class="btn mini danger" data-act="delete" data-id="${b.id}">삭제</button></td>
      </tr>`,
    actions: { 'delete': (id) => confirm(`블로그 #${id} 삭제할까요?`) ? api(`/admin/blogs/${id}`, { method: 'DELETE' }) : null },
  },
  trips: {
    endpoint: '/admin/trips',
    cols: ['ID', '제목', '출발 → 도착', '기간', '컨셉', '예산', '작성자', '날짜', ''],
    row: (t) => `
      <tr>
        <td>#${t.id}</td><td>${escapeHtml(t.title || '-')}</td>
        <td>${escapeHtml(t.departure_city || '-')} → ${escapeHtml(t.destination_city || '-')}</td>
        <td>${t.start_date || '-'} ~ ${t.end_date || '-'}</td>
        <td>${escapeHtml(t.concept || '-')}</td>
        <td>${t.budget ? Number(t.budget).toLocaleString() + ' ' + (t.currency || '') : '-'}</td>
        <td>${escapeHtml(t.user_email || t.user_nickname || '-')}</td>
        <td>${(t.created_at || '').slice(0, 10)}</td>
        <td><button class="btn mini danger" data-act="delete" data-id="${t.id}">삭제</button></td>
      </tr>`,
    actions: { 'delete': (id) => confirm(`여행 #${id} 삭제할까요?`) ? api(`/admin/trips/${id}`, { method: 'DELETE' }) : null },
  },
  schedules: {
    endpoint: '/admin/schedules',
    cols: ['ID', '제목', '여행ID', '저장됨', '작성자', '날짜', ''],
    row: (s) => `
      <tr>
        <td>#${s.id}</td>
        <td>${escapeHtml(s.title || '-')}</td>
        <td>${s.trip_id ? '#'+s.trip_id : '-'}</td>
        <td>${s.is_saved ? '<span class="badge g">저장</span>' : '<span class="badge gray">미저장</span>'}</td>
        <td>${escapeHtml(s.user_email || s.user_nickname || '-')}</td>
        <td>${(s.created_at || '').slice(0, 10)}</td>
        <td><button class="btn mini danger" data-act="delete" data-id="${s.id}">삭제</button></td>
      </tr>`,
    actions: { 'delete': (id) => confirm(`일정 #${id} 삭제할까요?`) ? api(`/admin/schedules/${id}`, { method: 'DELETE' }) : null },
  },
};

let _listState = { kind: null, page: 1 };

async function renderList(kind, page = 1) {
  const cfg = LIST_CFG[kind];
  if (!cfg) { $('#content').innerHTML = `<div class="err">알 수 없는 섹션: ${kind}</div>`; return; }
  _listState = { kind, page };

  // Shell render first so toolbar input + table appear immediately
  $('#content').innerHTML = `
    ${cfg.toolbar ? `<div class="toolbar">${cfg.toolbar}</div>` : ''}
    <div class="table-wrap"><table class="tbl"><thead><tr>${cfg.cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody id="listBody"><tr><td colspan="${cfg.cols.length}" class="empty">불러오는 중…</td></tr></tbody></table></div>
    <div class="pager" id="listPager"></div>
  `;

  // Toolbar bindings (search etc.)
  if (cfg.qsBuilder) {
    const ti = setTimeout(() => {}, 0); clearTimeout(ti);
    $$('.toolbar input, .toolbar select').forEach(el => {
      el.addEventListener('input', () => fetchPage(1));
      el.addEventListener('change', () => fetchPage(1));
    });
  }

  async function fetchPage(p) {
    _listState.page = p;
    const qs = new URLSearchParams({ page: p, size: 20 });
    if (cfg.qsBuilder) Object.entries(cfg.qsBuilder()).forEach(([k, v]) => qs.set(k, v));
    try {
      const r = await api(cfg.endpoint + '?' + qs.toString());
      const tb = $('#listBody');
      if (!r.items?.length) {
        tb.innerHTML = `<tr><td colspan="${cfg.cols.length}" class="empty">데이터 없음</td></tr>`;
      } else {
        tb.innerHTML = r.items.map(cfg.row).join('');
        $$('#listBody [data-act]').forEach(b => b.addEventListener('click', async () => {
          const id = b.dataset.id; const act = b.dataset.act; const flag = b.dataset.flag; const value = b.dataset.value;
          const fn = cfg.actions?.[act];
          if (!fn) return;
          try {
            const r2 = await fn(id, flag, value);
            if (r2 === null) return;  // user cancelled
            toast('완료', 'ok');
            fetchPage(_listState.page);
          } catch (e) {
            toast(e.message, 'err');
          }
        }));
      }
      // Pager
      const pages = Math.max(1, Math.ceil((r.total || 0) / (r.size || 20)));
      $('#listPager').innerHTML = `
        <button ${p <= 1 ? 'disabled' : ''} data-go="prev">← 이전</button>
        <span>${p} / ${pages} (총 ${r.total || 0})</span>
        <button ${p >= pages ? 'disabled' : ''} data-go="next">다음 →</button>
      `;
      $$('#listPager [data-go]').forEach(btn => btn.addEventListener('click', () => {
        fetchPage(btn.dataset.go === 'prev' ? p - 1 : p + 1);
      }));
    } catch (e) {
      console.error('[admin] list load failed:', e);
      $('#listBody').innerHTML = `<tr><td colspan="${cfg.cols.length}" class="empty">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  fetchPage(page);
}

/* ──── 유틸 ──── */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ──── 시작 ──── */
boot().catch(e => {
  console.error('[admin] boot failed:', e);
  showScreen('login');
});
