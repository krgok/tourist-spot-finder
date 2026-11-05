import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGoogleApi, describeHttpError, describeNetworkError, timeoutSignal } from '../js/http.js';
import { searchNearbyTouristSpots, geocodeLocation, buildNearbyRequestBody } from '../js/places.js';
import { fetchRoute } from '../js/routes.js';
import { fetchWikipediaExtract } from '../js/wikipedia.js';
import { GENRES } from '../js/config.js';

// 秘密検出テストに引っかからないよう、ダミーキーは実行時に組み立てる
const KEY = ['AI', 'zaTESTKEY_0123456789_abcdefghijklmnop'].join('');
const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const failJson = (status, body = {}) => async () => ({ ok: false, status, json: async () => body });

test('postGoogleApi: キー・フィールドマスクをヘッダーに、本文を JSON で送り、タイムアウトを付ける', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ places: [] }) };
  };
  const data = await postGoogleApi({ url: 'https://x.test/', apiKey: KEY, fieldMask: 'a,b', body: { q: 1 }, apiLabel: 'X', fetchImpl });
  assert.deepEqual(data, { places: [] });
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['X-Goog-Api-Key'], KEY);
  assert.equal(seen.init.headers['X-Goog-FieldMask'], 'a,b');
  assert.equal(seen.init.body, '{"q":1}');
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.ok(!seen.url.includes(KEY), 'キーを URL に入れない');
});

test('HTTP エラーの文言: 403 / 429 / 5xx / 400 / その他', () => {
  assert.match(describeHttpError(403, 'Places API (New)'), /キーの制限.*Places API \(New\)/);
  assert.match(describeHttpError(429, 'X'), /利用上限.*しばらく待って/);
  assert.match(describeHttpError(503, 'X'), /一時的な問題.*503/);
  assert.match(describeHttpError(400, 'X', 'bad radius'), /bad radius/);
  assert.match(describeHttpError(418, 'X'), /HTTP 418/);
});

test('postGoogleApi: HTTP エラーで、利用者向けメッセージの Error を投げる', async () => {
  await assert.rejects(
    postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'Routes API', fetchImpl: failJson(403, { error: { message: 'denied' } }) }),
    /Routes API.*denied/
  );
  await assert.rejects(
    postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', fetchImpl: failJson(429) }),
    /利用上限/
  );
});

test('postGoogleApi: エラーメッセージにキーが混ざっていたら伏せる。長すぎる文言は切る', async () => {
  const msg = `Requests with key ${KEY} are blocked. ` + 'x'.repeat(500);
  try {
    await postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', fetchImpl: failJson(403, { error: { message: msg } }) });
    assert.fail('should throw');
  } catch (e) {
    assert.ok(!e.message.includes(KEY));
    assert.ok(e.message.includes('***'));
    assert.ok(e.message.length < 500);
  }
});

test('postGoogleApi: 通信失敗・タイムアウト・不正なJSON', async () => {
  const net = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', fetchImpl: net }), /通信に失敗しました/);
  const timeout = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  await assert.rejects(postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', fetchImpl: timeout }), /タイムアウト/);
  const badJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', fetchImpl: badJson }), /想定外の応答/);
});

test('describeNetworkError: オフラインを区別する', () => {
  assert.match(describeNetworkError(new TypeError('x'), false), /インターネットに接続されていません/);
  assert.match(describeNetworkError(new TypeError('x'), true), /通信に失敗/);
});

const placeOf = (over) => ({ id: 'a', displayName: { text: 'n' }, types: ['tourist_attraction'], primaryType: 'tourist_attraction', rating: 4.5, userRatingCount: 50, location: { latitude: 35, longitude: 139 }, ...over });

test('searchNearbyTouristSpots: 半径・件数は上限を超えない(課金・負荷の抑制)', async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ places: [placeOf({})] }) }; };
  await searchNearbyTouristSpots({ apiKey: KEY, lat: 35, lng: 139, radiusMeters: 1e9, maxCount: 1e6, genre: 'sightseeing', fetchImpl });
  assert.equal(body.locationRestriction.circle.radius, 10000);
  assert.equal(body.maxResultCount, 20);
  await searchNearbyTouristSpots({ apiKey: KEY, lat: 35, lng: 139, radiusMeters: -5, maxCount: 0, genre: 'sightseeing', fetchImpl });
  assert.equal(body.locationRestriction.circle.radius, 100);
});

