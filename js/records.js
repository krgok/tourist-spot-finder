// Supabase に保存する行の組み立て(DOM・通信に依存しない純粋関数)。
// 上限値は supabase/migrations/20261105000000_harden_tourist_app.sql の check 制約と揃えてある。
// DB 側の制約に違反すると insert が失敗するため、送る前にここで切り詰める。
import { safeHttpUrl } from './safeUrl.js?v=20260708-4';

export const LIMITS = {
  placeId: 300,
  displayName: 300,
  address: 500,
  uri: 2000,
  historyResults: 20, // DB 側の上限は 50 件
  historyLabel: 200,
};

const cut = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);

// 場所の控え(jsonb)。レビュー(投稿者名・プロフィール画像URLなど第三者の個人情報を含む)、写真、
// Wikipedia 本文などは保存しない。アプリは snapshot を読み出さず、DB の肥大も防げる。
export function buildFavoriteSnapshot(place) {
  const snapshot = {
    id: cut(place.id, LIMITS.placeId),
    displayName: place.displayName?.text ? { text: cut(place.displayName.text, LIMITS.displayName) } : undefined,
    formattedAddress: cut(place.formattedAddress, LIMITS.address),
    location: place.location
      ? { latitude: place.location.latitude, longitude: place.location.longitude }
      : undefined,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    primaryType: cut(place.primaryType, 100),
    types: Array.isArray(place.types) ? place.types.slice(0, 20).map((t) => cut(t, 100)).filter(Boolean) : undefined,
    googleMapsUri: cut(safeHttpUrl(place.googleMapsUri) ?? undefined, LIMITS.uri),
    websiteUri: cut(safeHttpUrl(place.websiteUri) ?? undefined, LIMITS.uri),
  };
  return JSON.parse(JSON.stringify(snapshot)); // undefined のキーを落とす
}

export function buildFavoriteRow(place, category = 'tourist_attraction', meta = {}) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const inRange = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
  const rating = typeof place.rating === 'number' && place.rating >= 0 && place.rating <= 5 ? place.rating : null;
  return {
    place_id: cut(place.id, LIMITS.placeId),
    category,
    display_name: cut(place.displayName?.text, LIMITS.displayName) || '名称不明',
    address: cut(place.formattedAddress, LIMITS.address) || null,
    lat: inRange(lat, 90) ? lat : null,
    lng: inRange(lng, 180) ? lng : null,
    rating,
    google_maps_uri: cut(safeHttpUrl(place.googleMapsUri) ?? undefined, LIMITS.uri) || null,
    snapshot: buildFavoriteSnapshot(place),
    meta: { genre: cut(meta.genre, 50) },
  };
}

export function buildHistoryRow({ lat, lng, radiusMeters, maxCount, places, genre, locationLabel, region, language }) {
  const results = places.slice(0, LIMITS.historyResults).map((place) => ({
    place_id: cut(place.id, LIMITS.placeId),
    display_name: cut(place.displayName?.text, LIMITS.displayName) || '',
    rating: place.rating ?? null,
    location: place.location
      ? { latitude: place.location.latitude, longitude: place.location.longitude }
      : null,
  }));
  return {
    lat,
    lng,
    radius_meters: radiusMeters,
    max_count: maxCount,
    result_count: places.length,
    results,
    meta: {
      genre: cut(genre, 50),
      locationLabel: cut(locationLabel, LIMITS.historyLabel),
      region: cut(region, 10),
      language: cut(language, 10),
    },
  };
}
