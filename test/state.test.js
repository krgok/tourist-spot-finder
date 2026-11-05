import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthTracker } from '../js/authState.js';
import { getCurrentPosition, geolocationErrorMessage } from '../js/geolocation.js';
import { storageGet, storageSet, storageRemove } from '../js/storage.js';
import { clampSearchParams, normalizeForUi, snapToOption, isOneOf, SEARCH_LIMITS } from '../js/params.js';
import { getPreferredLanguageCode } from '../js/config.js';

test('authTracker: 起動時の getSession と INITIAL_SESSION が重なっても onLogin は1回', () => {
  const calls = [];
  const t = createAuthTracker({ onLogin: (u) => calls.push('in:' + u.id), onLogout: () => calls.push('out') });
  assert.equal(t.apply({ id: 'u1' }), 'login');
  assert.equal(t.apply({ id: 'u1' }), 'same'); // INITIAL_SESSION / TOKEN_REFRESHED
  assert.equal(t.apply({ id: 'u1' }), 'same');
  assert.deepEqual(calls, ['in:u1']);
});

test('authTracker: ログアウト・別ユーザーへの切替・未ログインの繰り返し', () => {
  const calls = [];
  const t = createAuthTracker({ onLogin: (u) => calls.push('in:' + u.id), onLogout: () => calls.push('out') });
  assert.equal(t.apply(null), 'none'); // 起動時に未ログイン: ログアウト扱いにしない
  t.apply({ id: 'a' });
  assert.equal(t.apply(null), 'logout'); // セッション失効もここ
  assert.equal(t.apply(null), 'none');
  t.apply({ id: 'b' });
  t.apply({ id: 'c' }); // 別ユーザーに切替
  assert.deepEqual(calls, ['in:a', 'out', 'in:b', 'in:c']);
});

const fakeGeo = (results) => ({
  calls: [],
  getCurrentPosition(ok, ng, options) {
    this.calls.push(options);
    const r = results.shift();
    if (r.error) ng({ code: r.error });
    else ok({ coords: { latitude: r.lat, longitude: r.lng, accuracy: r.acc } });
  },
});

test('geolocation: 成功', async () => {
  const geo = fakeGeo([{ lat: 13.7, lng: 100.5, acc: 20 }]);
  assert.deepEqual(await getCurrentPosition({ geo }), { lat: 13.7, lng: 100.5, accuracy: 20 });
  assert.equal(geo.calls[0].enableHighAccuracy, true);
});

test('geolocation: 高精度がタイムアウト/取得不可なら、低精度で1回やり直す', async () => {
  for (const code of [2, 3]) {
    const geo = fakeGeo([{ error: code }, { lat: 1, lng: 2, acc: 3000 }]);
    const pos = await getCurrentPosition({ geo });
    assert.equal(pos.accuracy, 3000);
    assert.equal(geo.calls.length, 2);
    assert.equal(geo.calls[1].enableHighAccuracy, false);
  }
});

test('geolocation: 拒否(code 1)はやり直さず、許可の案内と「場所を指定」を案内する', async () => {
  const geo = fakeGeo([{ error: 1 }]);
  await assert.rejects(getCurrentPosition({ geo }), /許可.*場所を指定/);
  assert.equal(geo.calls.length, 1);
});

test('geolocation: やり直しも失敗したらエラー。非対応ブラウザ・未知のコードも扱う', async () => {
  await assert.rejects(getCurrentPosition({ geo: fakeGeo([{ error: 3 }, { error: 3 }]) }), /タイムアウト/);
  await assert.rejects(getCurrentPosition({ geo: null }), /対応していません/);
  assert.equal(geolocationErrorMessage(99), '現在地の取得に失敗しました。');
});

test('storage: localStorage が例外を投げる環境でもメモリで代替し、例外にしない', () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  try {
    assert.equal(storageGet('k'), null);
    assert.equal(storageSet('k', 'v'), false); // 永続化はできない
    assert.equal(storageGet('k'), 'v'); // このセッション中は保持
    storageRemove('k');
    assert.equal(storageGet('k'), null);
  } finally {
    if (orig) Object.defineProperty(globalThis, 'localStorage', orig); else delete globalThis.localStorage;
  }
});

test('storage: 通常の localStorage に保存できる', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(storageSet('a', '1'), true);
    assert.equal(store.get('a'), '1');
    assert.equal(storageGet('a'), '1');
  } finally {
    delete globalThis.localStorage;
  }
});

test('params: clampSearchParams は上限・下限・非数値を丸める', () => {
  assert.deepEqual(clampSearchParams({ radiusMeters: 5000, maxCount: 10 }), { radiusMeters: 5000, maxCount: 10 });
  assert.deepEqual(clampSearchParams({ radiusMeters: 50000, maxCount: 100 }), { radiusMeters: SEARCH_LIMITS.maxRadius, maxCount: SEARCH_LIMITS.maxCount });
  assert.deepEqual(clampSearchParams({ radiusMeters: 0, maxCount: 0 }), { radiusMeters: 100, maxCount: 1 });
  assert.deepEqual(clampSearchParams({ radiusMeters: '', maxCount: 'abc' }).maxCount, 10);
  assert.deepEqual(clampSearchParams({ radiusMeters: NaN, maxCount: undefined }), { radiusMeters: 2000, maxCount: 10 });
});

test('params: 履歴の値が選択肢に無くても、近い選択肢に合わせる(select が空にならない)', () => {
  assert.deepEqual(normalizeForUi({ radiusMeters: 3000, maxCount: 7 }), { radiusMeters: 2000, maxCount: 5 });
  assert.deepEqual(normalizeForUi({ radiusMeters: 99999, maxCount: 99 }), { radiusMeters: 10000, maxCount: 20 });
  assert.deepEqual(normalizeForUi({ radiusMeters: null, maxCount: null }), { radiusMeters: 2000, maxCount: 10 });
  assert.equal(snapToOption(1500, [1000, 2000], 0), 1000); // 同距離は小さい方
});

test('params: isOneOf はプロトタイプのキー(constructor 等)を拒否する', () => {
  assert.equal(isOneOf('distance', { distance: 1 }), true);
  assert.equal(isOneOf('constructor', { distance: 1 }), false);
  assert.equal(isOneOf(null, { distance: 1 }), false);
});

test('getPreferredLanguageCode: ホスト名に使うため、言語コードの形式だけ許可する', () => {
  const set = (lang) => Object.defineProperty(globalThis, 'navigator', { value: { language: lang }, configurable: true });
  try {
    set('ja-JP'); assert.equal(getPreferredLanguageCode(), 'ja');
    set('th'); assert.equal(getPreferredLanguageCode(), 'th');
    set('x.evil.example'); assert.equal(getPreferredLanguageCode(), 'en');
    set(''); assert.equal(getPreferredLanguageCode(), 'en');
  } finally {
    delete globalThis.navigator;
  }
});
