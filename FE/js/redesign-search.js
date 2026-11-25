/* 3초 여행 — 다국어 자동완성 (화면과 무관한 순수 계산)
 *
 * 후보와 입력을 같은 방법으로 정규화해 비교한다. 후보 쪽 값은 색인을 만들 때 한 번만 계산한다.
 *  - base    : NFKC + 소문자 + 공백 정리
 *  - fold    : base 에서 악센트·구두점 차이를 없앤 비교 키 (Café → cafe, São → sao, İ → i)
 *  - compact : fold 에서 공백까지 뺀 키 (newyork, xian)
 *  - strokes : 한글을 두벌식으로 누르는 순서로 푼 것. 조합 중간 상태는 항상 이것의 앞부분이다.
 *              (부산: ㅂ → 부 → 붓 → 부사 → 부산 = ㅂㅜㅅㅏㄴ)
 *
 * 순위(작을수록 먼저): 1 완전 일치 · 2 접두사 · 3 단어 접두사 · 4 한글 조합·초성 · 5 부분 문자열.
 * 번역·로마자 변환·발음 추측은 하지 않는다 — 후보에 적힌 이름(별칭)과만 비교한다.
 */

export const RANK = { EXACT: 1, PREFIX: 2, WORD: 3, HANGUL: 4, PART: 5 };

