import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest, createRateLimiter, buildUpstream, PLACE_FIELD_MASK as SERVER_MASK } from '../supabase/functions/places-proxy/handler.js';
import { PLACE_FIELD_MASK as CLIENT_MASK, API_PROXY_URL, SUPABASE_URL, GENRES } from '../js/config.js';
import { postProxy, describeProxyError } from '../js/http.js';
import { searchNearbyTouristSpots, geocodeLocation, fetchPhotoUrl } from '../js/places.js';
import { fetchRoute } from '../js/routes.js';

const SERVER_KEY = ['AI', 'zaSERVERKEY_0123456789_abcdefghijklmnop'].join('');
const ORIGIN = 'https://family.example.github.io';
const ENV = { GOOGLE_MAPS_SERVER_KEY: SERVER_KEY, ALLOWED_ORIGIN: ORIGIN };
const USER = { id: '00000000-0000-0000-0000-00000000000a' };
const getUser = async (jwt) => (jwt === 'good' ? USER : null);

function req(body, { method = 'POST', origin = ORIGIN, auth = 'Bearer good' } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (auth) headers.authorization = auth;
  return new Request('https://x.supabase.co/functions/v1/places-proxy', { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
}
function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  fn.calls = calls;
  return fn;
}
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const fail = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) });
const NEARBY = { op: 'searchNearby', lat: 13.75, lng: 100.5, radiusMeters: 2000, genreTypes: ['market'], language: 'en', region: 'TH' };
const call = (body, opts, deps = {}) => handleRequest(req(body, opts), { env: ENV, getUser, rateLimiter: createRateLimiter({ limit: 1000 }), ...deps });

test('フィールドマスクは、クライアントとサーバーで一致している(ずれ防止)', () => {
  assert.equal(SERVER_MASK, CLIENT_MASK);
});

