export const STORAGE_KEYS = {
  API_KEY: 'tourist-app.apiKey',
};

// Supabaseのプロジェクト固有情報。anon keyはRLSで保護されている前提の公開値のため
// リポジトリにコミットして問題ない。Supabaseプロジェクト作成後にここを実際の値へ置き換える。
export const SUPABASE_URL = 'https://qosrxcrbjlvrbuyybqhr.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc3J4Y3Jiamx2cmJ1eXlicWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjAxNjYsImV4cCI6MjA5NzYzNjE2Nn0.4RVVC_YN-KUYUcWmSl1S_zdIB4XdYuDxrMkFefwgqfQ';

export const PLACE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.editorialSummary',
  'places.reviews',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.photos',
  'places.types',
  'places.regularOpeningHours',
].join(',');

// favoriteCategory は tourist_app.place_category enum (tourist_attraction/restaurant/lodging/event/other) に対応。
// enumにない細かいジャンルは 'other' にまとめ、実際のジャンルは meta.genre に保存する。
export const GENRES = {
  sightseeing: { label: '観光', includedTypes: ['tourist_attraction'], favoriteCategory: 'tourist_attraction' },
  dining: { label: '食事', includedTypes: ['restaurant'], favoriteCategory: 'restaurant' },
  kids: {
    label: '子供向け',
    includedTypes: ['amusement_park', 'aquarium', 'zoo', 'playground'],
    favoriteCategory: 'other',
  },
  cafe: { label: 'お茶', includedTypes: ['cafe'], favoriteCategory: 'other' },
  work: { label: '仕事', includedTypes: ['coworking_space', 'library'], favoriteCategory: 'other' },
};

export const MIN_DESCRIPTION_LENGTH = 200;

export const LOW_ACCURACY_THRESHOLD_METERS = 10000;

export function getPreferredLanguageCode() {
  const lang = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0].toLowerCase();
  return lang || 'en';
}