/* ════════ 정규화 ════════ */
const INVISIBLE = /[­​-‏‪-‮⁠﻿]/g;
export function normalize(text) {
  return String(text ?? '').normalize('NFKC').replace(INVISIBLE, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

// 분해해도 나뉘지 않는 글자들
const LETTER = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', þ: 'th', ħ: 'h', ŧ: 't', ŋ: 'n', ς: 'σ', ĸ: 'k' };
const LETTER_RE = new RegExp(`[${Object.keys(LETTER).join('')}]`, 'g');
// 라틴·그리스·키릴 글자에 붙은 부호만 뗀다 — 일본어 탁점(が)이나 태국어·힌디어 모음처럼 글자의 일부인 부호는 그대로 둔다.
const ACCENT = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])[̀-ͯ]+/gu;
const ARABIC_MARK = /[ؐ-ؚـً-ٰٕ]/g;      // 모음 부호·타트윌
const HEBREW_MARK = /[֑-ׇֽֿׁׂׅׄ]/g;
const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 악센트·구두점 차이를 없앤 비교 키. normalize 를 거친 글자를 받는다. */
export function foldKey(base) {
  if (/^[a-z0-9 ]*$/.test(base)) return base;
  const s = base.replace(LETTER_RE, c => LETTER[c]).normalize('NFD').replace(ACCENT, '$1').replace(ARABIC_MARK, '').replace(HEBREW_MARK, '').normalize('NFC');
  // 글자를 잇는 ’·' 는 없애고(Xi’an → xian), 나머지 구두점은 단어 사이로 본다(St. Petersburg).
  return kataToHira(s).replace(/(\p{L})['’ʼ‘`](?=\p{L})/gu, '$1').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/* ════════ 한글 ════════ */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅛ', 'ㅜ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅠ', 'ㅡ', 'ㅡㅣ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const PAIR = { ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ', ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ' };
const isSyllable = (c) => c >= '가' && c <= '힣';
const isVowel = (c) => c >= 'ㅏ' && c <= 'ㅣ';
const HANGUL = /[가-힣ᄀ-ᇿㄱ-ㆎﾡ-ￜ]/;

/** 한글 한 글자를 누르는 순서로. 한글이 아니면 그대로. 자모는 호환·첫가끝·반각 어느 쪽으로 들어와도 같다. */
function strokesOf(c) {
  const n = c.charCodeAt(0);
  if (n >= 0xac00 && n <= 0xd7a3) { const k = n - 0xac00; return CHO[Math.floor(k / 588)] + JUNG[Math.floor((k % 588) / 28)] + JONG[k % 28]; }
  if (n >= 0x1100 && n <= 0x1112) return CHO[n - 0x1100];
  if (n >= 0x1161 && n <= 0x1175) return JUNG[n - 0x1161];
  if (n >= 0x11a8 && n <= 0x11c2) return JONG[n - 0x11a7];
  return PAIR[c] || c;
}
export const toStrokes = (text) => Array.from(text, strokesOf).join('');

/** 초성이 섞인 입력(ㅇㅊ, 인ㅊ)을 한 글자씩의 조건으로. 홀로 쓴 모음이 있으면 초성 검색이 아니다. */
function initialPattern(text) {
  const out = [];
  for (const c of text) {
    if (isSyllable(c) || !HANGUL.test(c)) { out.push(c); continue; }
    for (const j of strokesOf(c)) { if (isVowel(j)) return null; out.push(j); }
  }
  return out.some(c => CHO.includes(c)) ? out : null;
}
const initialOf = (c) => (isSyllable(c) ? CHO[Math.floor((c.charCodeAt(0) - 0xac00) / 588)] : c);
const fitsInitials = (chars, at, pat) => pat.length <= chars.length - at
  && pat.every((p, i) => (CHO.includes(p) ? initialOf(chars[at + i]) === p : chars[at + i] === p));

/* ════════ 비교 키 ════════ */
/** 후보 글자 하나의 비교 키 — 색인을 만들 때 한 번만 부른다. */
export function prepare(text) {
  const base = normalize(text);
  const fold = foldKey(base);
  const compact = fold.replace(/ /g, '');
  // 단어가 시작하는 자리(compact 기준) — 0 은 맨 앞
  const starts = [];
  let at = 0;
  for (const w of fold.split(' ')) { starts.push(at); at += w.length; }
  return { text: String(text ?? ''), base, fold, compact, starts, hangul: HANGUL.test(compact) };
}
/** 사용자 입력의 비교 키 */
export function prepareQuery(text) {
  const base = normalize(text);
  const fold = foldKey(base);
  const compact = fold.replace(/ /g, '');
  // 자모 순서는 정규화하며 합쳐지기 전 글자에서 — ‘ㄳ’ 같은 겹자음도 누른 순서로 푼다.
  const raw = String(text ?? '').normalize('NFC').replace(INVISIBLE, '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
  const hangul = HANGUL.test(raw);
  return { base, fold, compact, strokes: hangul ? toStrokes(raw) : '', initials: hangul ? initialPattern(raw) : null, empty: !base };
}

/** 후보 하나와 입력의 순위. 맞지 않으면 0. 소수점은 같은 순위 안에서의 정확도(원문 > 악센트 무시 > 공백 무시). */
export function matchKey(k, q) {
  if (q.empty) return 0;
  if (k.base === q.base) return RANK.EXACT;
  if (q.fold && k.fold === q.fold) return RANK.EXACT + .1;
  if (q.compact && k.compact === q.compact) return RANK.EXACT + .2;
  if (k.base.startsWith(q.base)) return RANK.PREFIX;
  if (q.fold && k.fold.startsWith(q.fold)) return RANK.PREFIX + .1;
  if (q.compact && k.compact.startsWith(q.compact)) return RANK.PREFIX + .2;
  if (q.fold && k.fold.includes(' ' + q.fold)) return RANK.WORD;
  if (q.compact && k.starts.some(p => p && k.compact.startsWith(q.compact, p))) return RANK.WORD + .2;
  if (q.strokes && k.hangul) {
    for (let i = 0; i < k.starts.length; i++) {
      const rest = k.compact.slice(k.starts[i]);
      if (toStrokes(rest).startsWith(q.strokes)) return RANK.HANGUL + (i ? .1 : 0);
      if (q.initials && fitsInitials(Array.from(rest), 0, q.initials)) return RANK.HANGUL + (i ? .3 : .2);
    }
  }
  if (q.base && k.base.includes(q.base)) return RANK.PART;
  if (q.fold && k.fold.includes(q.fold)) return RANK.PART + .1;
  if (q.compact && k.compact.includes(q.compact)) return RANK.PART + .2;
  return 0;
}
/** 글자 둘을 바로 견줄 때 */
export const matchRank = (text, query) => matchKey(prepare(text), prepareQuery(query));
/** 같은 말인지 — 대소문자·악센트·공백 차이는 무시 */
export const sameText = (a, b) => { const r = matchRank(a, b); return r >= 1 && r < 2; };

/* ════════ 색인 ════════ */
const lowerBound = (arr, s) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].s < s) lo = m + 1; else hi = m; } return lo; };
const byText = (a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.k - b.k);
function* withPrefix(arr, s) { for (let i = lowerBound(arr, s); i < arr.length && arr[i].s.startsWith(s); i++) yield arr[i].k; }

