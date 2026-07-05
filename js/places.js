import { PLACE_FIELD_MASK, GENRES, getPreferredLanguageCode } from './config.js';

export async function searchNearbyTouristSpots({ apiKey, lat, lng, radiusMeters, maxCount, genre }) {
  const includedTypes = GENRES[genre]?.includedTypes || GENRES.sightseeing.includedTypes;

  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACE_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: maxCount,
      rankPreference: 'POPULARITY',
      languageCode: getPreferredLanguageCode(),
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

export function buildPhotoUrl(photo, apiKey, maxWidthPx = 240) {
  if (!photo?.name) return null;
  return `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}`;
}
