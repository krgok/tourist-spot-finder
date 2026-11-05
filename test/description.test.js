import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDescription } from '../js/description.js';
import { MIN_DESCRIPTION_LENGTH } from '../js/config.js';

test('buildDescription: 情報が最小でも最低文字数を満たし、例外を出さない', () => {
  const text = buildDescription({ id: 'x' });
  assert.ok(text.length >= MIN_DESCRIPTION_LENGTH);
  assert.match(text, /名称不明のスポット/);
});

test('buildDescription: 同じ場所は常に同じ文章(決定的)', () => {
  const p = { id: 'abc', displayName: { text: '谷中霊園' }, types: ['park'] };
  assert.equal(buildDescription(p), buildDescription(p));
});

test('buildDescription: 英語だらけの editorialSummary / レビューは採用しない', () => {
  const p = {
    id: 'a',
    displayName: { text: '浅草寺' },
    editorialSummary: { text: 'A famous temple in Tokyo with a long history.' },
    reviews: [{ text: { text: 'Great place, very nice.' }, rating: 5 }],
  };
  const text = buildDescription(p);
  assert.ok(!text.includes('famous temple'));
  assert.ok(!text.includes('Great place'));
});

test('buildDescription: 日本語のWikipedia要約とレビューは採用する', () => {
  const p = {
    id: 'a',
    displayName: { text: '浅草寺' },
    _wikipedia: { extract: '浅草寺は東京都台東区にある都内最古の寺院である。' },
    reviews: [{ text: { text: 'とても落ち着く素晴らしいお寺でした。' }, rating: 5 }],
  };
  const text = buildDescription(p);
  assert.ok(text.includes('都内最古の寺院'));
  assert.ok(text.includes('とても落ち着く'));
});

test('buildDescription: 長いレビューは120文字で切る', () => {
  const long = 'あ'.repeat(500);
  const text = buildDescription({ id: 'a', displayName: { text: 'x' }, reviews: [{ text: { text: long }, rating: 4 }] });
  assert.ok(text.includes('あ'.repeat(120) + '…'));
  assert.ok(!text.includes('あ'.repeat(121)));
});
