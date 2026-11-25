/* 3초 여행 — 현지인이 가는 동네 장소 고르기 (화면과 무관한 순수 계산)
 *
 * 목적은 ‘너무 뻔한 곳’이 아니라 그 동네 사람들이 다니는 곳을 추천하는 것이다.
 *  1) 그 나라 말로 동네 식당·시장·공원을 찾는다(한국어로 찾으면 관광객이 많이 찾는 곳이 먼저 나온다).
 *  2) 그 도시의 대표 관광지 목록을 따로 받아 뺀다. 관광 시설로 분류됐거나 후기가 지나치게 많은 곳, 체인점도 뒤로 보낸다.
 *  3) 후기가 적당히 있고 평점이 좋은 동네 가게·시장·공원을 앞에 둔다.
 * 방문자의 국적이나 비율을 아는 자료가 아니므로 ‘현지인 몇 %’ 같은 숫자는 만들지 않는다.
 */

export const PLACE_MODES = [
  ['local', '동네 위주', '현지어로 찾은 동네 식당·시장·공원 위주예요. 대표 관광지는 빼요.'],
  ['mix', '반반', '하루에 한 곳은 유명한 곳, 나머지는 동네 장소로 채워요.'],
  ['famous', '유명한 곳 위주', '널리 알려진 관광지와 인기 식당 위주예요.'],
];
export const modeOf = (t) => (['mix', 'famous'].includes(t?.placeMode) ? t.placeMode : 'local');

/* ── 나라 → 검색 언어 ── */
const LANG = {
  ko: ['대한민국', '한국'], ja: ['일본'], zh: ['중국'], zht: ['대만', '홍콩', '마카오'], th: ['태국'], vi: ['베트남'], id: ['인도네시아', '말레이시아', '브루나이'],
  fr: ['프랑스', '모나코', '룩셈부르크', '모로코', '튀니지', '세네갈', '뉴칼레도니아', '뉴칼레도니', '프랑스령폴리네시아'], de: ['독일', '오스트리아'], it: ['이탈리아'],
  es: ['스페인', '멕시코', '쿠바', '아르헨티나', '페루', '콜롬비아', '에콰도르', '칠레', '코스타리카', '볼리비아', '우루과이', '파나마', '과테말라'],
  pt: ['포르투갈', '브라질'], nl: ['네덜란드'], tr: ['튀르키예'], ru: ['러시아', '벨라루스', '카자흐스탄', '키르기스스탄', '우즈베키스탄'],
};
const BY_COUNTRY = Object.fromEntries(Object.entries(LANG).flatMap(([k, v]) => v.map(c => [c, k])));
export const langOf = (country) => BY_COUNTRY[country] || 'en';
export const LANG_NAME = { ko: '한국어', ja: '일본어', zh: '중국어', zht: '중국어', th: '태국어', vi: '베트남어', id: '인도네시아어', fr: '프랑스어', de: '독일어', it: '이탈리아어', es: '스페인어', pt: '포르투갈어', nl: '네덜란드어', tr: '튀르키예어', ru: '러시아어', en: '영어' };

