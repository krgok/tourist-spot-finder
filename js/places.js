import { PLACE_FIELD_MASK, GENRES, RANKING } from './config.js';

// アプリのUIは日本語固定のため、Places APIへのリクエストも常に日本語で行う。
// languageCodeをブラウザ言語に連動させていた頃は、editorialSummaryやレビューが
// 英語のまま返ってきて説明文に混ざる問題があった。
const REQUEST_LANGUAGE_CODE = 'ja';

// Nearby Searchの最大取得件数(20)を常に要求し、クライアント側のジャンル再照合・
// 品質フィルタで間引いてから表示件数(maxCount)に切り出す。APIはリクエスト単位課金なので
// 20件取得しても追加コストはない。
const FETCH_POOL_SIZE = 20;

function matchesGenre(place, genreConfig) {
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

export function bayesianScore(place) {
  const v = place.userRatingCount || 0;
  const R = place.rating ?? RANKING.priorMean;
  const m = RANKING.priorWeight;
  const C = RANKING.priorMean;
  return (v / (v + m)) * R + (m / (v + m)) * C;
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

export function sortPlaces(places, sortKey, origin) {
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
      return sorted.sort((a, b) => bayesianScore(b) - bayesianScore(a));
  }
}

function toLatLng(location) {
  return location ? { lat: location.latitude, lng: location.longitude } : null;
}

function applyQualityFilter(places, genreConfig) {
  const minRatingCount = genreConfig.minRatingCount ?? RANKING.defaultMinRatingCount;
  const minRating = RANKING.defaultMinRating;

  const strict = places.filter(
    (p) => (p.userRatingCount || 0) >= minRatingCount && (p.rating ?? 0) >= minRating
  );
  const relaxed = places.filter((p) => (p.userRatingCount || 0) >= 1);

  if (strict.length >= places.length) return { filtered: strict, relaxed: false };
  return { filtered: strict.length ? strict : relaxed, relaxed: strict.length < places.length };
}

export async function searchNearbyTouristSpots({ apiKey, lat, lng, radiusMeters, maxCount, genre }) {
  const genreConfig = GENRES[genre] || GENRES.sightseeing;

  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACE_FIELD_MASK,
    },
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body?.error?.message || `検索に失敗しました (HTTP ${response.status})`;
    if (response.status === 403) {
      throw new Error('APIキーが無効か、Places API (New) が有効化されていません: ' + message);
    }
    if (response.status === 429) {
      throw new Error('APIの利用上限に達しました: ' + message);
    }
    throw new Error(message);
  }

  const data = await response.json();
  const rawPlaces = data.places || [];

  const genreMatched = rawPlaces.filter((p) => matchesGenre(p, genreConfig));
  const { filtered, relaxed } = applyQualityFilter(genreMatched, genreConfig);

  const ranked = filtered
    .slice()
    .sort((a, b) => bayesianScore(b) - bayesianScore(a))
    .slice(0, maxCount);

  return { places: ranked, relaxed, poolSize: rawPlaces.length, matchedSize: genreMatched.length };
}

export async function geocodeLocation({ apiKey, query }) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.location,places.formattedAddress,places.displayName',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: REQUEST_LANGUAGE_CODE,
      maxResultCount: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body?.error?.message || `場所の検索に失敗しました (HTTP ${response.status})`;
    if (response.status === 403) {
      throw new Error('APIキーが無効か、Places API (New) が有効化されていません: ' + message);
    }
    throw new Error(message);
  }

  const data = await response.json();
  const place = data.places?.[0];
  if (!place?.location) {
    throw new Error(`「${query}」に一致する場所が見つかりませんでした。`);
  }

  return {
    lat: place.location.latitude,
    lng: place.location.longitude,
    formattedAddress: place.formattedAddress,
    displayName: place.displayName?.text,
  };
}

export function buildPhotoUrl(photo, apiKey, maxWidthPx = 240) {
  if (!photo?.name) return null;
  return `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}`;
}
