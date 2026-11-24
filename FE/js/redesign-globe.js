/* 3초 여행 — 홈 첫 화면의 점 지구본
 *
 * 바깥 라이브러리·이미지 없이 캔버스에 점으로 그린다. 서울에서 코스가 있는 도시까지 점선 항로를 잇고,
 * 도시를 누르면 그 도시의 코스로 간다(같은 동작의 글자 버튼이 ‘도시 바로가기’에 있어 그림은 장식으로 숨긴다).
 * 화면에 보일 때만 30fps 로 돌고, 모션 감소가 켜져 있으면 한 번만 그린다.
 */

// 대륙 윤곽(위도, 경도) — 점 간격보다 거친 자료로 충분하다.
const LAND = [
  [[70,-160],[71,-128],[68,-100],[73,-85],[62,-78],[55,-80],[60,-65],[52,-56],[45,-65],[41,-72],[35,-76],[30,-81],[25,-80],[30,-90],[26,-97],[20,-97],[21,-88],[15,-84],[9,-80],[8,-77],[14,-92],[19,-105],[30,-115],[38,-123],[48,-125],[58,-137],[60,-150],[55,-162],[65,-168]],
  [[12,-72],[8,-60],[0,-50],[-8,-35],[-22,-41],[-35,-56],[-41,-63],[-53,-69],[-45,-75],[-18,-71],[-5,-81],[2,-79]],
  [[83,-35],[76,-20],[65,-40],[60,-44],[70,-54],[78,-70]],
  [[36,-9],[43,-9],[48,-4],[53,7],[58,8],[62,5],[70,20],[71,28],[68,44],[70,60],[73,75],[77,104],[72,130],[70,160],[66,178],[60,165],[52,157],[60,155],[58,143],[54,137],[48,140],[43,132],[40,128.5],[37,129.6],[35,129.4],[34.4,126.4],[37,126.4],[39.6,124.6],[40.8,121.5],[39,118],[37.2,122.4],[35,119.4],[31,122],[28,121],[24.5,118.5],[22,114],[21.5,110],[20,106],[16,108.5],[11.5,109],[9,105],[10.5,104],[13.5,100.3],[9.5,99.8],[6.5,102],[2,104],[1.4,103.4],[5,100.2],[8.5,98],[16,97.5],[16,94.5],[21,92],[22,88.5],[19,85],[15.5,80.2],[10,79.8],[8,77.5],[13,74.8],[19,72.8],[21.5,69.5],[25,66.5],[26,57],[24,57],[22,59.6],[17,55],[13,45],[20,39.5],[28,34.6],[31.5,34.5],[36.5,36],[37,28],[40,24],[38,23],[40.5,19],[45.5,13.5],[41.5,16],[38,16],[40.5,14.5],[44,9],[43,4],[41,2],[37,-2]],
  [[35,-6],[37,10],[33,11],[31,20],[31,32],[22,37],[12,43],[11,51],[2,46],[-4,40],[-15,40.5],[-20,35],[-26,33],[-34,26],[-34.5,18.5],[-22,14],[-8,13],[0,9],[4.5,7],[5,-4],[4.5,-8],[9,-13.5],[15,-17.4],[21,-17],[28,-12.5]],
  [[-12,131],[-11.5,136],[-17,140.5],[-10.8,142.5],[-15,145.3],[-19,147],[-25,153],[-32,152.6],[-38,147.5],[-38.5,143],[-35,138],[-32,133],[-32,127],[-34,122],[-35,117],[-32,115.6],[-26,113.4],[-21.5,114.5],[-18,122],[-14.5,126]],
  [[45.5,142],[43.3,145.6],[42,141.4],[41.5,140]], [[41.4,141],[38.3,141.6],[35.4,140.8],[34.6,137],[33.5,135.8],[34.3,133],[34.6,131],[35.6,134],[37.5,137],[39.5,139.9]], [[33.9,131],[31.2,131.2],[32,129.7]], [[34.2,134.4],[33,132.6],[33.6,132.4]],
  [[58.6,-5],[55,-1.6],[52.6,1.6],[51,1],[50,-5.4],[53,-4.5],[55,-5.4]], [[54.8,-6],[52,-6.4],[52,-10],[54.2,-9]],
  [[7,117],[5,119],[1,119],[-3.8,115.4],[-3,110.5],[1.8,109.4],[5,114.5]], [[5.6,95.4],[1,103],[-5.8,105.6],[0,98.6]], [[-6,106],[-6.8,112],[-8.6,114.4],[-7.4,107]], [[1.4,121],[0.6,124.8],[-1.2,121.6],[-5.4,120.4],[-3,119]],
  [[-0.8,131.4],[-2.6,141],[-6.6,147.4],[-10.4,150],[-8.4,143],[-5,138.2]], [[18.6,121],[14.2,121.8],[13.6,124],[13.8,120.6]], [[9.6,126],[6,125.4],[7,122]], [[25.2,121.6],[22,120.8],[23.6,120.1]], [[20,110.8],[18.4,109.8],[19.4,108.8]], [[33.55,126.2],[33.5,126.95],[33.2,126.6]],
  [[-34.5,173],[-38,178],[-41.4,175],[-39,174]], [[-41,173],[-46.4,169],[-45,167],[-42,171.4]], [[66.4,-22],[66,-15],[63.6,-18],[64,-22.4]], [[-12.4,49.4],[-25.4,46.8],[-22,43.4],[-16,44.6]],
];
export const CITY_POS = {
  서울: [37.57, 126.98], 부산: [35.18, 129.08], 제주: [33.5, 126.53], 도쿄: [35.68, 139.69], 오사카: [34.69, 135.5], 교토: [35.01, 135.77], 후쿠오카: [33.59, 130.4], 삿포로: [43.06, 141.35],
  방콕: [13.76, 100.5], 치앙마이: [18.79, 98.98], 다낭: [16.05, 108.2], 하노이: [21.03, 105.85], 호치민: [10.82, 106.63], 싱가포르: [1.35, 103.82], 발리: [-8.65, 115.22], 세부: [10.32, 123.9], 마닐라: [14.6, 120.98],
  타이베이: [25.03, 121.57], 홍콩: [22.32, 114.17], 상하이: [31.23, 121.47], 베이징: [39.9, 116.4], 시드니: [-33.87, 151.21], 멜버른: [-37.81, 144.96], 괌: [13.44, 144.79],
  파리: [48.86, 2.35], 런던: [51.51, -0.13], 로마: [41.9, 12.5], 바르셀로나: [41.39, 2.17], 프라하: [50.08, 14.44], 이스탄불: [41.01, 28.98], 두바이: [25.2, 55.27], 뉴욕: [40.71, -74.01], 로스앤젤레스: [34.05, -118.24], 하와이: [21.31, -157.86],
};
const HOME = '서울';
const D = Math.PI / 180;

