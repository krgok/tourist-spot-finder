import { PLACE_FIELD_MASK, GENRES, RANKING } from './config.js?v=20260708-4';
import { postGoogleApi } from './http.js?v=20260708-4';
import { clampSearchParams } from './params.js?v=20260708-4';
import { isValidLatLng } from './validate.js?v=20260708-4';

// アプリのUIは日本語固定のため、Places APIへのリクエストも常に日本語で行う。
// languageCodeをブラウザ言語に連動させていた頃は、editorialSummaryやレビューが
// 英語のまま返ってきて説明文に混ざる問題があった。
const REQUEST_LANGUAGE_CODE = 'ja';

// Nearby Searchの最大取得件数(20)を常に要求し、クライアント側のジャンル再照合・
// 品質フィルタで間引いてから表示件数(maxCount)に切り出す。APIはリクエスト単位課金なので
// 20件取得しても追加コストはない。
const FETCH_POOL_SIZE = 20;

export function matchesGenre(place, genreConfig) {
  const types = place.types || [];
  const isAllowed = genreConfig.allowedTypes.some((t) => types.includes(t));
  const isExcluded = genreConfig.excludedTypes.includes(place.primaryType);
  if (!isAllowed) {
    console.debug('[genre-filter] excluded (type mismatch):', place.displayName?.text, place.primaryType, types);
  } else if (isExcluded) {
    console.debug('[genre-filter] excluded (excludedTypes):', place.displayName?.text, place.primaryType);
  }
  return isAllowed && !isExcluded;
}

// businessStatusが未設定の場所は情報不足なだけで閉業と決めつけず、営業中扱いにする。
export function isOperational(place) {
  const status = place.businessStatus;
  const operational = status == null || status === 'OPERATIONAL';
  if (!operational) {
    console.debug('[business-status] excluded (not operational):', place.displayName?.text, status);
  }
  return operational;
}