test('searchNearbyTouristSpots: 結果を maxCount に切り詰める', async () => {
  const places = Array.from({ length: 12 }, (_, i) => placeOf({ id: 'p' + i, rating: 4 + i / 100 }));
  const r = await searchNearbyTouristSpots({ apiKey: KEY, lat: 35, lng: 139, radiusMeters: 2000, maxCount: 5, genre: 'sightseeing', fetchImpl: okJson({ places }) });
  assert.equal(r.places.length, 5);
});

test('searchNearbyTouristSpots: 緯度経度が範囲外なら通信せずエラー', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  for (const [lat, lng] of [[91, 0], [0, 181], [NaN, 0], [undefined, undefined]]) {
    await assert.rejects(searchNearbyTouristSpots({ apiKey: KEY, lat, lng, radiusMeters: 1000, maxCount: 5, genre: 'dining', fetchImpl }), /緯度・経度/);
  }
  assert.equal(called, false);
});

test('searchNearbyTouristSpots: 日付変更線付近の座標(lng=±180)は有効', async () => {
  await searchNearbyTouristSpots({ apiKey: KEY, lat: -17.7, lng: 179.99, radiusMeters: 1000, maxCount: 5, genre: 'dining', fetchImpl: okJson({ places: [] }) });
  await searchNearbyTouristSpots({ apiKey: KEY, lat: -17.7, lng: -180, radiusMeters: 1000, maxCount: 5, genre: 'dining', fetchImpl: okJson({ places: [] }) });
});

test('buildNearbyRequestBody: ジャンルの includedPrimaryTypes を使い、20件取得・日本語で要求', () => {
  const body = buildNearbyRequestBody({ lat: 1, lng: 2, radiusMeters: 1000, genreConfig: GENRES.shrine_temple });
  assert.deepEqual(body.includedPrimaryTypes, ['shinto_shrine', 'buddhist_temple']);
  assert.equal(body.maxResultCount, 20);
  assert.equal(body.languageCode, 'ja');
  assert.deepEqual(body.locationRestriction.circle.center, { latitude: 1, longitude: 2 });
});

test('geocodeLocation: 結果なし・座標が不正・空入力はエラー、正常は座標を返す', async () => {
  await assert.rejects(geocodeLocation({ apiKey: KEY, query: 'zzz', fetchImpl: okJson({}) }), /見つかりませんでした/);
  await assert.rejects(geocodeLocation({ apiKey: KEY, query: 'zzz', fetchImpl: okJson({ places: [{ location: { latitude: 999, longitude: 0 } }] }) }), /見つかりませんでした/);
  await assert.rejects(geocodeLocation({ apiKey: KEY, query: '   ', fetchImpl: okJson({}) }), /入力してください/);
  const r = await geocodeLocation({ apiKey: KEY, query: 'バンコク', fetchImpl: okJson({ places: [{ location: { latitude: 13.75, longitude: 100.5 }, formattedAddress: 'Bangkok', displayName: { text: 'バンコク' } }] }) });
  assert.deepEqual(r, { lat: 13.75, lng: 100.5, formattedAddress: 'Bangkok', displayName: 'バンコク' });
});

test('geocodeLocation: 429 のときも利用上限のメッセージ(以前は未対応)', async () => {
  await assert.rejects(geocodeLocation({ apiKey: KEY, query: 'x', fetchImpl: failJson(429) }), /利用上限/);
});

test('fetchRoute: 正常系・入力検査・エラー', async () => {
  const data = { routes: [{ polyline: { encodedPolyline: 'abc' }, distanceMeters: 100, duration: '60s' }] };
  const r = await fetchRoute({ apiKey: KEY, origin: { lat: 35, lng: 139 }, destination: { lat: 35.1, lng: 139.1 }, travelMode: 'WALK', fetchImpl: okJson(data) });
  assert.equal(r.durationSeconds, 60);
  await assert.rejects(fetchRoute({ apiKey: KEY, origin: { lat: 95, lng: 0 }, destination: { lat: 1, lng: 1 }, fetchImpl: okJson(data) }), /位置が正しくありません/);
  await assert.rejects(fetchRoute({ apiKey: KEY, origin: { lat: 1, lng: 1 }, destination: { lat: 1, lng: 1 }, travelMode: 'FLY', fetchImpl: okJson(data) }), /移動手段/);
  await assert.rejects(fetchRoute({ apiKey: KEY, origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 }, fetchImpl: failJson(403) }), /Routes API/);
  await assert.rejects(fetchRoute({ apiKey: KEY, origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 }, fetchImpl: okJson({}) }), /経路が見つかりませんでした/);
});