function _inside(la, lo, P) {
  let r = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [a, b] = P[i], [c, d] = P[j];
    if ((a > la) !== (c > la) && lo < (d - b) * (la - a) / (c - a) + b) r = !r;
  }
  return r;
}
let _dots = null;
function _landDots() {
  if (_dots) return _dots;
  const out = [];
  for (let la = -56; la <= 80; la += 1.55) {
    const n = Math.round(232 * Math.cos(la * D));
    for (let k = 0; k < n; k++) {
      const lo = -180 + 360 * k / n;
      if (LAND.some(P => _inside(la, lo, P))) out.push([Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D), Math.cos(la * D) * Math.cos(lo * D)]);
    }
  }
  return (_dots = out);
}
const _vec = (la, lo) => [Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D), Math.cos(la * D) * Math.cos(lo * D)];

export function initGlobe(canvas, { cities = [], onCity } = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let names = [], arcs = [], w = 0, h = 0, R = 0, cx = 0, cy = 0, hits = [];
  let rot = 119, drag = 0, visible = true, raf = 0, last = 0, t0 = 0, hover = '';
  const TILT = -18 * D, ct = Math.cos(TILT), st = Math.sin(TILT);

  function setCities(list) {
    names = [...new Set([HOME, ...list])].filter(n => CITY_POS[n]);
    const S = _vec(...CITY_POS[HOME]);
    arcs = names.filter(n => n !== HOME).map(n => {
      const E = _vec(...CITY_POS[n]);
      const om = Math.acos(Math.max(-1, Math.min(1, S[0] * E[0] + S[1] * E[1] + S[2] * E[2]))) || 1e-3;
      const steps = Math.max(10, Math.round(om * 46));
      const lift = Math.min(.17, .04 + om * .09);
      return { n, pts: Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps, a = Math.sin((1 - t) * om) / Math.sin(om), b = Math.sin(t * om) / Math.sin(om), k = 1 + lift * Math.sin(Math.PI * t);
        return [(S[0] * a + E[0] * b) * k, (S[1] * a + E[1] * b) * k, (S[2] * a + E[2] * b) * k];
      }) };
    });
    draw(performance.now());
  }
  function size() {
    const b = canvas.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = b.width; h = b.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 글자·검색·칩 바로 아래에서 지평선이 시작한다(안전 영역·글자 확대에도 따라간다)
    const copy = canvas.parentElement?.querySelector('.nh-copy')?.getBoundingClientRect();
    const top = copy ? copy.bottom - b.top + (w < 768 ? 26 : 62) : h * .6;
    R = w < 768 ? Math.max(w * .88, 320) : Math.min(w * .5, 720);
    cx = w / 2; cy = top + R;
  }
  function draw(now) {
    if (!w) return;
    const ang = rot + drag + (still.matches ? 0 : Math.sin((now - t0) / 11000) * 7);
    const cr = Math.cos(-ang * D), sr = Math.sin(-ang * D);
    const prj = (v) => {
      const X = v[0] * cr + v[2] * sr, Z = -v[0] * sr + v[2] * cr;
      return [cx + X * R, cy - (v[1] * ct - Z * st) * R, v[1] * st + Z * ct];
    };
    ctx.clearRect(0, 0, w, h);
    let g = ctx.createRadialGradient(cx, cy, R * .9, cx, cy, R * 1.34);
    g.addColorStop(0, 'rgba(98,152,255,.85)'); g.addColorStop(.18, 'rgba(70,122,245,.36)'); g.addColorStop(.55, 'rgba(50,92,210,.10)'); g.addColorStop(1, 'rgba(30,60,160,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7);
    g = ctx.createRadialGradient(cx, cy - R, R * .04, cx, cy - R * .2, R * 1.15);
    g.addColorStop(0, '#2b55a6'); g.addColorStop(.28, '#12295a'); g.addColorStop(.7, '#081228'); g.addColorStop(1, '#04070f');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(170,205,255,.5)'; ctx.stroke();
    // 육지 점
    const s = Math.max(1, R * .0041);
    for (let band = 0; band < 4; band++) {
      ctx.fillStyle = `rgba(158,196,255,${[.22, .42, .64, .88][band]})`;
      ctx.beginPath();
      for (const v of _landDots()) {
        const [X, Y, Z] = prj(v);
        if (Z < .03 || Y > h + 4 || X < -4 || X > w + 4 || (Z < .25 ? 0 : Z < .5 ? 1 : Z < .75 ? 2 : 3) !== band) continue;
        const r = s * (.62 + Z * .5);
        ctx.moveTo(X + r, Y); ctx.arc(X, Y, r, 0, 7);
      }
      ctx.fill();
    }
    // 항로 — 아이콘의 길처럼 둥근 점
    const run = still.matches ? 0 : (now - t0) / 260;
    arcs.forEach(({ pts }, k) => {
      pts.forEach((v, i) => {
        const [X, Y, Z] = prj(v);
        const back = Math.hypot(X - cx, Y - cy) < R && Z < 0;
        if (back || Y > h) return;
        const fade = Math.max(0, Math.min(1, (Y - (cy - R - 34)) / 26));   // 검색·칩 뒤로는 항로를 흐린다
        if (!fade) return;
        ctx.globalAlpha = fade;
        const lead = ((i - run - k * 9) % pts.length + pts.length) % pts.length;
        ctx.fillStyle = lead > pts.length - 5 ? '#FFFFFF' : 'rgba(196,220,255,.55)';
        ctx.beginPath(); ctx.arc(X, Y, s * (lead > pts.length - 5 ? 1.15 : .72), 0, 7); ctx.fill();
      });
    });
    ctx.globalAlpha = 1;
    // 도시
    hits = [];
    const fs = w < 768 ? 13 : 15;
    ctx.font = `600 ${fs}px "Pretendard Variable", Pretendard, sans-serif`;
    ctx.textBaseline = 'middle';
    const boxes = [];
    names.forEach(n => {
      const [X, Y, Z] = prj(_vec(...CITY_POS[n]));
      if (Z < .12 || Y > h - 12 || X < 20 || X > w - 20) return;
      const on = n === hover;
      if (n === HOME) {
        ctx.beginPath(); ctx.arc(X, Y, s * 3, 0, 7); ctx.fillStyle = '#06102a'; ctx.fill(); ctx.lineWidth = s * 1.1; ctx.strokeStyle = '#fff'; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(X, Y, s * (on ? 5.6 : 4.2), 0, 7); ctx.fillStyle = 'rgba(120,170,255,.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(X, Y, s * 2.1, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      }
      const tw = ctx.measureText(n).width;
      // 이름이 겹치면 왼쪽으로, 그래도 겹치면 점만 둔다
      for (const dx of [s * 4.5 + 4, -(s * 4.5 + 4 + tw)]) {
        const b = [X + dx - 3, Y - fs * .7, X + dx + tw + 3, Y + fs * .7];
        if (b[0] < 4 || b[2] > w - 4 || boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
        boxes.push(b);
        ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(10,24,58,.82)'; ctx.strokeText(n, X + dx, Y + .5);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(n, X + dx, Y + .5);
        hits.push({ n, x0: Math.min(b[0], X - 16), y0: Y - 20, x1: Math.max(b[2], X + 16), y1: Y + 20 });
        break;
      }
      if (!hits.some(x => x.n === n)) hits.push({ n, x0: X - 14, y0: Y - 14, x1: X + 14, y1: Y + 14 });
    });
  }
  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    if (now - last > 31) { last = now; draw(now); }
    if (!still.matches) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  const at = (e) => { const b = canvas.getBoundingClientRect(); const x = e.clientX - b.left, y = e.clientY - b.top; return hits.find(p => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1)?.n || ''; };
  let downX = null, base = 0, moved = false;
  canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; base = drag; moved = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (downX != null) { const dx = e.clientX - downX; if (Math.abs(dx) > 5) moved = true; if (moved) { drag = base - dx * 90 / Math.max(320, R); kick(); if (still.matches) draw(performance.now()); } return; }
    const n = at(e); if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; if (still.matches) draw(performance.now()); }
  });
  const up = (e) => { const was = downX != null && !moved; downX = null; if (was && e.type === 'pointerup') { const n = at(e); if (n && onCity) onCity(n); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', up);

  t0 = performance.now();
  const ro = new ResizeObserver(() => { size(); draw(performance.now()); kick(); });
  ro.observe(canvas);
  const copyEl = canvas.parentElement?.querySelector('.nh-copy'); if (copyEl) ro.observe(copyEl);
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) { if (!w) size(); kick(); } }).observe(canvas);
  document.addEventListener('visibilitychange', kick);
  still.addEventListener?.('change', kick);
  size(); setCities(cities);
  return { setCities, kick };
}