/* ── 자리별 검색어 ── */
const K = ['morning', 'forenoon', 'lunch', 'afternoon', 'evening', 'dinner', 'activity', 'spa', 'shopping', 'premium', 'nature', 'photo', 'food'];
const Q = {
  ko: ['동네 빵집|아침 식사 되는 동네 식당', '전통시장|동네 산책하기 좋은 골목', '백반 잘하는 동네 식당|노포 점심', '동네 카페|독립서점', '동네 야시장|소극장 라이브 카페', '동네 단골 많은 식당|동네 노포', '공방 체험|동네 생활체육', '동네 목욕탕 사우나|마사지', '오일장 시장|소품 가게 골목', '동네 사람들이 모임하는 식당', '둘레길 산책|수목원 호수공원', '노을 보기 좋은 동네|골목 풍경', '시장 먹거리|동네 분식'],
  ja: ['地元で人気のパン屋|モーニング 喫茶店', '地元の商店街|住宅街 散歩 緑道', '昔ながらの定食屋|大衆食堂 ランチ', '個人経営のカフェ|古本屋 雑貨店', '地元の人が集まる横丁|ジャズ喫茶 ライブハウス', '昔ながらの居酒屋|町中華', '陶芸体験 工房|ボルダリング', '銭湯|スーパー銭湯', '商店街 雑貨 古着|地元の市場', '地元で評判の割烹', '緑地公園|里山 ハイキング', '夕日 高台 住宅街|坂道 路地', '商店街 食べ歩き|立ち飲み'],
  zh: ['本地人 早餐店|老字号 早点', '菜市场|老街 胡同 散步', '本地人 常去 小馆子|家常菜 苍蝇馆子', '独立书店|社区咖啡馆', '夜市 本地人|小剧场 live house', '本地人 常去 晚餐|大排档', '手工体验 工作室|陶艺', '澡堂 汗蒸|按摩', '旧货市场|小店 街区', '本地人 宴请 餐厅', '郊野公园|湿地公园', '日落 观景 本地|老城区 弄堂', '夜市 小吃 本地人|菜市场 小吃'],
  zht: ['在地人 早餐店|傳統早餐', '傳統市場|老街 巷弄 散步', '在地人 常吃 小吃 午餐|平價食堂', '獨立書店|巷弄咖啡館', '在地夜市|小酒館 現場音樂', '在地人 熱炒|老店 晚餐', '手作 體驗 工作室|陶藝', '公共浴池 溫泉|按摩', '選物店 小店|市集', '在地人 聚餐 餐廳', '郊山步道|自然公園', '夕陽 在地 景點|巷弄 老屋', '在地夜市 小吃|市場 美食'],
  th: ['ร้านโจ๊ก ร้านเก่าแก่|ร้านกาแฟในซอย', 'ตลาดสดชุมชน|สวนสาธารณะ', 'ร้านข้าวแกง คนท้องถิ่น|ร้านก๋วยเตี๋ยวเจ้าเก่า', 'คาเฟ่ในซอย|ร้านหนังสืออิสระ', 'ตลาดนัดกลางคืน ชุมชน|บาร์ดนตรีสดในซอย', 'ร้านอาหารตามสั่ง คนท้องถิ่น|ร้านอาหารเจ้าเก่า', 'เวิร์กช็อป งานฝีมือ|มวยไทย ยิม', 'นวดแผนไทย ย่านชุมชน', 'ตลาดนัด|ร้านของมือสอง', 'ร้านอาหาร คนกรุงไปฉลอง', 'สวนสาธารณะ ธรรมชาติ|พื้นที่สีเขียว', 'จุดชมพระอาทิตย์ตก|ตรอกเก่า ย่านเก่า', 'สตรีทฟู้ด คนท้องถิ่น|ตลาดของกิน'],
  vi: ['quán phở người địa phương|cà phê vỉa hè', 'chợ dân sinh|công viên', 'quán cơm bình dân|quán ăn lâu đời', 'quán cà phê trong hẻm|nhà sách', 'chợ đêm địa phương|quán cà phê acoustic', 'quán nhậu người địa phương|quán ăn gia đình', 'lớp học thủ công|xưởng gốm', 'massage gội đầu dưỡng sinh', 'chợ đồ cũ|cửa hàng địa phương', 'nhà hàng người địa phương hay đi', 'công viên thiên nhiên|đường đi bộ', 'ngắm hoàng hôn|khu phố cũ', 'ăn vặt vỉa hè|chợ ẩm thực'],
  id: ['warung kopi lokal|sarapan bubur', 'pasar tradisional|taman kota', 'warung makan legendaris|rumah makan favorit warga', 'kafe lokal|toko buku independen', 'pasar malam warga|kafe musik live', 'warung makan malam favorit warga', 'workshop kerajinan|kelas membatik', 'pijat tradisional', 'pasar loak|toko lokal', 'restoran favorit warga', 'taman alam|jalur hiking', 'tempat lihat matahari terbenam|kampung', 'kuliner kaki lima|jajanan pasar'],
  fr: ['boulangerie de quartier|café de quartier', 'marché de quartier|parc de quartier', 'bistrot de quartier|cantine locale', 'librairie indépendante|torréfacteur', 'bar de quartier|petit bar concert', 'restaurant de quartier habitués|bistrot populaire', 'atelier céramique|cours artisanat', 'hammam|bains publics', 'friperie|brocante', 'restaurant apprécié des habitants', 'parc naturel|sentier promenade', 'point de vue calme|ruelle', 'marché couvert|street food locale'],
  de: ['Bäckerei im Kiez|Frühstückscafé', 'Wochenmarkt|Stadtpark', 'Mittagstisch|Traditionswirtschaft', 'Buchladen|Rösterei', 'Kiezkneipe|Live Musik Kneipe', 'Wirtshaus Einheimische|Stammlokal', 'Keramik Werkstatt|Kletterhalle', 'Stadtbad|Sauna', 'Flohmarkt|Secondhand Laden', 'Restaurant beliebt bei Einheimischen', 'Naturpark|Waldspaziergang', 'Aussicht Sonnenuntergang|Altstadtgasse', 'Markthalle|Imbiss'],
  it: ['bar pasticceria di quartiere|forno', 'mercato rionale|parco di quartiere', 'trattoria di quartiere|osteria pranzo', 'libreria indipendente|torrefazione', 'enoteca di quartiere|locale musica dal vivo', 'trattoria frequentata dai locali|osteria', 'laboratorio ceramica|corso artigianato', 'terme|hammam', 'mercatino|negozi artigiani', 'ristorante amato dai residenti', 'parco naturale|sentiero', 'tramonto belvedere tranquillo|vicoli', 'mercato coperto|cibo di strada locale'],
  es: ['panadería de barrio|cafetería de barrio', 'mercado de barrio|parque de barrio', 'menú del día bar de barrio|comida casera', 'librería independiente|café de especialidad', 'bar de barrio|bar con música en vivo', 'taberna frecuentada por locales|restaurante de barrio', 'taller de cerámica|taller artesanía', 'baños|spa de barrio', 'mercadillo|tiendas de segunda mano', 'restaurante favorito de los vecinos', 'parque natural|sendero', 'mirador atardecer|callejón', 'mercado gastronómico vecinos|puestos de comida'],
  pt: ['padaria de bairro|pastelaria', 'mercado municipal|jardim de bairro', 'tasca almoço|restaurante caseiro', 'livraria independente|café de bairro', 'bar de bairro|bar música ao vivo', 'tasca frequentada por locais|boteco', 'ateliê cerâmica|oficina artesanato', 'spa|termas', 'feira da ladra|loja de segunda mão', 'restaurante preferido dos moradores', 'parque natural|trilho', 'miradouro pôr do sol|ruela', 'feira comida de rua|mercado comida'],
  nl: ['bakker in de buurt|buurtcafé', 'buurtmarkt|park', 'lunchroom locals|eetcafé', 'boekwinkel|koffiebranderij', 'bruin café|café live muziek', 'buurtrestaurant|eetcafé', 'keramiek workshop', 'badhuis|sauna', 'kringloopwinkel|vintage', 'restaurant geliefd bij locals', 'natuurgebied|wandelpad', 'zonsondergang|hofje', 'markthal|streetfood locals'],
  tr: ['mahalle fırını|kahvaltı salonu', 'semt pazarı|park', 'esnaf lokantası|ev yemekleri', 'bağımsız kitapçı|mahalle kahvesi', 'çay bahçesi|canlı müzik mekan', 'meyhane semt|mahalle lokantası', 'seramik atölyesi', 'mahalle hamamı', 'bit pazarı|ikinci el', 'semt sakinlerinin sevdiği restoran', 'koru|doğa yürüyüşü', 'gün batımı tepe|arka sokaklar', 'sokak lezzetleri|semt pazarı yemek'],
  ru: ['пекарня у дома|кафе завтрак', 'рынок|парк для прогулок', 'столовая|кафе домашняя кухня', 'независимый книжный|кофейня', 'бар для местных|клуб живая музыка', 'ресторан местной кухни|кафе для местных', 'мастерская керамики', 'баня', 'блошиный рынок|винтаж', 'ресторан любят местные', 'лесопарк|природная тропа', 'закат смотровая|старые дворы', 'рынок еда|уличная еда'],
  en: ['neighborhood bakery|local breakfast cafe', 'neighborhood market|local park', 'local favorite lunch spot|family run restaurant', 'independent bookstore|neighborhood coffee roaster', 'neighborhood bar live music|local night market', 'locals favorite dinner|neighborhood restaurant', 'pottery studio class|climbing gym', 'local bathhouse|massage', 'thrift store|flea market', 'restaurant locals love special occasion', 'nature reserve trail|quiet park', 'sunset lookout locals|quiet alley', 'food market locals|street food locals'],
};
const TABLE = Object.fromEntries(Object.entries(Q).map(([l, a]) => [l, Object.fromEntries(K.map((k, i) => [k, a[i].split('|')]))]));
const DIET = { veg: 'vegetarian', halal: 'halal', gluten: 'gluten free' };
const DIET_KO = { veg: '채식', halal: '할랄', gluten: '글루텐 프리' };

