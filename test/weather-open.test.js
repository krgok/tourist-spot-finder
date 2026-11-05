import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStatus, filterOpenNow, toPlaceLocal } from '../js/openingHours.js';
import { roundCoord, buildWeatherUrl, parseWeather, describeWeather, fetchWeather, placeSetting, weatherMultiplier, WEATHER_ADJUST } from '../js/weather.js';
import { sortPlaces, searchNearbyTouristSpots } from '../js/places.js';
import { GENRES, PLACE_FIELD_MASK } from '../js/config.js';

const KEY = ['AI', 'zaTESTKEY_0123456789_abcdefghijklmnop'].join('');
const BKK = 420; // UTC+7
const NOW = Date.parse('2026-11-05T05:00:00Z'); // バンコクでは 12:00

test('toPlaceLocal: 現地時刻に換算(日付またぎも)', () => {
  assert.deepEqual(toPlaceLocal('2026-11-05T14:30:00Z', BKK), { date: '11/5', time: '21:30', ymd: '2026-11-05' });
  assert.equal(toPlaceLocal('2026-11-05T20:00:00Z', BKK).date, '11/6'); // UTC では 5 日、バンコクでは 6 日
  assert.equal(toPlaceLocal('2026-11-05T20:00:00Z', 540).time, '05:00'); // 日本(UTC+9)
  assert.equal(toPlaceLocal('bogus', BKK), null);
  assert.equal(toPlaceLocal('2026-11-05T00:00:00Z', undefined), null);
});

test('openStatus: 営業中(閉店時刻つき/なし)・営業時間外(開店時刻つき)・不明', () => {
  const open = { currentOpeningHours: { openNow: true, nextCloseTime: '2026-11-05T14:00:00Z' }, utcOffsetMinutes: BKK };
  assert.deepEqual(openStatus(open, { now: NOW }), { state: 'open', detail: '21:00まで' });
  const open24 = { currentOpeningHours: { openNow: true }, utcOffsetMinutes: BKK };
  assert.deepEqual(openStatus(open24, { now: NOW }), { state: 'open', detail: '' });
  const closed = { currentOpeningHours: { openNow: false, nextOpenTime: '2026-11-06T02:00:00Z' }, utcOffsetMinutes: BKK };
  assert.deepEqual(openStatus(closed, { now: NOW }), { state: 'closed', detail: '11/6 09:00から' }); // 翌日は日付つき
  const closedToday = { currentOpeningHours: { openNow: false, nextOpenTime: '2026-11-05T11:00:00Z' }, utcOffsetMinutes: BKK };
  assert.equal(openStatus(closedToday, { now: NOW }).detail, '18:00から');
  assert.deepEqual(openStatus({}, { now: NOW }), { state: 'unknown', detail: '' });
  assert.equal(openStatus({ currentOpeningHours: { openNow: 'yes' } }).state, 'unknown');
});

test('openStatus: utcOffsetMinutes が無ければ時刻は出さず、状態だけ', () => {
  assert.deepEqual(openStatus({ currentOpeningHours: { openNow: true, nextCloseTime: '2026-11-05T14:00:00Z' } }, { now: NOW }), { state: 'open', detail: '' });
});

test('openStatus: currentOpeningHours が無ければ regularOpeningHours.openNow を使う', () => {
  assert.equal(openStatus({ regularOpeningHours: { openNow: false } }).state, 'closed');
});

test('filterOpenNow: 営業時間外だけを除く(不明は残す)', () => {
  const ps = [
    { id: 'open', currentOpeningHours: { openNow: true } },
    { id: 'closed', currentOpeningHours: { openNow: false } },
    { id: 'unknown' },
  ];
  assert.deepEqual(filterOpenNow(ps).map((p) => p.id), ['open', 'unknown']);
});

test('検索のフィールドに currentOpeningHours と utcOffsetMinutes がある', () => {
  assert.ok(PLACE_FIELD_MASK.includes('places.currentOpeningHours'));
  assert.ok(PLACE_FIELD_MASK.includes('places.utcOffsetMinutes'));
});

