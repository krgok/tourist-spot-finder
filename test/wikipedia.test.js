import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameSimilarity, pickBestCandidate } from '../js/wikipedia.js';

test('nameSimilarity: 完全一致=1、空白・記号は無視', () => {
  assert.equal(nameSimilarity('浅草寺', '浅草寺'), 1);
  assert.equal(nameSimilarity('Sensō-ji', 'sensō-ji'), 1);
  assert.equal(nameSimilarity('東京 タワー', '東京タワー'), 1);
  assert.equal(nameSimilarity('', '浅草寺'), 0);
  assert.equal(nameSimilarity(undefined, '浅草寺'), 0);
});

test('nameSimilarity: 部分一致は0.8', () => {
  assert.equal(nameSimilarity('東京タワー', '東京タワー展望台'), 0.8);
});

test('nameSimilarity: 同じカテゴリ語だけが共通する別の場所は低い', () => {
  assert.ok(nameSimilarity('江戸東京博物館', 'アメリカ自然史博物館') < 0.5);
});

test('pickBestCandidate: 名前が近い候補を、距離が遠くても優先する', () => {
  const c = [
    { title: '別の公園', dist: 20 },
    { title: '浅草寺', dist: 300 },
  ];
  assert.equal(pickBestCandidate(c, '浅草寺').title, '浅草寺');
});

test('pickBestCandidate: 名前が全く違い150mより遠ければ棄却(別の同種施設の取り違え防止)', () => {
  const c = [{ title: 'Xyz', dist: 151 }];
  assert.equal(pickBestCandidate(c, '浅草寺'), null);
});

test('pickBestCandidate: 名前が違っても150m以内なら表記揺れとして採用(境界は150mを含む)', () => {
  assert.equal(pickBestCandidate([{ title: 'Xyz', dist: 150 }], '浅草寺').title, 'Xyz');
});

test('pickBestCandidate: 候補なしは null', () => {
  assert.equal(pickBestCandidate([], '浅草寺'), null);
  assert.equal(pickBestCandidate(undefined, '浅草寺'), null);
});