export function bayesianScore(place) {
  const v = place.userRatingCount || 0;
  const R = place.rating ?? RANKING.priorMean;
  const m = RANKING.priorWeight;
  const C = RANKING.priorMean;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

// 「おすすめ順」用のスコア。ベイズ推定平均に、検索半径に対する相対距離での
// 穏やかな減衰を掛ける(「近い順」ソートと役割が被らないよう減衰幅は小さく保つ)。
export function recommendedScore(place, origin, radiusMeters) {
  const base = bayesianScore(place);
  if (!origin || !radiusMeters) return base;
  const d = distanceMeters(origin, toLatLng(place.location));
  if (!Number.isFinite(d)) return base;
  const decay = Math.max(0, 1 - RANKING.distanceDecayAlpha * (d / radiusMeters));
  return base * decay;
}

// Haversine formula. 地図表示や経路計算とは独立した、並び替え専用の概算距離(メートル)。
export function distanceMeters(from, to) {
  if (!from || !to) return Infinity;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function sortPlaces(places, sortKey, origin, radiusMeters) {
  const sorted = places.slice();
  switch (sortKey) {
    case 'distance':
      return sorted.sort(
        (a, b) =>
          distanceMeters(origin, toLatLng(a.location)) - distanceMeters(origin, toLatLng(b.location))
      );
    case 'rating':
      return sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    case 'reviewCount':
      return sorted.sort((a, b) => (b.userRatingCount || 0) - (a.userRatingCount || 0));
    case 'recommended':
    default:
      return sorted.sort(
        (a, b) => recommendedScore(b, origin, radiusMeters) - recommendedScore(a, origin, radiusMeters)
      );
  }
}

function toLatLng(location) {
  return location ? { lat: location.latitude, lng: location.longitude } : null;
}

// 段階的に条件を緩和して候補を確保する。`relaxed`はUIへの注記用で、
// 実際に緩和後の集合を採用した場合にのみtrueにする(以前は「候補が一部除外された」
// だけでtrueになってしまい、strict条件のまま候補が残っているケースでも
// 「評価件数の少ないスポットを含みます」という誤った注記が出ていた)。
export function applyQualityFilter(places, genreConfig) {
  const minRatingCount = genreConfig.minRatingCount ?? RANKING.defaultMinRatingCount;
  const minRating = RANKING.defaultMinRating;

  const strict = places.filter(
    (p) => (p.userRatingCount || 0) >= minRatingCount && (p.rating ?? 0) >= minRating
  );
  if (strict.length > 0) return { filtered: strict, relaxed: false };

  const reviewedAtLeastOnce = places.filter((p) => (p.userRatingCount || 0) >= 1);
  if (reviewedAtLeastOnce.length > 0) return { filtered: reviewedAtLeastOnce, relaxed: true };

  // レビューが1件もない場所しか残らない場合は、0件を返すよりはそのまま出す。
  return { filtered: places, relaxed: places.length > 0 };
}

// Nearby Search のリクエスト本文(通信を含まない。テスト用に分離)。
export function buildNearbyRequestBody({ lat, lng, radiusMeters, genreConfig }) {
  return {
    includedPrimaryTypes: genreConfig.includedPrimaryTypes,
    maxResultCount: FETCH_POOL_SIZE,
    rankPreference: 'POPULARITY',
    languageCode: REQUEST_LANGUAGE_CODE,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };
}

export async function searchNearbyTouristSpots({
  apiKey,
  lat,
  lng,
  radiusMeters: rawRadius,
  maxCount: rawMaxCount,
  genre,
  fetchImpl,
}) {
  if (!isValidLatLng(lat, lng)) {
    throw new Error('検索地点の緯度・経度が正しくありません。場所を指定し直してください。');
  }
  // API の課金・負荷が増えないよう、UI 以外から来た値でも上限を超えさせない。
  const { radiusMeters, maxCount } = clampSearchParams({ radiusMeters: rawRadius, maxCount: rawMaxCount });
  const genreConfig = GENRES[genre] || GENRES.sightseeing;

  const data = await postGoogleApi({
    url: 'https://places.googleapis.com/v1/places:searchNearby',
    apiKey,
    fieldMask: PLACE_FIELD_MASK,
    body: buildNearbyRequestBody({ lat, lng, radiusMeters, genreConfig }),
    apiLabel: 'Places API (New)',
    fetchImpl,
  });
  const rawPlaces = data.places || [];

  const genreMatched = rawPlaces.filter((p) => matchesGenre(p, genreConfig)).filter(isOperational);
  const { filtered, relaxed } = applyQualityFilter(genreMatched, genreConfig);

  const origin = { lat, lng };
  const ranked = filtered
    .slice()
    .sort((a, b) => recommendedScore(b, origin, radiusMeters) - recommendedScore(a, origin, radiusMeters))
    .slice(0, maxCount);

  return { places: ranked, relaxed, poolSize: rawPlaces.length, matchedSize: genreMatched.length };
}

export async function geocodeLocation({ apiKey, query, fetchImpl }) {
  const text = String(query ?? '').trim().slice(0, 200);
  if (!text) throw new Error('検索したい場所を入力してください。');

  const data = await postGoogleApi({
    url: 'https://places.googleapis.com/v1/places:searchText',
    apiKey,
    fieldMask: 'places.location,places.formattedAddress,places.displayName',
    body: { textQuery: text, languageCode: REQUEST_LANGUAGE_CODE, maxResultCount: 1 },
    apiLabel: 'Places API (New)',
    fetchImpl,
  });

  const place = data.places?.[0];
  const { latitude, longitude } = place?.location ?? {};
  if (!isValidLatLng(latitude, longitude)) {
    throw new Error(`「${text}」に一致する場所が見つかりませんでした。`);
  }

  return {
    lat: latitude,
    lng: longitude,
    formattedAddress: place.formattedAddress,
    displayName: place.displayName?.text,
  };
}

// 写真の URL(キーを含む)。photo.name は Places API が返す "places/<id>/photos/<id>" 形式だけ許可し、
// キーは URL 用にエンコードする(キー自体は設定画面で形式を検査済み)。
export function buildPhotoUrl(photo, apiKey, maxWidthPx = 240) {
  if (!photo?.name || !apiKey) return null;
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(photo.name)) return null;
  const width = Math.min(Math.max(Math.round(Number(maxWidthPx)) || 240, 1), 1600);
  return `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${width}&key=${encodeURIComponent(apiKey)}`;
}
