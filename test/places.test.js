import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesGenre,
  isOperational,
  applyQualityFilter,
  bayesianScore,
  recommendedScore,
  distanceMeters,
  sortPlaces,
} from '../js/places.js';
import { GENRES, RANKING } from '../js/config.js';

const place = (over = {}) => ({
  id: 'p',
  displayName: { text: 'spot' },
  types: ['tourist_attraction'],
  primaryType: 'tourist_attraction',
  rating: 4.5,
  userRatingCount: 100,
  location: { latitude: 35.0, longitude: 139.0 },
  ...over,
});

test('matchesGenre: allowedTypes のどれかが types に含まれれば合格', () => {
  assert.equal(matchesGenre(place(), GENRES.sightseeing), true);
  assert.equal(matchesGenre(place({ types: ['park'] }), GENRES.sightseeing), false);
  assert.equal(matchesGenre(place({ types: undefined }), GENRES.sightseeing), false);
});

test('matchesGenre: excludedTypes は primaryType で判定(ホテル内レストランを除外)', () => {
  const hotelRestaurant = place({ types: ['restaurant', 'lodging'], primaryType: 'lodging' });
  assert.equal(matchesGenre(hotelRestaurant, GENRES.dining), false);
  const normal = place({ types: ['restaurant'], primaryType: 'restaurant' });
  assert.equal(matchesGenre(normal, GENRES.dining), true);
  // types に lodging があっても primaryType が restaurant なら除外しない(現在の仕様)
  const mixed = place({ types: ['restaurant', 'lodging'], primaryType: 'restaurant' });
  assert.equal(matchesGenre(mixed, GENRES.dining), true);
});

test('matchesGenre: 神社仏閣は place_of_worship も許可(リクエストでは指定できない型)', () => {
  assert.equal(matchesGenre(place({ types: ['place_of_worship'] }), GENRES.shrine_temple), true);
  assert.ok(!GENRES.shrine_temple.includedPrimaryTypes.includes('place_of_worship'));
});

test('isOperational: 未設定は営業中扱い、閉業・休業は除外', () => {
  assert.equal(isOperational(place({ businessStatus: undefined })), true);
  assert.equal(isOperational(place({ businessStatus: 'OPERATIONAL' })), true);
  assert.equal(isOperational(place({ businessStatus: 'CLOSED_PERMANENTLY' })), false);
  assert.equal(isOperational(place({ businessStatus: 'CLOSED_TEMPORARILY' })), false);
});

test('applyQualityFilter: 基準を満たす候補があれば relaxed=false', () => {
  const good = place({ id: 'good', rating: 4.0, userRatingCount: 10 });
  const few = place({ id: 'few', rating: 4.9, userRatingCount: 2 });
  const { filtered, relaxed } = applyQualityFilter([good, few], GENRES.sightseeing);
  assert.deepEqual(filtered.map((p) => p.id), ['good']);
  assert.equal(relaxed, false);
});

test('applyQualityFilter: 境界値(件数=最小、評価=最小)は合格', () => {
  const edge = place({ id: 'edge', rating: RANKING.defaultMinRating, userRatingCount: RANKING.defaultMinRatingCount });
  const { filtered, relaxed } = applyQualityFilter([edge], GENRES.sightseeing);
  assert.equal(filtered.length, 1);
  assert.equal(relaxed, false);
  const below = place({ id: 'below', rating: 2.9, userRatingCount: 100 });
  assert.equal(applyQualityFilter([below], GENRES.sightseeing).relaxed, true); // 緩和後の集合を採用
});

test('applyQualityFilter: strictが空ならレビュー1件以上に緩和し relaxed=true', () => {
  const one = place({ id: 'one', rating: 4.8, userRatingCount: 1 });
  const none = place({ id: 'none', rating: undefined, userRatingCount: 0 });
  const { filtered, relaxed } = applyQualityFilter([one, none], GENRES.sightseeing);
  assert.deepEqual(filtered.map((p) => p.id), ['one']);
  assert.equal(relaxed, true);
});

test('applyQualityFilter: レビューが無い場所しか無ければそのまま返す。空なら relaxed=false', () => {
  const none = place({ id: 'none', rating: undefined, userRatingCount: undefined });
  assert.deepEqual(applyQualityFilter([none], GENRES.sightseeing), { filtered: [none], relaxed: true });
  assert.deepEqual(applyQualityFilter([], GENRES.sightseeing), { filtered: [], relaxed: false });
});

