import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRouteResponse } from '../js/routes.js';
import { formatDuration } from '../js/format.js';

test('parseRouteResponse: 正常なレスポンスを整形する', () => {
  const r = parseRouteResponse({
    routes: [{ polyline: { encodedPolyline: 'abc' }, distanceMeters: 1200, duration: '900s' }],
  });
  assert.deepEqual(r, { encodedPolyline: 'abc', distanceMeters: 1200, durationSeconds: 900 });
});

test('parseRouteResponse: duration なしは null', () => {
  const r = parseRouteResponse({ routes: [{ polyline: { encodedPolyline: 'abc' } }] });
  assert.equal(r.durationSeconds, null);
});

test('parseRouteResponse: 経路なし・空・null はエラー', () => {
  assert.throws(() => parseRouteResponse({}), /経路が見つかりませんでした/);
  assert.throws(() => parseRouteResponse({ routes: [] }), /経路が見つかりませんでした/);
  assert.throws(() => parseRouteResponse(null), /経路が見つかりませんでした/);
  assert.throws(() => parseRouteResponse({ routes: [{ distanceMeters: 1 }] }), /経路が見つかりませんでした/);
});

test('formatDuration: 分・時間の表記と境界', () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(undefined), null);
  assert.equal(formatDuration(NaN), null);
  assert.equal(formatDuration(0), '0分');
  assert.equal(formatDuration(89), '1分');
  assert.equal(formatDuration(59 * 60), '59分');
  assert.equal(formatDuration(3600), '1時間0分');
  assert.equal(formatDuration(5400), '1時間30分');
});
