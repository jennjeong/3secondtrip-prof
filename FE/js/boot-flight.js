/* 3초 여행 — 시작 화면 이륙 애니메이션
 *
 * 앱 아이콘(출발 고리 → 점 항로 → 비행기)을 화면 전체로 펼쳐 두고, 비행기가 왼쪽 아래에서 오른쪽 위로
 * 날아가며 지나간 자리부터 덮개를 양옆으로 열어 홈을 드러낸다.
 *  1) 항로가 그려지고 비행기가 출발 고리까지 들어온다. 첫 화면이 준비될 때까지 거기서 천천히 움직인다.
 *  2) 준비되면(window.__tstBoot.open) 이륙 — 비행기 뒤가 쐐기꼴로 벌어지다 화면 밖까지 열린다.
 * 다른 모듈과 얽히지 않는 일반 스크립트라 먼저 실행된다. 움직임 줄이기 설정이면 아무것도 하지 않고,
 * 그때는 redesign-main.js 가 예전처럼 시작 화면을 흐리게 걷는다.
 */
(function () {
  var host = document.getElementById('bootSplash');
  var cv = host && host.querySelector('canvas');
  var ctx = cv && cv.getContext && cv.getContext('2d');
  var hideNative = function () {
    try { window.Capacitor.Plugins.SplashScreen.hide({ fadeOutDuration: 120 }).catch(function () {}); } catch (e) { /* 웹 */ }
  };
  // 웹에서는 덮개가 헤더·제목·검색을 가리지 않게 비행 연출을 쓰지 않는다(항로 움직임은 홈 지구본이 맡는다).
  // 앱(Capacitor)만 이륙 장면을 보여 준다. 웹은 덮개를 바로 걷어 제목·검색을 처음부터 누를 수 있게 한다.
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (host && !native) {
    host.classList.add('is-web');
    // 스타일과 기본 화면(HTML)이 준비되는 때 — 홈 데이터를 기다리지 않는다
    var lift = function () { if (host.parentNode) host.parentNode.removeChild(host); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lift, { once: true }); else lift();
    return;
  }
  if (!ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var INTRO = 0.55;                 // 항로가 그려지는 시간(초)
  var GATE = 0.15;                  // 출발 고리의 위치(항로 길이 비율)
  var END = 2.0;                    // 여기까지 가면 덮개가 화면 밖
  var W = innerWidth, H = innerHeight, D = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * D); cv.height = Math.round(H * D);
  var logo = host.querySelector('img');
  var diag = Math.hypot(W, H);
  var size = Math.max(50, Math.min(92, Math.min(W, H) * 0.145));     // 비행기 길이
  var nx = -H / diag, ny = -W / diag;                                 // 항로 왼쪽 위로 벌어지는 방향

  // ── 항로: 아이콘과 같은 S 자. 길이가 고른 점으로 나눠 둔다.
  var wide = W > H;
  var P = wide ? [[-size * 1.3, H * 1.02], [W * 0.58, H * 0.86], [W * 0.46, H * 0.16], [W + size * 1.3, -size * 0.6]]
    : [[-size * 1.3, H * 0.97], [W * 0.92, H * 0.80], [W * 0.06, H * 0.30], [W + size * 1.3, -size * 0.9]];
  var bez = function (t, k) { var u = 1 - t; return u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]; };
  var N = 72, raw = [], len = [0], i;
  for (i = 0; i <= 240; i++) { raw.push([bez(i / 240, 0), bez(i / 240, 1)]); if (i) len.push(len[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1])); }
  var pts = [], j = 0;
  for (i = 0; i <= N; i++) {
    var want = len[240] * i / N;
    while (j < 239 && len[j + 1] < want) j++;
    var f = (want - len[j]) / ((len[j + 1] - len[j]) || 1);
    pts.push([raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f]);
  }
  function at(s) {
    var x = Math.max(0, Math.min(1, s)) * N, k = Math.min(N - 1, Math.floor(x)), t = x - k, a = pts[k], b = pts[k + 1];
    var dx = b[0] - a[0], dy = b[1] - a[1], over = s > 1 ? (s - 1) * N : 0;
    return { x: a[0] + dx * (t + over), y: a[1] + dy * (t + over), r: Math.atan2(dy, dx) };
  }

  // 항로의 점 — 아이콘처럼 크고 작은 점이 섞여 있다.
  var dots = [], step = 24 / len[240] * Math.max(1, len[240] / 1100), pat = [2.6, 2.8, 4.2, 2.6, 2.1, 6, 2.6, 2.1, 2.8, 4.8];
  for (var s = GATE + step, n = 0; s < 0.97; s += step, n++) dots.push({ s: s, r: pat[n % pat.length] * size / 56 });

  // ── 덮개: CSS 로 먼저 칠한 배경과 같은 그라데이션
  var gx = wide ? W * 0.92 : W / 2 + H * 0.24, gy = H * 0.06;
  var cover = ctx.createRadialGradient(gx, gy, 0, gx, gy, H * 0.95);
  cover.addColorStop(0, '#06406F'); cover.addColorStop(0.42, '#04203F'); cover.addColorStop(1, '#020A1E');

  var ease = function (x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); };
  var state = { t: 0, fly: -1, p: 0, ready: false, last: 0, done: false };
  var gap = function (q) { return q <= 0 ? 0 : diag * Math.pow(q / 1.12, 1.75) * state.open; };
  state.open = 0;

  function edge(p, side) {                          // 벌어진 자리의 한쪽 가장자리(비행기 → 왼쪽 아래)
    var out = [], end = Math.min(1, p), m = Math.max(1, Math.ceil(end * N));
    var tip = p > 1 ? at(Math.min(p, 1.6)) : at(p), g0 = gap(p - Math.min(p, 1.6));
    out.push([tip.x + nx * g0 * side, tip.y + ny * g0 * side]);
    for (var k = m; k >= 0; k--) {
      var q = end * k / m, c = at(q), g = gap(p - q);
      out.push([c.x + nx * g * side, c.y + ny * g * side]);
    }
    var z = pts[0], ge = gap(p + 0.05);             // 화면 왼쪽 아래 밖까지
    out.push([z[0] - diag * 0.6 * (W / diag) + nx * ge * side, z[1] + diag * 0.6 * (H / diag) + ny * ge * side]);
    return out;
  }
  function plane(x, y, r, k) {
    var R = size * 1.7, g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, 'rgba(64,160,255,.5)'); g.addColorStop(0.45, 'rgba(64,150,255,.16)'); g.addColorStop(1, 'rgba(64,160,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.scale(size / 100 * k, size / 100 * k);
    ctx.beginPath(); ctx.moveTo(49, 0); ctx.bezierCurveTo(49, -5, 42, -7, 35, -7);
    [[15, -7], [-15, -44], [-25, -44], [-9, -7], [-33, -5.5], [-44, -18], [-51, -18], [-45, 0], [-51, 18], [-44, 18], [-33, 5.5], [-9, 7], [-25, 44], [-15, 44], [15, 7], [35, 7]]
      .forEach(function (v) { ctx.lineTo(v[0], v[1]); });
    ctx.bezierCurveTo(42, 7, 49, 5, 49, 0); ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.fillStyle = ctx.strokeStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    var p = state.p, t = state.t;
    ctx.setTransform(D, 0, 0, D, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = cover; ctx.fillRect(0, 0, W, H);

    // 로고 — 왼쪽 위 덮개에 붙어 함께 밀려난다
    var drift = Math.min(gap(Math.max(0, p - 0.45)) * 0.35, 220);
    if (logo && logo.complete && logo.naturalWidth) {
      var lw = Math.min(H * 0.195, W * 0.5), lh = lw * logo.naturalHeight / logo.naturalWidth;
      ctx.drawImage(logo, W / 2 - lw / 2 + nx * drift, H * 0.145 - lh / 2 + ny * drift, lw, lh);
    }
    // 출발 고리와 항로
    var ring = at(GATE), rk = ease(t / 0.3);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = size * 0.1; ctx.globalAlpha = rk;
    ctx.beginPath(); ctx.arc(ring.x, ring.y, size * 0.24 * (0.4 + 0.6 * rk), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    dots.forEach(function (d) {
      var k = ease((t - 0.12 - (d.s - GATE) * 0.42) / 0.16);
      if (k <= 0 || d.s < p) return;
      ctx.globalAlpha = k; var c = at(d.s);
      ctx.beginPath(); ctx.arc(c.x, c.y, d.r * k, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 비행기가 지나간 자리를 연다
    if (state.open > 0) {
      var a = edge(p, 1), b = edge(p, -1), path = new Path2D(), q;
      a.forEach(function (v, k) { if (k) path.lineTo(v[0], v[1]); else path.moveTo(v[0], v[1]); });
      for (q = b.length - 1; q >= 0; q--) path.lineTo(b[q][0], b[q][1]);
      path.closePath();
      ctx.globalCompositeOperation = 'destination-out'; ctx.fill(path);
      ctx.globalCompositeOperation = 'source-atop';      // 덮개 쪽에만 빛이 남게
      [[26, 'rgba(70,150,255,.16)'], [10, 'rgba(130,190,255,.30)'], [3, 'rgba(235,245,255,.95)']].forEach(function (l) { ctx.lineWidth = l[0]; ctx.strokeStyle = l[1]; ctx.lineJoin = 'round'; ctx.stroke(path); });
      ctx.globalCompositeOperation = 'source-over';
    }
    if (p < 1.3) { var c = at(p); plane(c.x, c.y, c.r, 1 + 0.3 * Math.max(0, Math.min(1, p))); }
  }

  function finish() {
    if (state.done) return;
    state.done = true;
    host.classList.add('is-done');
    setTimeout(function () { host.remove(); }, 250);
  }
  function frame(now) {
    if (state.done) return;
    var dt = state.last ? Math.min((now - state.last) / 1000, 0.034) : 0;     // 잠깐 멈춰도 건너뛰지 않게
    state.last = now; state.t += dt;
    if (state.fly < 0) {
      state.p = GATE * ease(state.t / INTRO) + Math.min(0.03, Math.max(0, state.t - INTRO) * 0.02);
      if (state.ready && state.t >= INTRO) { state.fly = 0; state.from = state.p; }
    } else {
      state.fly += dt;
      var f = state.fly;
      state.p = state.from + 0.26 * f + 0.70 * f * f;
      state.open = Math.min(1, f / 0.3);
      if (f > 0.75) host.style.pointerEvents = 'none';
    }
    draw();
    if (state.p >= END) { finish(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(function () {
    host.classList.add('is-flying');                // 이때부터 CSS 배경·로고 대신 캔버스가 그린다
    draw();
    // 웹 화면이 실제로 칠해진 뒤(세 프레임) 네이티브 시작 화면을 닫는다 — 바로 닫으면 흰 화면이 번쩍인다
    requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(hideNative, 30); requestAnimationFrame(frame); }); });
  });

  var skip = function () { state.ready = true; if (state.t < INTRO) state.t = INTRO; };
  window.__tstBoot = {
    /** 첫 화면이 준비됐다 — 이륙한다. 화면이 가려져 있거나 너무 오래 걸렸으면 그냥 걷는다. */
    open: function () {
      if (document.hidden || performance.now() > 5000) { finish(); return; }
      state.ready = true;
    },
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden && state.ready) finish(); });
  addEventListener('resize', function () { if (state.fly >= 0 && Math.abs(innerWidth - W) > 60) finish(); });
  host.addEventListener('pointerdown', function () { if (state.ready) skip(); });
})();
