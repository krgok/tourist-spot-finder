// 地域・言語の選択に関する純粋関数。
import { REGIONS, LANGUAGES, DEFAULT_REGION, DEFAULT_LANGUAGE, GENRES } from './config.js?v=20260708-4';

export function normalizeRegion(value) {
  return Object.prototype.hasOwnProperty.call(REGIONS, value) ? value : DEFAULT_REGION;
}

export function normalizeLanguage(value) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, value) ? value : DEFAULT_LANGUAGE;
}

// 初回(保存された設定がない)のときの地域の推定。タイムゾーンだけを見る(位置情報は使わない)。
export function guessRegion(timeZone) {
  return timeZone === 'Asia/Bangkok' ? 'th' : DEFAULT_REGION;
}

// その地域で選べるジャンルのキー(config に存在するものだけ)
export function genreKeysFor(region) {
  return REGIONS[normalizeRegion(region)].genreKeys.filter((k) => GENRES[k]);
}

// 選択中のジャンルが地域内になければ、先頭のジャンルにする
export function genreForRegion(region, current) {
  const keys = genreKeysFor(region);
  return keys.includes(current) ? current : keys[0];
}