/** 그 나라 글자로 된 도시 이름 — 없으면 영문, 국내는 한글 */
export function cityInLang(city, lang) {
  if (!city) return '';
  if (lang === 'ko') return city.name;
  const al = city.aliases || [];
  if (['ja', 'zh', 'zht', 'th', 'ru'].includes(lang)) { const n = al.find(a => /[^\u0000-ɏ]/.test(a)); if (n) return n; }
  return al.find(a => /^[\u0000-ɏ]+$/.test(a)) || al[0] || city.name;
}

/** 세부 스타일이 자리의 검색어를 바꾼다. */
export function slotKind(slot, styles = [], { kids = false } = {}) {
  const on = (s) => styles.includes(s);
  if (slot === 'evening' && kids && !on('사진 명소') && !on('자연 중심')) return 'food';      // 아이와 함께면 술집 대신 먹거리 골목
  if (slot === 'evening') return on('사진 명소') ? 'photo' : on('자연 중심') ? 'nature' : 'evening';
  if (slot === 'forenoon') return on('자연 중심') ? 'nature' : on('쇼핑 중심') ? 'shopping' : 'forenoon';
  if (slot === 'afternoon') return on('맛집 중심') && !on('쇼핑 중심') ? 'food' : on('쇼핑 중심') ? 'shopping' : 'afternoon';
  return slot;
}

