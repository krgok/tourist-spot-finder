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
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours',
].join(',');

// favoriteCategory は tourist_app.place_category enum (tourist_attraction/restaurant/lodging/event/other) に対応。
// enumにない細かいジャンルは 'other' にまとめ、実際のジャンルは meta.genre に保存する。
//
// includedPrimaryTypes はAPIへのリクエストパラメータ(各施設の「主たる種類」だけで絞り込む)。
// allowedTypes はレスポンス受信後にクライアント側で再照合する許可リスト(親タイプで持ち、
// place.types配列に含まれていれば合格とすることで子タイプの階層を吸収する)。
// excludedTypes は primaryType がこれに該当する場合に明確に除外する(例: ホテル内レストラン)。
export const GENRES = {
  sightseeing: {
    label: '観光',
    description: '観光名所・ランドマークなどの定番スポットを検索します。',
    includedPrimaryTypes: ['tourist_attraction'],
    allowedTypes: ['tourist_attraction'],
    excludedTypes: [],
    favoriteCategory: 'tourist_attraction',
  },
  dining: {
    label: '食事',
    description: 'レストラン・食堂など、しっかり食事ができる飲食店を検索します。',
    includedPrimaryTypes: ['restaurant'],
    allowedTypes: ['restaurant'],
    excludedTypes: ['lodging', 'hotel', 'gas_station', 'supermarket', 'convenience_store'],
    favoriteCategory: 'restaurant',
  },
  kids: {
    label: '子供向け',
    description: '遊園地・動物園・水族館・公園の遊び場など、子供と一緒に楽しめるスポットを検索します。',
    includedPrimaryTypes: ['amusement_park', 'aquarium', 'zoo', 'playground'],
    allowedTypes: ['amusement_park', 'aquarium', 'zoo', 'playground'],
    excludedTypes: [],
    favoriteCategory: 'other',
  },
  cafe: {
    label: 'お茶',
    description: '喫茶店・カフェ・軽食屋など、お茶や軽い食事ができる場所を検索します。',
    includedPrimaryTypes: ['cafe', 'coffee_shop', 'tea_house', 'sandwich_shop', 'bakery'],
    allowedTypes: ['cafe', 'coffee_shop', 'tea_house', 'sandwich_shop', 'bakery'],
    excludedTypes: ['lodging', 'hotel'],
    favoriteCategory: 'other',
  },
  work: {
    label: '仕事',
    description: 'コワーキングスペース・図書館・ビジネスセンターなど、作業や仕事に使える場所を検索します。',
    includedPrimaryTypes: ['coworking_space', 'library', 'business_center'],
    allowedTypes: ['coworking_space', 'library', 'business_center'],
    excludedTypes: [],
    minRatingCount: 1,
    favoriteCategory: 'other',
  },
};

// ベイズ推定平均によるスコアリング(単純なrating降順だと「評価4.9・レビュー2件」が
// 「評価4.6・レビュー1000件」より上位に来てしまう問題を緩和する)。
// score = (v/(v+m))*R + (m/(v+m))*C
export const RANKING = {
  priorWeight: 50, // m: 信頼に必要とみなすレビュー件数
  priorMean: 3.8, // C: 事前平均(Googleレビューは高評価寄りのため3.5〜4.0が妥当)
  defaultMinRatingCount: 5,
  defaultMinRating: 3.0,
};

export const MIN_DESCRIPTION_LENGTH = 150;

export const LOW_ACCURACY_THRESHOLD_METERS = 10000;

export function getPreferredLanguageCode() {
  const lang = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0].toLowerCase();
  return lang || 'en';
}
