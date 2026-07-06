import { PLACE_FIELD_MASK, GENRES } from './config.js';

// アプリのUIは日本語固定のため、Places APIへのリクエストも常に日本語で行う。
// languageCodeをブラウザ言語に連動させていた頃は、editorialSummaryやレビューが
// 英語のまま返ってきて説明文に混ざる問題があった。
const REQUEST_LANGUAGE_CODE = 'ja';

export async function searchNearbyTouristSpots({ apiKey, lat, lng, radiusMeters, maxCount, genre }) {
  const includedPrimaryTypes = GENRES[genre]?.includedPrimaryTypes || GENRES.sightseeing.includedPrimaryTypes;

  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACE_FIELD_MASK,
    },
    body: JSON.stringify({
      includedPrimaryTypes,
      maxResultCount: maxCount,
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
  const places = data.places || [];

  // Nearby Search はrankPreferenceに'RATING'を持たないため、評価の高い順にクライアント側で並び替える。
  return places.slice().sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
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