/** 자리 하나의 검색어. round 가 커지면 다른 검색어로(여러 날이면 후보를 새로 받는다). */
export function localQuery(slot, { city, country, styles = [], needs = [], round = 0, seed = 0, kids = false } = {}) {
  const lang = langOf(country || city?.country);
  const kind = slotKind(slot, styles, { kids });
  const list = TABLE[lang][kind] || TABLE[lang].forenoon;
  const food = ['morning', 'lunch', 'dinner', 'premium', 'food'].includes(kind);
  const diet = food ? needs.filter(n => DIET[n]).map(n => (lang === 'ko' ? DIET_KO : DIET)[n])[0] || '' : '';
  return [cityInLang(city, lang), diet, list[(round + seed) % list.length]].filter(Boolean).join(' ');
}

/* ── 관광지 거르기 ── */
const TOURIST = new Set(['tourist_attraction', 'amusement_park', 'amusement_center', 'theme_park', 'water_park', 'observation_deck', 'visitor_center', 'tourist_information_center', 'historical_landmark',
  'monument', 'cultural_landmark', 'zoo', 'aquarium', 'ferris_wheel', 'casino', 'wax_museum', 'gift_shop', 'souvenir_store', 'travel_agency', 'tour_agency', 'sightseeing_tour_agency', 'cruise_terminal']);
