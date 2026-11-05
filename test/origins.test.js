import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredOrigins, addOrigin, removeOrigin, serializeOrigins, ORIGIN_LIMITS } from '../js/origins.js';

const o = (over = {}) => ({ id: 'a1', name: 'ホテル', lat: 13.7563, lng: 100.5018, ...over });

test('parseStoredOrigins: 壊れたデータ・配列以外は空配列(例外にしない)', () => {
  for (const raw of [null, undefined, '', 'not json', '{"a":1}', '42', '"x"']) assert.deepEqual(parseStoredOrigins(raw), []);
});

test('parseStoredOrigins: 正常な要素は残し、不正な要素(名前なし・座標範囲外・ID重複)は捨てる', () => {
  const raw = JSON.stringify([o(), o({ id: 'b2', name: '' }), o({ id: 'c3', lat: 91 }), o({ id: 'd4', lng: 'x' }), o({ id: 'a1', name: '重複ID' }), o({ id: 'bad id!', name: 'x' }), null, 5]);
  const r = parseStoredOrigins(raw);
  assert.deepEqual(r.map((x) => x.id), ['a1']);
});

test('parseStoredOrigins: 名前は 40 文字に、座標は小数 5 桁に丸め、上限 10 件', () => {
  const r = parseStoredOrigins(JSON.stringify([o({ name: 'あ'.repeat(100), lat: 13.123456789, lng: 100.987654321 })]));
  assert.equal(r[0].name.length, ORIGIN_LIMITS.nameMax);
  assert.equal(r[0].lat, 13.12346);
  assert.equal(r[0].lng, 100.98765);
  const many = Array.from({ length: 20 }, (_, i) => o({ id: 'i' + i, name: 'n' + i }));
  assert.equal(parseStoredOrigins(JSON.stringify(many)).length, 10);
});

test('parseStoredOrigins: 名前に HTML が入っていても文字列のまま(描画側は textContent)', () => {
  const r = parseStoredOrigins(JSON.stringify([o({ name: '<img src=x onerror=alert(1)>' })]));
  assert.equal(r[0].name, '<img src=x onerror=alert(1)>');
});

test('addOrigin: 追加できる。名前の空白は整える', () => {
  const r = addOrigin([], { name: '  自宅   バンコク ', lat: 13.7563, lng: 100.5018 }, { idGen: () => 'x1' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.list, [{ id: 'x1', name: '自宅 バンコク', lat: 13.7563, lng: 100.5018 }]);
});

test('addOrigin: 名前なし・座標不正・同名・上限はエラー', () => {
  assert.equal(addOrigin([], { name: ' ', lat: 1, lng: 2 }).ok, false);
  assert.match(addOrigin([], { name: 'x', lat: 91, lng: 2 }).error, /位置が正しくありません/);
  assert.match(addOrigin([o()], { name: 'ホテル', lat: 1, lng: 2 }).error, /すでに保存/);
  const full = Array.from({ length: 10 }, (_, i) => o({ id: 'i' + i, name: 'n' + i }));
  assert.match(addOrigin(full, { name: 'new', lat: 1, lng: 2 }).error, /10件まで/);
});

test('addOrigin: 生成された ID から危険な文字を除く。元の配列は変更しない', () => {
  const list = [];
  const r = addOrigin(list, { name: 'x', lat: 1, lng: 2 }, { idGen: () => '"><script>' });
  assert.match(r.list[0].id, /^[\w-]+$/);
  assert.equal(list.length, 0);
});

test('removeOrigin / serialize の往復', () => {
  const list = [o(), o({ id: 'b2', name: '職場' })];
  assert.deepEqual(removeOrigin(list, 'a1').map((x) => x.id), ['b2']);
  assert.deepEqual(parseStoredOrigins(serializeOrigins(list)), list);
});