test('searchNearbyTouristSpots: openNowOnly は件数を切り詰める前に営業時間外を除く', async () => {
  const mk = (id, openNow, rating) => ({ id, displayName: { text: id }, types: ['tourist_attraction'], primaryType: 'tourist_attraction', rating, userRatingCount: 100, location: { latitude: 35, longitude: 139 }, ...(openNow === undefined ? {} : { currentOpeningHours: { openNow } }) });
  const places = [mk('c1', false, 4.9), mk('c2', false, 4.8), mk('o1', true, 4.0), mk('u1', undefined, 3.9)];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ places }) });
  const base = { apiKey: KEY, lat: 35, lng: 139, radiusMeters: 2000, maxCount: 2, genre: 'sightseeing', fetchImpl };
  assert.deepEqual((await searchNearbyTouristSpots({ ...base })).places.map((p) => p.id), ['c1', 'c2']);
  assert.deepEqual((await searchNearbyTouristSpots({ ...base, openNowOnly: true })).places.map((p) => p.id), ['o1', 'u1']);
});

const REAL = {
  current: { temperature_2m: 31.2, apparent_temperature: 37.4, precipitation: 0, weather_code: 2 },
  daily: { precipitation_probability_max: [20] },
};

test('buildWeatherUrl: 座標・現在値・降水確率を要求', () => {
  const u = new URL(buildWeatherUrl({ lat: 13.7563, lng: 100.5018 }));
  assert.equal(u.host, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude'), '13.76'); // 約 1 km に丸める
  assert.equal(u.searchParams.get('longitude'), '100.5');
  assert.ok(u.searchParams.get('current').includes('apparent_temperature'));
  assert.equal(u.searchParams.get('daily'), 'precipitation_probability_max');
});

test('parseWeather: 暑い日(体感 35℃以上)・雨の日・穏やかな日', () => {
  const hot = parseWeather(REAL);
  assert.equal(hot.hot, true); assert.equal(hot.rainy, false); assert.equal(hot.preferIndoor, true);
  const rainyByCode = parseWeather({ current: { temperature_2m: 25, apparent_temperature: 26, precipitation: 0, weather_code: 63 } });
  assert.equal(rainyByCode.rainy, true);
  const rainyByMm = parseWeather({ current: { temperature_2m: 25, apparent_temperature: 26, precipitation: 0.5, weather_code: 3 } });
  assert.equal(rainyByMm.rainy, true);
  const rainyByProb = parseWeather({ current: { temperature_2m: 25, apparent_temperature: 26, precipitation: 0, weather_code: 3 }, daily: { precipitation_probability_max: [60] } });
  assert.equal(rainyByProb.rainy, true);
  const calm = parseWeather({ current: { temperature_2m: 22, apparent_temperature: 22, precipitation: 0, weather_code: 1 }, daily: { precipitation_probability_max: [10] } });
  assert.equal(calm.preferIndoor, false);
  // 境界: 体感 34.9 は暑くない、35 は暑い
  assert.equal(parseWeather({ current: { temperature_2m: 30, apparent_temperature: 34.9 } }).hot, false);
  assert.equal(parseWeather({ current: { temperature_2m: 30, apparent_temperature: 35 } }).hot, true);
});

test('parseWeather: 不正・欠損・範囲外は null(画面に出さない)', () => {
  for (const bad of [null, undefined, {}, { current: {} }, { current: { temperature_2m: 'hot' } }, { current: { temperature_2m: 999 } }, { current: { temperature_2m: NaN } }, 'x']) {
    assert.equal(parseWeather(bad), null);
  }
  // 体感・降水が欠けても気温があれば使える
  assert.equal(parseWeather({ current: { temperature_2m: 20 } }).apparent, 20);
});

test('describeWeather: 屋内を上位にする理由を、並び順への反映有無に合わせて説明する', () => {
  const w = parseWeather(REAL);
  assert.match(describeWeather(w), /薄曇り・31℃・体感37℃・降水確率20%.*暑さのため、屋内のスポットを上位にしています/);
  assert.match(describeWeather(w, { applied: false }), /「おすすめ順」にすると屋内/);
  assert.doesNotMatch(describeWeather(parseWeather({ current: { temperature_2m: 22, weather_code: 0 } })), /屋内/);
  assert.equal(describeWeather(null), '');
});

test('fetchWeather: 失敗(HTTP・通信・タイムアウト・不正な座標)はすべて null で、例外にしない', async () => {
  assert.equal((await fetchWeather({ lat: 13, lng: 100, fetchImpl: async () => ({ ok: true, json: async () => REAL }) })).hot, true);
  assert.equal(await fetchWeather({ lat: 13, lng: 100, fetchImpl: async () => ({ ok: false, status: 429 }) }), null);
  assert.equal(await fetchWeather({ lat: 13, lng: 100, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), null);
  assert.equal(await fetchWeather({ lat: 13, lng: 100, fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }) }), null);
  let called = false;
  assert.equal(await fetchWeather({ lat: 999, lng: 0, fetchImpl: async () => { called = true; } }), null);
  assert.equal(called, false);
});