const LODGING = new Set(['hotel', 'lodging', 'hostel', 'motel', 'resort_hotel', 'guest_house', 'bed_and_breakfast', 'extended_stay_hotel']);
const MALL = new Set(['shopping_mall', 'department_store']);
const NEIGHBOR = new Set(['market', 'farmers_market', 'flea_market', 'bakery', 'coffee_shop', 'book_store', 'public_bath', 'sauna', 'park', 'city_park', 'garden', 'hiking_area', 'library', 'community_center', 'food_court',
  'grocery_store', 'thrift_store', 'diner', 'izakaya_restaurant', 'ramen_restaurant', 'noodle_shop', 'pub', 'bistro', 'deli', 'butcher_shop', 'confectionery', 'tea_house', 'art_studio', 'plaza', 'playground', 'sports_complex']);
const CHAIN = /스타벅스|starbucks|맥도날드|mcdonald|버거킹|burger king|kfc|서브웨이|subway|피자헛|pizza hut|도미노|domino|던킨|dunkin|하드록|hard rock|이치란|ichiran|一蘭|스키야|すき家|마쓰야|松屋|요시노야|吉野家|도토루|doutor|ドトール|투썸|이디야|메가커피|빽다방|파리바게뜨|뚜레쥬르|올리브영|유니클로|uniqlo|돈키호테|don quijote|ドン・キホーテ|무인양품|^muji|zara|h&m|세븐일레븐|seven.?eleven|패밀리마트|familymart|로손|lawson|이케아|ikea/i;
const TOURWORD = /투어|축제$|festival|기념품|면세|크루즈|관광안내|여행자|souvenir|duty ?free|hop[- ]?on|cruise|tourist|sightseeing|\btours?\b|ticket/i;

const rad = Math.PI / 180;
function km(a, b) {
  const s = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}
/** 대표 관광지 목록(검색 결과) → 거르기에 쓸 자료 */
export function famousIndex(places = []) {
  const top = places.filter(p => Number.isFinite(p.latitude));
  const counts = top.map(p => p.user_rating_count || 0).sort((a, b) => a - b);
  const mid = counts.length ? counts[Math.floor(counts.length / 2)] : 20000;
  // bar — 그 도시에서 ‘유명한 곳’의 후기 수. 도쿄·파리는 수만, 강릉은 수천으로 도시마다 다르다.
  return { ids: new Set(top.map(p => p.place_id)), names: new Set(top.map(p => String(p.name || '').replace(/\s/g, ''))), bar: Math.max(3000, Math.min(60000, mid)),
    spots: top.filter(p => (p.user_rating_count || 0) >= mid * .5).slice(0, 12) };
}