test('認証: トークンなし・不正なトークン・anon 相当(user を持たない)は 401。Google は呼ばれない', async () => {
  const f = fakeFetch(() => ok({}));
  assert.equal((await call(NEARBY, { auth: null }, { fetchImpl: f })).status, 401);
  assert.equal((await call(NEARBY, { auth: 'Bearer bad' }, { fetchImpl: f })).status, 401);
  assert.equal((await call(NEARBY, { auth: 'Basic abc' }, { fetchImpl: f })).status, 401);
  assert.equal((await call(NEARBY, {}, { fetchImpl: f, getUser: async () => { throw new Error('boom'); } })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('配信元: 許可していない origin・origin なしは 403。OPTIONS は許可した origin にだけ CORS を返す', async () => {
  const f = fakeFetch(() => ok({}));
  assert.equal((await call(NEARBY, { origin: 'https://evil.example' }, { fetchImpl: f })).status, 403);
  assert.equal((await call(NEARBY, { origin: null }, { fetchImpl: f })).status, 403);
  const pre = await call('', { method: 'OPTIONS' }, { fetchImpl: f });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const blocked = await call('', { method: 'OPTIONS', origin: 'https://evil.example' }, { fetchImpl: f });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('', { method: 'GET' }, { fetchImpl: f })).status, 405);
  assert.equal(f.calls.length, 0);
});

test('ALLOWED_ORIGIN が未設定なら、すべて拒否(500)', async () => {
  const res = await handleRequest(req(NEARBY), { env: { GOOGLE_MAPS_SERVER_KEY: SERVER_KEY }, getUser });
  assert.equal(res.status, 500);
});

test('ALLOWED_USER_IDS を設定すると、許可した利用者(家族)以外は 403', async () => {
  const f = fakeFetch(() => ok({ places: [] }));
  const env = { ...ENV, ALLOWED_USER_IDS: 'aaaaaaaa-0000-0000-0000-000000000001, 00000000-0000-0000-0000-00000000000a' };
  assert.equal((await call(NEARBY, {}, { env, fetchImpl: f })).status, 200);
  const other = await call(NEARBY, {}, { env: { ...ENV, ALLOWED_USER_IDS: 'aaaaaaaa-0000-0000-0000-000000000001' }, fetchImpl: f });
  assert.equal(other.status, 403);
  assert.equal(f.calls.length, 1);
});

test('レート制限: 1 人あたりの上限を超えると 429(他の利用者には影響しない)', async () => {
  const f = fakeFetch(() => ok({ places: [] }));
  let t = 0;
  const rateLimiter = createRateLimiter({ limit: 2, windowMs: 60000, now: () => t });
  const run = (u) => handleRequest(req(NEARBY), { env: ENV, getUser: async () => ({ id: u }), fetchImpl: f, rateLimiter });
  assert.equal((await run('u1')).status, 200);
  assert.equal((await run('u1')).status, 200);
  assert.equal((await run('u1')).status, 429);
  assert.equal((await run('u2')).status, 200);
  t = 61000; // 窓が過ぎれば再び使える
  assert.equal((await run('u1')).status, 200);
});

test('searchNearby: フィールド・件数はサーバー側で固定。キーはヘッダーにだけ入り、URL・応答には出ない', async () => {
  const f = fakeFetch(() => ok({ places: [{ id: 'p' }] }));
  const res = await call({ ...NEARBY, fieldMask: 'places.reviews', maxResultCount: 9999, rankPreference: 'DISTANCE' }, {}, { fetchImpl: f });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { places: [{ id: 'p' }] });
  assert.ok(!text.includes(SERVER_KEY), '応答にキーを含めない');
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://places.googleapis.com/v1/places:searchNearby');
  assert.ok(!url.includes(SERVER_KEY));
  assert.equal(init.headers['X-Goog-Api-Key'], SERVER_KEY);
  assert.equal(init.headers['X-Goog-FieldMask'], SERVER_MASK); // クライアントの指定は無視
  const body = JSON.parse(init.body);
  assert.equal(body.maxResultCount, 20);
  assert.equal(body.rankPreference, 'POPULARITY');
  assert.equal(body.languageCode, 'en');
  assert.equal(body.regionCode, 'TH');
  assert.deepEqual(body.includedPrimaryTypes, ['market']);
  assert.equal(body.locationRestriction.circle.radius, 2000);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('入力の検証: 半径・座標・ジャンル・言語・移動手段・検索語・写真名(不正は 400、Google は呼ばれない)', async () => {
  const f = fakeFetch(() => ok({}));
  const bad = [
    { ...NEARBY, radiusMeters: 10001 }, { ...NEARBY, radiusMeters: 50 }, { ...NEARBY, radiusMeters: 'x' },
    { ...NEARBY, lat: 91 }, { ...NEARBY, lng: NaN }, { ...NEARBY, genreTypes: [] }, { ...NEARBY, genreTypes: 'market' },
    { ...NEARBY, genreTypes: ['Bad Type'] }, { ...NEARBY, genreTypes: ['a_b', '../x'] }, { ...NEARBY, genreTypes: Array(7).fill('market') },
    { op: 'searchText', query: '' }, { op: 'searchText', query: 'x'.repeat(201) }, { op: 'searchText' },
    { op: 'computeRoutes', origin: { lat: 1, lng: 1 }, destination: { lat: 1, lng: 1 }, travelMode: 'FLY' },
    { op: 'computeRoutes', origin: { lat: 99, lng: 1 }, destination: { lat: 1, lng: 1 }, travelMode: 'WALK' },
    { op: 'photo', name: 'https://evil.example/x' }, { op: 'photo', name: 'places/a/photos/../../x' },
    { op: 'deleteEverything' }, { op: undefined }, [], 'null',
  ];
  for (const b of bad) {
    const res = await call(typeof b === 'string' ? b : b, {}, { fetchImpl: f });
    assert.equal(res.status, 400, JSON.stringify(b));
  }
  assert.equal(f.calls.length, 0);
  // 不明な言語・地域は既定(ja / regionCode なし)に丸める
  const f2 = fakeFetch(() => ok({ places: [] }));
  await call({ ...NEARBY, language: 'xx', region: 'US' }, {}, { fetchImpl: f2 });
  const body = JSON.parse(f2.calls[0].init.body);
  assert.equal(body.languageCode, 'ja');
  assert.equal('regionCode' in body, false);
});

test('本文: 壊れた JSON は 400、大きすぎる本文は 413', async () => {
  const f = fakeFetch(() => ok({}));
  assert.equal((await call('{not json', {}, { fetchImpl: f })).status, 400);
  assert.equal((await call({ ...NEARBY, pad: 'x'.repeat(9000) }, {}, { fetchImpl: f })).status, 413);
  assert.equal(f.calls.length, 0);
});

test('searchText / computeRoutes: 固定のフィールドマスクで Google を呼ぶ', async () => {
  const f = fakeFetch(() => ok({ routes: [] }));
  await call({ op: 'searchText', query: 'Siam', language: 'th' }, {}, { fetchImpl: f });
  assert.equal(f.calls[0].url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(f.calls[0].init.headers['X-Goog-FieldMask'], 'places.location,places.formattedAddress,places.displayName');
  assert.equal(JSON.parse(f.calls[0].init.body).languageCode, 'th');
  await call({ op: 'computeRoutes', origin: { lat: 13.7, lng: 100.5 }, destination: { lat: 13.8, lng: 100.6 }, travelMode: 'TRANSIT' }, {}, { fetchImpl: f });
  assert.equal(f.calls[1].url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(f.calls[1].init.headers['X-Goog-FieldMask'], 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration');
  assert.equal(JSON.parse(f.calls[1].init.body).travelMode, 'TRANSIT');
});

test('photo: キーを URL に入れず(skipHttpRedirect)、Google の画像配信ホストの https URL だけを返す', async () => {
  const f = fakeFetch(() => ok({ photoUri: 'https://lh3.googleusercontent.com/abc=w240' }));
  const res = await call({ op: 'photo', name: 'places/ChIJabc/photos/AUy_1', maxWidthPx: 99999 }, {}, { fetchImpl: f });
  assert.deepEqual(await res.json(), { photoUri: 'https://lh3.googleusercontent.com/abc=w240' });
  assert.ok(f.calls[0].url.includes('skipHttpRedirect=true') && f.calls[0].url.includes('maxWidthPx=800'));
  assert.ok(!f.calls[0].url.includes(SERVER_KEY));
  assert.equal(f.calls[0].init.method, 'GET');
  for (const evil of ['http://lh3.googleusercontent.com/x', 'https://evil.example/x', 'javascript:alert(1)', 'https://googleusercontent.com.evil.example/x', undefined]) {
    const r = await call({ op: 'photo', name: 'places/ChIJabc/photos/AUy_1' }, {}, { fetchImpl: fakeFetch(() => ok({ photoUri: evil })) });
    assert.equal(r.status, 502, String(evil));
  }
});

test('Google のエラーの扱い: 400・429 は利用者に分かる形、401/403 は「サーバー側の設定」、キーは伏せる', async () => {
  const run = (st, msg) => call(NEARBY, {}, { fetchImpl: fakeFetch(() => fail(st, msg)) });
  const r400 = await run(400, `Unsupported types: hindu_temple. key=${SERVER_KEY}`);
  assert.equal(r400.status, 400);
  const t400 = JSON.stringify(await r400.json());
  assert.ok(t400.includes('Unsupported types') && !t400.includes(SERVER_KEY) && t400.includes('***'));
  assert.equal((await run(429, 'quota')).status, 429);
  for (const st of [401, 403]) {
    const r = await run(st, `denied ${SERVER_KEY}`);
    assert.equal(r.status, 502); // 利用者のログインの問題ではない
    assert.ok(!JSON.stringify(await r.json()).includes(SERVER_KEY));
  }
  assert.equal((await run(500, 'x')).status, 502);
  assert.equal((await call(NEARBY, {}, { fetchImpl: async () => { throw new TypeError('network'); } })).status, 504);
});

test('サーバーのキーが未設定なら 500。キーは応答に含まれない', async () => {
  const res = await handleRequest(req(NEARBY), { env: { ALLOWED_ORIGIN: ORIGIN }, getUser, rateLimiter: createRateLimiter({ limit: 9 }) });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error.message, /未完了/);
});

test('想定外の例外は 500 の定型文だけ(詳細・キーを返さない)', async () => {
  const res = await call(NEARBY, {}, { fetchImpl: async () => { throw Object.assign(new Error(`secret ${SERVER_KEY}`), { name: 'Weird' }); } });
  const text = JSON.stringify(await res.json());
  assert.ok(!text.includes(SERVER_KEY));
});

test('buildUpstream: 未知の操作は拒否', () => {
  assert.throws(() => buildUpstream('nope', {}), /未対応/);
});

// ---------------- クライアント側 ----------------
const proxy = { url: 'https://x.supabase.co/functions/v1/places-proxy', getToken: async () => 'jwt-abc' };

test('postProxy: Authorization に JWT、本文に操作。API キーは含めない', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return ok({ places: [] }); };
  await postProxy({ ...proxy, payload: { op: 'searchNearby' }, fetchImpl });
  assert.equal(seen.url, proxy.url);
  assert.equal(seen.init.headers.Authorization, 'Bearer jwt-abc');
  assert.ok(!('X-Goog-Api-Key' in seen.init.headers));
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('postProxy: 未ログイン(トークンなし)は通信せずエラー。HTTP エラーは分かりやすい文言', async () => {
  let called = false;
  await assert.rejects(postProxy({ url: proxy.url, getToken: async () => null, payload: {}, fetchImpl: async () => { called = true; } }), /ログインが必要/);
  assert.equal(called, false);
  const reject = (st, msg) => postProxy({ ...proxy, payload: {}, fetchImpl: async () => fail(st, msg) });
  await assert.rejects(reject(401, 'x'), /ログインし直して/);
  await assert.rejects(reject(403, 'x'), /許可されていません/);
  await assert.rejects(reject(429, 'x'), /利用上限/);
  await assert.rejects(reject(502, 'サーバー側の Google API キーの設定'), /サーバー側/);
  await assert.rejects(postProxy({ ...proxy, payload: {}, fetchImpl: async () => { throw new TypeError('x'); } }), /通信に失敗/);
  assert.match(describeProxyError(418), /HTTP 418/);
});

test('クライアントの検索・ジオコーディング・経路・写真は、proxy 指定でキーを送らずサーバーへ', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.op === 'searchNearby') return ok({ places: [{ id: 'a', displayName: { text: 'x' }, types: ['tourist_attraction'], primaryType: 'tourist_attraction', rating: 4.5, userRatingCount: 50, location: { latitude: 1, longitude: 2 } }] });
    if (b.op === 'searchText') return ok({ places: [{ location: { latitude: 13.7, longitude: 100.5 }, formattedAddress: 'Bangkok' }] });
    if (b.op === 'computeRoutes') return ok({ routes: [{ polyline: { encodedPolyline: 'abc' }, distanceMeters: 5, duration: '60s' }] });
    return ok({ photoUri: 'https://lh3.googleusercontent.com/p' });
  };
  const r = await searchNearbyTouristSpots({ proxy, lat: 13.75, lng: 100.5, radiusMeters: 99999, maxCount: 5, genre: 'sightseeing', language: 'th', region: 'th', fetchImpl });
  assert.equal(r.places.length, 1);
  assert.deepEqual(bodies[0], { op: 'searchNearby', lat: 13.75, lng: 100.5, radiusMeters: 10000, genreTypes: GENRES.sightseeing.includedPrimaryTypes, language: 'th', region: 'TH' }); // 半径はクライアント側でも丸める
  const g = await geocodeLocation({ proxy, query: 'Siam', language: 'ja', fetchImpl });
  assert.equal(g.lat, 13.7);
  assert.deepEqual(bodies[1], { op: 'searchText', query: 'Siam', language: 'ja' });
  const route = await fetchRoute({ proxy, origin: { lat: 13.7, lng: 100.5 }, destination: { lat: 13.8, lng: 100.6 }, travelMode: 'WALK', fetchImpl });
  assert.equal(route.durationSeconds, 60);
  assert.deepEqual(bodies[2], { op: 'computeRoutes', origin: { lat: 13.7, lng: 100.5 }, destination: { lat: 13.8, lng: 100.6 }, travelMode: 'WALK' });
  assert.equal(await fetchPhotoUrl({ photo: { name: 'places/ChIJabc/photos/AUy_1' }, proxy, fetchImpl }), 'https://lh3.googleusercontent.com/p');
  for (const b of bodies) assert.ok(!JSON.stringify(b).toLowerCase().includes('apikey') && !JSON.stringify(b).includes('AIza'));
});

test('fetchPhotoUrl: 失敗・不正な URL・不正な写真名は null(写真なしで表示)', async () => {
  const photo = { name: 'places/ChIJabc/photos/AUy_1' };
  assert.equal(await fetchPhotoUrl({ photo, proxy, fetchImpl: async () => fail(502, 'x') }), null);
  assert.equal(await fetchPhotoUrl({ photo, proxy, fetchImpl: async () => ok({ photoUri: 'javascript:alert(1)' }) }), null);
  assert.equal(await fetchPhotoUrl({ photo, proxy, fetchImpl: async () => ok({ photoUri: 'http://lh3.googleusercontent.com/p' }) }), null);
  assert.equal(await fetchPhotoUrl({ photo: { name: '../x' }, proxy, fetchImpl: async () => ok({}) }), null);
  assert.equal(await fetchPhotoUrl({ photo, proxy: null, fetchImpl: async () => ok({}) }), null);
});

test('設定: API_PROXY_URL は既定で空(無効)。設定するなら https の Supabase と同じホスト(CSP の範囲内)', () => {
  assert.equal(API_PROXY_URL, '', '既定は無効(デプロイ後に利用者が設定する)');
  if (API_PROXY_URL) {
    const u = new URL(API_PROXY_URL);
    assert.equal(u.protocol, 'https:');
    assert.equal(u.origin, new URL(SUPABASE_URL).origin);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="proxy-note"[^>]*class="hint hidden"/);
});

test('handler.js にキーや秘密の値を書いていない(環境変数から読むだけ)', () => {
  const src = readFileSync(new URL('../supabase/functions/places-proxy/handler.js', import.meta.url), 'utf8');
  assert.match(src, /env\.GOOGLE_MAPS_SERVER_KEY/);
  assert.doesNotMatch(src, /AIza[0-9A-Za-z_-]{20,}/);
});