test('applyQualityFilter: work ジャンルは minRatingCount=1 を使う', () => {
  const one = place({ rating: 4.0, userRatingCount: 1 });
  assert.equal(applyQualityFilter([one], GENRES.work).relaxed, false);
  assert.equal(applyQualityFilter([one], GENRES.sightseeing).relaxed, true);
});

test('bayesianScore: 少数レビューの高評価より、多数レビューの高評価が上', () => {
  const few = place({ rating: 4.9, userRatingCount: 2 });
  const many = place({ rating: 4.6, userRatingCount: 1000 });
  assert.ok(bayesianScore(many) > bayesianScore(few));
});

test('bayesianScore: 評価・件数なしは事前平均', () => {
  assert.equal(bayesianScore({}), RANKING.priorMean);
});

test('distanceMeters: 東京駅〜大阪駅は約400km', () => {
  const d = distanceMeters({ lat: 35.6812, lng: 139.7671 }, { lat: 34.7025, lng: 135.4959 });
  assert.ok(d > 390_000 && d < 410_000, String(d));
});

test('distanceMeters: 同一点は0、欠損はInfinity', () => {
  assert.equal(distanceMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
  assert.equal(distanceMeters(null, { lat: 1, lng: 1 }), Infinity);
  assert.equal(distanceMeters({ lat: 1, lng: 1 }, undefined), Infinity);
});

test('distanceMeters: 日付変更線をまたいでも短い方(約22km)で測る', () => {
  const d = distanceMeters({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
  assert.ok(d > 20_000 && d < 24_000, String(d));
});

test('recommendedScore: 半径いっぱいの距離で約12%減衰、起点なし/半径なしは減衰なし', () => {
  const origin = { lat: 35.0, lng: 139.0 };
  const atCenter = place({ location: { latitude: 35.0, longitude: 139.0 } });
  assert.equal(recommendedScore(atCenter, origin, 2000), bayesianScore(atCenter));
  // 緯度で約2000m北
  const atEdge = place({ location: { latitude: 35.0 + 2000 / 111195, longitude: 139.0 } });
  const ratio = recommendedScore(atEdge, origin, 2000) / bayesianScore(atEdge);
  assert.ok(Math.abs(ratio - (1 - RANKING.distanceDecayAlpha)) < 0.002, String(ratio));
  assert.equal(recommendedScore(atEdge, null, 2000), bayesianScore(atEdge));
  assert.equal(recommendedScore(atEdge, origin, 0), bayesianScore(atEdge));
});

test('recommendedScore: location なしでも NaN にならない', () => {
  const s = recommendedScore(place({ location: undefined }), { lat: 35, lng: 139 }, 2000);
  assert.ok(Number.isFinite(s));
});

test('sortPlaces: distance は近い順、location なしは最後。元配列は変更しない', () => {
  const origin = { lat: 35.0, lng: 139.0 };
  const far = place({ id: 'far', location: { latitude: 35.02, longitude: 139.0 } });
  const near = place({ id: 'near', location: { latitude: 35.001, longitude: 139.0 } });
  const none = place({ id: 'none', location: undefined });
  const input = [none, far, near];
  const out = sortPlaces(input, 'distance', origin, 2000);
  assert.deepEqual(out.map((p) => p.id), ['near', 'far', 'none']);
  assert.deepEqual(input.map((p) => p.id), ['none', 'far', 'near']);
});

test('sortPlaces: rating は評価なしが最後、reviewCount は件数降順', () => {
  const a = place({ id: 'a', rating: 4.0, userRatingCount: 5 });
  const b = place({ id: 'b', rating: 4.8, userRatingCount: 50 });
  const c = place({ id: 'c', rating: undefined, userRatingCount: undefined });
  assert.deepEqual(sortPlaces([c, a, b], 'rating').map((p) => p.id), ['b', 'a', 'c']);
  assert.deepEqual(sortPlaces([c, a, b], 'reviewCount').map((p) => p.id), ['b', 'a', 'c']);
});

test('sortPlaces: 未知のキーは recommended 扱い', () => {
  const few = place({ id: 'few', rating: 4.9, userRatingCount: 2 });
  const many = place({ id: 'many', rating: 4.6, userRatingCount: 1000 });
  assert.deepEqual(sortPlaces([few, many], 'bogus', null, 0).map((p) => p.id), ['many', 'few']);
});