const AREA = new Set(['park', 'city_park', 'garden', 'market', 'farmers_market', 'flea_market', 'plaza', 'hiking_area', 'shopping_street', 'neighborhood', 'botanical_garden']);
/** 장소 하나를 본다 — kind: 'local' 동네 · 'famous' 유명 · '' 어느 쪽도 아님. score 는 클수록 동네 장소답다. */
export function localScore(p, { famous = null, food = false, level = '보통' } = {}) {
  const types = new Set(p.types || []);
  const n = Number.isFinite(p.user_rating_count) ? p.user_rating_count : null;
  const r = Number.isFinite(p.rating) ? p.rating : null;
  const name = String(p.name || '');
  const bar = famous?.bar || 20000;
  const has = (set) => [...types].some(t => set.has(t));
  const inList = !!famous && (famous.ids.has(p.place_id) || famous.names.has(name.replace(/\s/g, '')));
  // Google 은 동네 상점가·공원에도 ‘관광 명소’를 붙인다 — 공원·시장이거나 후기가 적으면 크게 깎지 않는다.
  const tour = has(TOURIST);
  const area = has(AREA) || /상점가|시장|골목|공원|거리|商店街|公園|緑道|shotengai|shōtengai|shopping street|market|park|square|jardin|parc|marché|mercato|mercado|markt/i.test(name);
  const fame = n == null ? 0 : n / (food ? 12000 : bar * .45);          // 1 이 넘으면 그 도시의 유명한 곳
  const isFamous = inList || fame > 1;
  let s = 0;
  if (inList) s -= 6;
  if (tour) s -= food ? .6 : area ? .2 : 1.6;
  if (has(LODGING)) s -= 6;
  if (has(MALL)) s -= 1.5;
  if (has(NEIGHBOR) || area) s += 1;
  if (CHAIN.test(name)) s -= 4;
  if (TOURWORD.test(name)) s -= 2.5;
  if (n == null) s -= .5;
  else if (n < 15) s -= 1.6;
  else if (n < 50) s -= food ? 0 : .5;
  else if (food) s += n <= 1500 ? 1.5 : n <= 4000 ? .4 : n <= 9000 ? -1.2 : -2.8;
  else s += fame <= .35 ? 1.5 : fame <= .7 ? .7 : fame <= 1 ? -.6 : -2.8;
  if (r != null) s += r >= 4.3 ? 1 : r >= 4 ? .6 : r < 3.6 ? -2 : 0;
  if (famous?.spots?.length && Number.isFinite(p.latitude) && famous.spots.some(f => f.place_id !== p.place_id && km(f, p) < .25)) s -= 1.2;   // 대표 관광지 바로 옆
  const price = String(p.price_level || '');
  if (food && level === '낮음') s += /INEXPENSIVE|MODERATE/.test(price) ? .4 : /EXPENSIVE/.test(price) ? -1.2 : 0;
  if (food && level === '높음') s += /PRICE_LEVEL_EXPENSIVE|VERY_EXPENSIVE/.test(price) ? .5 : 0;
  return { score: s, kind: isFamous ? 'famous' : s >= 1.2 ? 'local' : '' };
}

/** 후보를 동네 장소 순서로. 동네 위주에서는 유명한 곳·숙소·체인을 빼고, 남는 곳이 없으면 그대로 둔다. */
export function rankLocal(places, opts = {}) {
  const same = {};       // 같은 이름이 여러 번 나오면 체인점
  places.forEach(p => { const k = String(p.name || '').replace(/\s/g, '').toLowerCase(); same[k] = (same[k] || 0) + 1; });
  const scored = places.map((p, i) => {
    const l = localScore(p, opts);
    if (same[String(p.name || '').replace(/\s/g, '').toLowerCase()] > 1) l.score -= 2.5;
    return { ...p, _local: l, _i: i };
  });
  const keep = scored.filter(p => p._local.kind !== 'famous' && p._local.score > -2);
  return (keep.length >= 2 ? keep : scored.filter(p => p._local.kind !== 'famous').length ? scored.filter(p => p._local.kind !== 'famous') : scored)
    .sort((a, b) => (b._local.score - b._i * .06) - (a._local.score - a._i * .06));
}

/** 보여 줄 종류 — ‘쇼핑·관광’ 자리에 카페·식당이 들어오면 그 이름으로 부른다(비용 기준은 자리 그대로). */
export function shownCategory(p, cat) {
  if (cat !== '쇼핑' && cat !== '관광') return cat;
  const t = new Set(p.types || []);
  if (['cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop', 'coffee_roastery'].some(x => t.has(x)) && !t.has('book_store') && !t.has('market')) return '카페';
  if (['restaurant', 'bar', 'pub', 'izakaya_restaurant', 'wine_bar', 'bistro', 'meal_takeaway'].some(x => t.has(x)) && !t.has('market') && !t.has('park')) return '식사';
  return cat;
}

/** 일정에 동네 장소가 몇 곳인지 */
export function localMix(g) {
  const stops = (g?.days || []).flatMap(d => d.activities || []).filter(a => a.category !== '이동' && a.category !== '숙박' && !a.sample);
  return { total: stops.length, local: stops.filter(a => a.local === 'local').length, famous: stops.filter(a => a.local === 'famous').length };
}