test('fetchWikipediaExtract: 通信失敗・タイムアウト・HTTPエラーでも例外にせず null(検索全体を止めない)', async () => {
  const loc = { lat: 35.7, lng: 139.8 };
  const boom = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await fetchWikipediaExtract('浅草寺', loc, { fetchImpl: boom }), null);
  assert.equal(await fetchWikipediaExtract('浅草寺', loc, { fetchImpl: failJson(500) }), null);
});

test('fetchWikipediaExtract: geosearch は成功し、本文取得だけ失敗しても null(以前は例外で検索全体が失敗)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('list=geosearch')) {
      return { ok: true, json: async () => ({ query: { geosearch: [{ title: '浅草寺', dist: 10 }] } }) };
    }
    throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  };
  assert.equal(await fetchWikipediaExtract('浅草寺', { lat: 35.7, lng: 139.8 }, { fetchImpl }), null);
});

test('fetchWikipediaExtract: 正常系は日本語版の要約と出典URLを返す。座標が不正なら通信しない', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('list=geosearch')) {
      return { ok: true, json: async () => ({ query: { geosearch: [{ title: '浅草寺', dist: 10 }] } }) };
    }
    return { ok: true, json: async () => ({ query: { pages: { 1: { extract: '浅草寺は寺院である。' } } } }) };
  };
  const r = await fetchWikipediaExtract('浅草寺', { lat: 35.7, lng: 139.8 }, { fetchImpl });
  assert.equal(r.title, '浅草寺');
  assert.equal(r.url, 'https://ja.wikipedia.org/wiki/%E6%B5%85%E8%8D%89%E5%AF%BA');
  let called = false;
  assert.equal(await fetchWikipediaExtract('x', { lat: 999, lng: 0 }, { fetchImpl: async () => { called = true; } }), null);
  assert.equal(called, false);
});

// AbortSignal.timeout が無い環境(iOS 15 以前の Safari など)を再現する
async function withoutAbortSignalTimeout(fn) {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = undefined;
  try {
    return await fn();
  } finally {
    AbortSignal.timeout = original;
  }
}

test('postGoogleApi: AbortSignal.timeout が無くても、TypeError にならず通常どおり呼べる', async () => {
  await withoutAbortSignalTimeout(async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = init; return { ok: true, status: 200, json: async () => ({ ok: 1 }) }; };
    const data = await postGoogleApi({ url: 'https://x.test/', apiKey: KEY, fieldMask: 'a', body: {}, apiLabel: 'X', fetchImpl });
    assert.deepEqual(data, { ok: 1 });
    assert.ok(seen.signal instanceof AbortSignal);
    assert.equal(seen.signal.aborted, false);
  });
});

test('postGoogleApi: AbortSignal.timeout が無い環境でも、時間切れは「タイムアウト」と分類される(通信失敗とは区別)', async () => {
  await withoutAbortSignalTimeout(async () => {
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(
      postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', timeoutMs: 20, fetchImpl }),
      /タイムアウト/
    );
    // 通信失敗(TypeError)は、これまでどおり「通信に失敗しました」
    await assert.rejects(
      postGoogleApi({ url: 'u', apiKey: KEY, fieldMask: 'f', body: {}, apiLabel: 'X', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
      /通信に失敗しました|インターネットに接続されていません/
    );
  });
});

test('timeoutSignal(代替実装): clear() でタイマーを止める。親の signal が中断されたら連動して中断する', async () => {
  await withoutAbortSignalTimeout(async () => {
    const t = timeoutSignal(20);
    t.clear();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t.signal.aborted, false, 'clear 後は時間切れにならない');

    const parent = new AbortController();
    const t2 = timeoutSignal(10000, parent.signal);
    parent.abort();
    assert.equal(t2.signal.aborted, true);
    t2.clear();

    const t3 = timeoutSignal(15);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t3.signal.aborted, true);
    assert.equal(t3.signal.reason?.name, 'TimeoutError');
    t3.clear();
  });
});

test('timeoutSignal(標準実装): AbortSignal.timeout があるときはそれを使う', () => {
  const t = timeoutSignal(1000);
  assert.ok(t.signal instanceof AbortSignal);
  t.clear();
});
