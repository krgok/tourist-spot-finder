import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFavoriteRow, buildFavoriteSnapshot, buildHistoryRow, LIMITS } from '../js/records.js';

const fullPlace = () => ({
  id: 'ChIJ123',
  displayName: { text: '浅草寺', languageCode: 'ja' },
  formattedAddress: '東京都台東区浅草２丁目',
  location: { latitude: 35.7148, longitude: 139.7967 },
  rating: 4.5,
  userRatingCount: 1000,
  primaryType: 'buddhist_temple',
  types: ['buddhist_temple', 'place_of_worship'],
  googleMapsUri: 'https://maps.google.com/?cid=1',
  websiteUri: 'https://example.com/',
  reviews: [{ authorAttribution: { displayName: '第三者の名前', photoUri: 'https://lh3.googleusercontent.com/x' }, text: { text: 'a'.repeat(3000) } }],
  photos: [{ name: 'places/x/photos/y' }],
  _wikipedia: { extract: 'b'.repeat(5000), url: 'https://ja.wikipedia.org/wiki/x' },
});

test('buildFavoriteSnapshot: レビュー(第三者の個人情報)・写真・Wikipedia 本文を保存しない', () => {
  const snap = buildFavoriteSnapshot(fullPlace());
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('第三者の名前'));
  assert.ok(!('reviews' in snap) && !('photos' in snap) && !('_wikipedia' in snap));
  assert.equal(snap.displayName.text, '浅草寺');
  assert.deepEqual(snap.location, { latitude: 35.7148, longitude: 139.7967 });
  assert.ok(json.length < 2000);
});

test('buildFavoriteSnapshot: 危険な URL は保存しない。欠損があっても例外にならない', () => {
  const snap = buildFavoriteSnapshot({ id: 'x', googleMapsUri: 'javascript:alert(1)', websiteUri: 'data:text/html,x' });
  assert.ok(!('googleMapsUri' in snap) && !('websiteUri' in snap));
  assert.deepEqual(buildFavoriteSnapshot({}), {});
});

test('buildFavoriteRow: DB の制約(長さ・範囲・URL)を満たす行になる', () => {
  const place = fullPlace();
  place.displayName.text = 'あ'.repeat(1000);
  place.formattedAddress = 'い'.repeat(1000);
  place.id = 'x'.repeat(1000);
  const row = buildFavoriteRow(place, 'tourist_attraction', { genre: 'sightseeing' });
  assert.ok(row.place_id.length <= 300 && row.place_id.length >= 1);
  assert.ok(row.display_name.length <= 300 && row.display_name.length >= 1);
  assert.ok(row.address.length <= 500);
  assert.match(row.google_maps_uri, /^https?:\/\//);
  assert.ok(Math.abs(row.lat) <= 90 && Math.abs(row.lng) <= 180);
  assert.ok(row.rating >= 0 && row.rating <= 5);
  assert.ok(JSON.stringify(row.snapshot).length <= 200000);
  assert.ok(JSON.stringify(row.meta).length <= 4000);
  assert.deepEqual(row.meta, { genre: 'sightseeing' });
});

test('buildFavoriteRow: 表示名が空でも DB 制約(1文字以上)に違反しない', () => {
  assert.equal(buildFavoriteRow({ id: 'p' }).display_name, '名称不明');
  assert.equal(buildFavoriteRow({ id: 'p', displayName: { text: '' } }).display_name, '名称不明');
});

test('buildFavoriteRow: 範囲外の座標・評価・危険な URL は null にする', () => {
  const row = buildFavoriteRow({
    id: 'p',
    location: { latitude: 123, longitude: 999 },
    rating: 7,
    googleMapsUri: 'javascript:alert(1)',
  });
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  assert.equal(row.rating, null);
  assert.equal(row.google_maps_uri, null);
});

test('buildHistoryRow: 結果は最大20件に切り詰め、メタは小さく保つ', () => {
  const places = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, displayName: { text: 'n' + i }, rating: 4, location: { latitude: 1, longitude: 2 } }));
  const row = buildHistoryRow({ lat: 35, lng: 139, radiusMeters: 2000, maxCount: 10, places, genre: 'dining', locationLabel: 'あ'.repeat(1000) });
  assert.equal(row.results.length, LIMITS.historyResults);
  assert.equal(row.result_count, 30);
  assert.equal(row.meta.locationLabel.length, LIMITS.historyLabel);
  assert.ok(JSON.stringify(row.results).length <= 50000);
  assert.ok(JSON.stringify(row.meta).length <= 4000);
  assert.equal(row.radius_meters, 2000);
});

test('buildHistoryRow: 従来と同じ形(place_id / display_name / rating / location)で保存する', () => {
  const row = buildHistoryRow({ lat: 1, lng: 2, radiusMeters: 1000, maxCount: 5, places: [fullPlace()], genre: 'sightseeing', locationLabel: '現在地' });
  assert.deepEqual(Object.keys(row.results[0]), ['place_id', 'display_name', 'rating', 'location']);
  assert.deepEqual(row.meta, { genre: 'sightseeing', locationLabel: '現在地' });
});
