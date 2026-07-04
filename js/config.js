export const STORAGE_KEYS = {
  API_KEY: 'tourist-app.apiKey',
  CLIENT_ID: 'tourist-app.clientId',
};

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

export const MIN_DESCRIPTION_LENGTH = 200;

export const LOW_ACCURACY_THRESHOLD_METERS = 10000;

export function getPreferredLanguageCode() {
  const lang = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0].toLowerCase();
  return lang || 'en';
}