test('placeSetting: 主たる種類を優先し、無ければジャンルの屋内設定', () => {
  assert.equal(placeSetting({ primaryType: 'museum', types: ['tourist_attraction'] }), 'indoor');
  assert.equal(placeSetting({ primaryType: 'park', types: ['tourist_attraction'] }), 'outdoor');
  assert.equal(placeSetting({ primaryType: 'tourist_attraction', types: ['tourist_attraction'] }), 'unknown');
  assert.equal(placeSetting({ types: ['tourist_attraction'] }, GENRES.mall), 'indoor');
  assert.equal(placeSetting({}), 'unknown');
});

test('weatherMultiplier: 雨・暑さのときだけ、屋内を上げ屋外を下げる(控えめ)', () => {
  const w = { preferIndoor: true };
  assert.equal(weatherMultiplier({ primaryType: 'museum' }, null, w), WEATHER_ADJUST.indoorBonus);
  assert.equal(weatherMultiplier({ primaryType: 'park' }, null, w), WEATHER_ADJUST.outdoorPenalty);
  assert.equal(weatherMultiplier({ primaryType: 'tourist_attraction' }, null, w), 1);
  assert.equal(weatherMultiplier({ primaryType: 'museum' }, null, { preferIndoor: false }), 1);
  assert.equal(weatherMultiplier({ primaryType: 'museum' }, null, null), 1);
  assert.ok(WEATHER_ADJUST.indoorBonus <= 1.15 && WEATHER_ADJUST.outdoorPenalty >= 0.85, '調整幅は控えめに');
});

test('sortPlaces: 雨の日は、おすすめ順でだけ屋内が上がる。評価順・距離順は変わらない', () => {
  const mk = (id, primaryType, rating) => ({ id, primaryType, types: [primaryType], rating, userRatingCount: 500, location: { latitude: 35, longitude: 139 } });
  const park = mk('park', 'park', 4.6);
  const museum = mk('museum', 'museum', 4.4);
  const origin = { lat: 35, lng: 139 };
  const rainy = { preferIndoor: true };
  assert.deepEqual(sortPlaces([museum, park], 'recommended', origin, 2000).map((p) => p.id), ['park', 'museum']); // 天気なし
  assert.deepEqual(sortPlaces([museum, park], 'recommended', origin, 2000, { weather: rainy }).map((p) => p.id), ['museum', 'park']);
  assert.deepEqual(sortPlaces([museum, park], 'rating', origin, 2000, { weather: rainy }).map((p) => p.id), ['park', 'museum']);
});

test('index.html: CSP に天気サービスだけを追加し、チェックボックスがある', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src[^;]*https:\/\/api\.open-meteo\.com/);
  assert.match(html, /id="open-now-only"/);
  assert.match(html, /id="use-weather" checked/);
  assert.match(html, /Open-Meteo に送ります/); // 送信先の明示
});

test('座標は小数 2 桁(約 1 km)に丸めて送る。正確な位置は URL に出ない', async () => {
  assert.equal(roundCoord(35.689487), 35.69);
  assert.equal(roundCoord(-0.004), 0);
  let seenUrl;
  await fetchWeather({ lat: 35.689487, lng: 139.691706, fetchImpl: async (url) => { seenUrl = url; return { ok: true, json: async () => REAL }; } });
  const u = new URL(seenUrl);
  assert.equal(u.searchParams.get('latitude'), '35.69');
  assert.equal(u.searchParams.get('longitude'), '139.69');
  assert.ok(!seenUrl.includes('689487') && !seenUrl.includes('691706'));
});
