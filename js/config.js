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
//
// includedPrimaryTypes は各施設の「主たる種類」だけで絞り込むため、
// 例えばホテル内のレストラン(primaryTypeはlodging)のような副次的な一致を排除できる。
// 親タイプ(例:'restaurant')を指定すると、'italian_restaurant'等の子タイプも自動的に含まれる。
export const GENRES = {
  sightseeing: {
    label: '観光',
    description: '観光名所・ランドマークなどの定番スポットを検索します。',
    includedPrimaryTypes: ['tourist_attraction'],
    favoriteCategory: 'tourist_attraction',
  },
  dining: {
    label: '食事',
    description: 'レストラン・食堂など、しっかり食事ができる飲食店を検索します。',
    includedPrimaryTypes: ['restaurant'],
    favoriteCategory: 'restaurant',
  },
  kids: {
    label: '子供向け',
    description: '遊園地・動物園・水族館・公園の遊び場など、子供と一緒に楽しめるスポットを検索します。',
    includedPrimaryTypes: ['amusement_park', 'aquarium', 'zoo', 'playground'],
    favoriteCategory: 'other',
  },
  cafe: {
    label: 'お茶',
    description: '喫茶店・カフェ・軽食屋など、お茶や軽い食事ができる場所を検索します。',
    includedPrimaryTypes: ['cafe', 'coffee_shop', 'tea_house', 'sandwich_shop', 'bakery'],
    favoriteCategory: 'other',
  },
  work: {
    label: '仕事',
    description: 'コワーキングスペース・図書館・ビジネスセンターなど、作業や仕事に使える場所を検索します。',
    includedPrimaryTypes: ['coworking_space', 'library', 'business_center'],
    favoriteCategory: 'other',
  },
};

export const MIN_DESCRIPTION_LENGTH = 200;

export const LOW_ACCURACY_THRESHOLD_METERS = 10000;

export function getPreferredLanguageCode() {
  const lang = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0].toLowerCase();
  return lang || 'en';
}
