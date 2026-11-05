// 天気の取得と、おすすめ順への反映(屋内/屋外)。
// 天気は Open-Meteo(キー不要・ブラウザから呼べる公開 API)から取得する。
// 送る情報は検索地点の座標のみ(約 1 km の精度=小数 2 桁に丸めて送る。天気には十分で、自宅等の正確な位置を送らない)。
// 失敗しても検索は止めない(null を返す)。

import { timeoutSignal } from './http.js?v=20260708-4';

const WEATHER_TIMEOUT_MS = 5000;

export const WEATHER_CODE_LABELS = {
  0: '快晴', 1: '晴れ', 2: '薄曇り', 3: '曇り', 45: '霧', 48: '霧',
  51: '霧雨', 53: '霧雨', 55: '強い霧雨', 56: '着氷性の霧雨', 57: '着氷性の霧雨',
  61: '雨', 63: '雨', 65: '強い雨', 66: '着氷性の雨', 67: '着氷性の雨',
  71: '雪', 73: '雪', 75: '強い雪', 77: '霧雪', 80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  85: 'にわか雪', 86: 'にわか雪', 95: '雷雨', 96: '雹を伴う雷雨', 99: '雹を伴う雷雨',
};
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

export const THRESHOLDS = { rainMm: 0.2, rainProbability: 60, hotApparentC: 35 };
export const WEATHER_ADJUST = { indoorBonus: 1.1, outdoorPenalty: 0.92 };

// 小数 2 桁(約 1 km)に丸める
export const roundCoord = (v) => Number(Number(v).toFixed(2)) + 0; // + 0 で -0 を 0 にする

export function buildWeatherUrl({ lat, lng }) {
  const params = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lng)),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code',
    daily: 'precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

// API のレスポンスを整える。必要な値が無い/範囲外なら null(画面に出さない)。
export function parseWeather(json) {
  const c = json?.current;
  const temp = num(c?.temperature_2m, -90, 70);
  if (temp === null) return null;
  const apparent = num(c?.apparent_temperature, -90, 80) ?? temp;
  const precipitation = num(c?.precipitation, 0, 1000) ?? 0;
  const code = Number.isInteger(c?.weather_code) ? c.weather_code : null;
  const probability = num(json?.daily?.precipitation_probability_max?.[0], 0, 100);

  const rainy = precipitation >= THRESHOLDS.rainMm || RAIN_CODES.has(code) || (probability ?? 0) >= THRESHOLDS.rainProbability;
  const hot = apparent >= THRESHOLDS.hotApparentC;
  return { temp, apparent, precipitation, code, probability, rainy, hot, preferIndoor: rainy || hot };
}

// applied: 並び順に天気を反映しているか(「おすすめ順」のときだけ反映する)
export function describeWeather(w, { applied = true } = {}) {
  if (!w) return '';
  const label = WEATHER_CODE_LABELS[w.code] ?? '天気不明';
  const parts = [`${label}・${Math.round(w.temp)}℃`];
  if (Math.round(w.apparent) !== Math.round(w.temp)) parts.push(`体感${Math.round(w.apparent)}℃`);
  if (w.probability !== null) parts.push(`降水確率${Math.round(w.probability)}%`);
  let text = `検索地点の天気: ${parts.join('・')}`;
  if (!w.preferIndoor) return text;
  const reason = w.rainy && w.hot ? '雨と暑さ' : w.rainy ? '雨' : '暑さ';
  text += applied
    ? ` — ${reason}のため、屋内のスポットを上位にしています`
    : ` — ${reason}のため、並び替えを「おすすめ順」にすると屋内のスポットを上位にします`;
  return text;
}

// 失敗(通信・タイムアウト・不正な応答)はすべて null。検索を止めない。
export async function fetchWeather({ lat, lng, fetchImpl = globalThis.fetch }) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const timer = timeoutSignal(WEATHER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(buildWeatherUrl({ lat, lng }), { signal: timer.signal });
    if (!res.ok) return null;
    return parseWeather(await res.json());
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

// ---- 屋内/屋外の推定(施設のタイプから) ----
const INDOOR_TYPES = new Set([
  'museum', 'art_gallery', 'shopping_mall', 'department_store', 'aquarium', 'library', 'movie_theater',
  'cafe', 'coffee_shop', 'tea_house', 'bakery', 'sandwich_shop', 'restaurant', 'spa',
  'coworking_space', 'business_center', 'amusement_center', 'indoor_playground',
]);
const OUTDOOR_TYPES = new Set([
  'park', 'playground', 'zoo', 'amusement_park', 'water_park', 'shinto_shrine', 'buddhist_temple', 'hindu_temple',
  'market', 'garden', 'botanical_garden', 'hiking_area', 'national_park', 'stadium',
]);

// 'indoor' | 'outdoor' | 'unknown'。主たる種類 → ほかの種類 → ジャンルの設定 の順で判断する。
export function placeSetting(place, genreConfig) {
  const kinds = [place?.primaryType, ...(place?.types || [])].filter(Boolean);
  for (const k of kinds) {
    if (INDOOR_TYPES.has(k)) return 'indoor';
    if (OUTDOOR_TYPES.has(k)) return 'outdoor';
  }
  return genreConfig?.indoor ? 'indoor' : 'unknown';
}

// 「おすすめ順」のスコアに掛ける係数。雨・暑さのときだけ、屋内を少し上げ、屋外を少し下げる
// (距離による減衰(最大約12%)と同程度の穏やかな調整。「近い順」「評価順」には影響しない)。
export function weatherMultiplier(place, genreConfig, weather) {
  if (!weather?.preferIndoor) return 1;
  const setting = placeSetting(place, genreConfig);
  if (setting === 'indoor') return WEATHER_ADJUST.indoorBonus;
  if (setting === 'outdoor') return WEATHER_ADJUST.outdoorPenalty;
  return 1;
}
