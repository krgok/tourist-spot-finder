// 検索条件の検査・正規化(DOMに依存しない純粋関数)。
// 利用者が指定できる最大値を制限し、API の課金・負荷が意図せず増えないようにする。
// 履歴・お気に入り(DB 由来の値)から条件を復元するときにも使う。

export const SEARCH_LIMITS = {
  radiusOptions: [1000, 2000, 5000, 10000],
  countOptions: [5, 10, 20],
  minRadius: 100,
  maxRadius: 10000, // Places API の上限は 50000 だが、アプリの選択肢の最大に合わせる
  maxCount: 20, // searchNearby の maxResultCount の上限
  defaultRadius: 2000,
  defaultCount: 10,
};

// 候補の中で最も近い値(同じ距離なら小さい方)。数値でなければ fallback。
export function snapToOption(value, options, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return options.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), options[0]);
}

// API 呼び出し直前の最終防御(UI の選択肢以外が来ても上限を超えない)
export function clampSearchParams({ radiusMeters, maxCount }) {
  const r = Number(radiusMeters);
  const c = Number(maxCount);
  return {
    radiusMeters: Number.isFinite(r)
      ? Math.min(Math.max(Math.round(r), SEARCH_LIMITS.minRadius), SEARCH_LIMITS.maxRadius)
      : SEARCH_LIMITS.defaultRadius,
    maxCount: Number.isFinite(c)
      ? Math.min(Math.max(Math.round(c), 1), SEARCH_LIMITS.maxCount)
      : SEARCH_LIMITS.defaultCount,
  };
}

// UI の選択肢に合わせる(履歴の再検索など)
export function normalizeForUi({ radiusMeters, maxCount }) {
  return {
    radiusMeters: snapToOption(radiusMeters, SEARCH_LIMITS.radiusOptions, SEARCH_LIMITS.defaultRadius),
    maxCount: snapToOption(maxCount, SEARCH_LIMITS.countOptions, SEARCH_LIMITS.defaultCount),
  };
}

export function isOneOf(value, allowed) {
  return Object.prototype.hasOwnProperty.call(allowed, value);
}