/**
 * 검색 색인.
 * @param items 후보 목록
 * @param textsOf 후보 하나의 이름들(대표 이름, 별칭 …)
 * @param weightOf 같은 순위 안에서의 순서(작을수록 먼저). 기본은 목록 순서.
 */
export function createSearchIndex(items, { textsOf = (x) => [x], weightOf = (_, i) => i / 100 } = {}) {
  const keys = [];
  items.forEach((item, i) => {
    const seen = new Set();
    for (const text of textsOf(item)) {
      if (text === null || text === undefined || text === '') continue;
      const k = prepare(text);
      if (!k.base || seen.has(k.base)) continue;
      seen.add(k.base);
      keys.push({ ...k, i });
    }
  });
  const weights = items.map(weightOf);
  // 접두사 색인 — 원문·악센트 없는 글자·붙여 쓴 글자와 단어가 시작하는 자리부터의 글자를 정렬해 두고 이진 탐색한다.
  const prefix = [], strokes = [], initials = [];
  keys.forEach((k, n) => {
    new Set([k.base, k.fold, k.compact]).forEach(s => { if (s) prefix.push({ s, k: n }); });
    k.starts.forEach((p, w) => {
      if (w) { prefix.push({ s: k.compact.slice(p), k: n }); }
      if (k.hangul) {
        const rest = k.compact.slice(p);
        strokes.push({ s: toStrokes(rest), k: n });
        initials.push({ s: Array.from(rest, initialOf).join(''), k: n });
      }
    });
  });
  [prefix, strokes, initials].forEach(a => a.sort(byText));

  // 부분 문자열 색인 — 두 글자 조각(한 글자 입력이면 한 글자)으로 후보를 좁힌다. 처음 필요할 때 만든다.
  let grams = null;
  const gramsOf = (s) => { const out = new Set(); for (let i = 0; i < s.length; i++) { out.add(s[i]); if (i + 1 < s.length) out.add(s.slice(i, i + 2)); } return out; };
  function partCandidates(s) {
    if (!grams) {
      grams = new Map();
      keys.forEach((k, n) => gramsOf(k.compact).forEach(g => { const l = grams.get(g); if (l) l.push(n); else grams.set(g, [n]); }));
    }
    if (!s) return [];
    if (s.length === 1) return grams.get(s) || [];
    let best = null;
    for (let i = 0; i + 1 < s.length; i++) {
      const l = grams.get(s.slice(i, i + 2));
      if (!l) return [];
      if (!best || l.length < best.length) best = l;
    }
    return best;
  }

  /** 순위대로 [{ item, rank, text }] */
  function search(query, { limit = 8, maxRank = RANK.PART } = {}) {
    const q = prepareQuery(query);
    if (q.empty) return [];
    const found = new Map();       // 후보 번호 → 가장 좋은 일치
    const tried = new Set();
    const consider = (n) => {
      if (tried.has(n)) return;
      tried.add(n);
      const k = keys[n];
      const rank = matchKey(k, q);
      if (!rank || Math.floor(rank) > maxRank) return;
      const cost = weights[k.i] + Math.max(0, k.compact.length - q.compact.length);      // 덜 남은 이름, 앞선 후보 먼저
      const old = found.get(k.i);
      if (!old || rank < old.rank || (rank === old.rank && cost < old.cost)) found.set(k.i, { item: items[k.i], rank, cost, text: k.text, i: k.i });
    };
    for (const s of new Set([q.base, q.fold, q.compact])) if (s) for (const n of withPrefix(prefix, s)) consider(n);
    if (maxRank >= RANK.HANGUL && q.strokes) {
      for (const n of withPrefix(strokes, q.strokes)) consider(n);
      if (q.initials) for (const n of withPrefix(initials, q.initials.map(initialOf).join(''))) consider(n);
    }
    if (maxRank >= RANK.PART && found.size < limit) for (const n of partCandidates(q.compact)) consider(n);
    return [...found.values()].sort((a, b) => Math.floor(a.rank) - Math.floor(b.rank) || a.cost - b.cost || a.rank - b.rank || a.i - b.i)
      .slice(0, limit).map(({ item, rank, text }) => ({ item, rank, text }));
  }
  return { search, size: items.length };
}
