import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegion, normalizeLanguage, guessRegion, genreKeysFor, genreForRegion } from '../js/region.js';
import { GENRES, REGIONS } from '../js/config.js';
import { buildNearbyRequestBody, searchNearbyTouristSpots, geocodeLocation } from '../js/places.js';
import { buildDescription, isMostlyLanguage } from '../js/description.js';
import { fetchWikipediaExtract } from '../js/wikipedia.js';
import { buildHistoryRow } from '../js/records.js';

const KEY = ['AI', 'zaTESTKEY_0123456789_abcdefghijklmnop'].join('');

test('REGIONS: すべてのジャンルキーが GENRES にあり、どのジャンルもいずれかの地域で使われる', () => {
  const used = new Set();
  for (const [name, r] of Object.entries(REGIONS)) {
    assert.match(r.regionCode, /^[A-Z]{2}$/, name);
    for (const k of r.genreKeys) { assert.ok(GENRES[k], `${name}:${k}`); used.add(k); }
    assert.equal(new Set(r.genreKeys).size, r.genreKeys.length, '重複');
  }
  assert.deepEqual([...used].sort(), Object.keys(GENRES).sort());
});

test('タイ向けジャンル: リクエスト用の型は許可リストの部分集合で、place_of_worship を含まない', () => {
  for (const k of ['temple_th', 'market', 'mall', 'spa']) {
    const g = GENRES[k];
    for (const t of g.includedPrimaryTypes) assert.ok(g.allowedTypes.includes(t), `${k}:${t}`);
    assert.ok(!g.includedPrimaryTypes.includes('place_of_worship'), k);
  }
  assert.equal(GENRES.mall.indoor, true);
});

test('normalizeRegion / normalizeLanguage: 未知の値・プロトタイプのキーは既定に', () => {
  assert.equal(normalizeRegion('th'), 'th');
  for (const bad of ['xx', '', null, undefined, 'constructor', '__proto__']) {
    assert.equal(normalizeRegion(bad), 'jp');
    assert.equal(normalizeLanguage(bad), 'ja');
  }
  assert.equal(normalizeLanguage('en'), 'en');
});

test('guessRegion: タイムゾーンが Asia/Bangkok のときだけ th', () => {
  assert.equal(guessRegion('Asia/Bangkok'), 'th');
  assert.equal(guessRegion('Asia/Tokyo'), 'jp');
  assert.equal(guessRegion(undefined), 'jp');
});

test('genreForRegion: 地域にないジャンルは先頭に切り替える', () => {
  assert.equal(genreForRegion('th', 'market'), 'market');
  assert.equal(genreForRegion('jp', 'market'), genreKeysFor('jp')[0]);
  assert.equal(genreForRegion('th', 'onsen'), genreKeysFor('th')[0]);
});

test('buildNearbyRequestBody: 言語と regionCode を要求に含める(regionCode は任意)', () => {
  const b = buildNearbyRequestBody({ lat: 13.75, lng: 100.5, radiusMeters: 2000, genreConfig: GENRES.mall, languageCode: 'th', regionCode: 'TH' });
  assert.equal(b.languageCode, 'th');
  assert.equal(b.regionCode, 'TH');
  assert.deepEqual(b.includedPrimaryTypes, ['shopping_mall']);
  assert.equal('regionCode' in buildNearbyRequestBody({ lat: 1, lng: 2, radiusMeters: 1000, genreConfig: GENRES.dining }), false);
});

test('searchNearbyTouristSpots: 不正な言語・地域は既定に丸めて要求する', async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ places: [] }) }; };
  await searchNearbyTouristSpots({ apiKey: KEY, lat: 13.75, lng: 100.5, radiusMeters: 2000, maxCount: 5, genre: 'market', language: 'xx', region: 'th', fetchImpl });
  assert.equal(body.languageCode, 'ja');
  assert.equal(body.regionCode, 'TH');
  await searchNearbyTouristSpots({ apiKey: KEY, lat: 35, lng: 139, radiusMeters: 2000, maxCount: 5, genre: 'dining', language: 'en', region: 'bogus', fetchImpl });
  assert.equal(body.languageCode, 'en');
  assert.equal(body.regionCode, 'JP');
});

test('geocodeLocation: 表示言語で検索する', async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ places: [{ location: { latitude: 1, longitude: 2 } }] }) }; };
  await geocodeLocation({ apiKey: KEY, query: 'Siam', language: 'th', fetchImpl });
  assert.equal(body.languageCode, 'th');
});

test('isMostlyLanguage: 言語ごとの判定', () => {
  assert.equal(isMostlyLanguage('A famous temple in Bangkok.', 'en'), true);
  assert.equal(isMostlyLanguage('浅草寺は寺院です。', 'en'), false);
  assert.equal(isMostlyLanguage('วัดพระแก้วเป็นวัดที่สำคัญ', 'th'), true);
  assert.equal(isMostlyLanguage('A famous temple', 'th'), false);
  assert.equal(isMostlyLanguage('浅草寺は寺院です。', 'ja'), true);
  assert.equal(isMostlyLanguage('A famous temple', 'ja'), false);
  assert.equal(isMostlyLanguage('', 'en'), false);
});

test('buildDescription: 英語を選ぶと英語の口コミ・紹介文を採用し、日本語の枠組みで説明する', () => {
  const p = {
    id: 'a', displayName: { text: 'Wat Pho' }, types: ['buddhist_temple'],
    editorialSummary: { text: 'A famous reclining Buddha temple in Bangkok.' },
    reviews: [{ text: { text: 'Beautiful temple, a must see in Bangkok.' }, rating: 5 }],
  };
  const en = buildDescription(p, { lang: 'en' });
  assert.ok(en.includes('famous reclining Buddha') && en.includes('must see'));
  assert.ok(en.includes('寺院'));
  const ja = buildDescription(p, { lang: 'ja' });
  assert.ok(!ja.includes('famous reclining Buddha'));
});

test('buildDescription: Wikipedia は選択言語になくても日本語版なら採用', () => {
  const p = { id: 'a', displayName: { text: 'x' }, _wikipedia: { extract: 'ワット・ポーはバンコクにある寺院である。' } };
  assert.ok(buildDescription(p, { lang: 'th' }).includes('ワット・ポー'));
});

test('fetchWikipediaExtract: 表示言語の版を最優先に探す', async () => {
  const hosts = [];
  const fetchImpl = async (url) => { hosts.push(new URL(url).host); return { ok: true, json: async () => ({ query: { geosearch: [] } }) }; };
  await fetchWikipediaExtract('Wat Pho', { lat: 13.74, lng: 100.49 }, { fetchImpl, lang: 'th' });
  assert.equal(hosts[0], 'th.wikipedia.org');
  assert.ok(hosts.includes('ja.wikipedia.org') && hosts.includes('en.wikipedia.org'));
  hosts.length = 0;
  await fetchWikipediaExtract('x', { lat: 1, lng: 2 }, { fetchImpl, lang: 'evil.example' });
  assert.ok(hosts.every((h) => /^[a-z]{2,3}\.wikipedia\.org$/.test(h)));
});

test('buildHistoryRow: 地域と言語を meta に保存(長さは制限)', () => {
  const row = buildHistoryRow({ lat: 1, lng: 2, radiusMeters: 1000, maxCount: 5, places: [], genre: 'market', locationLabel: 'x', region: 'th', language: 'en' });
  assert.deepEqual(row.meta, { genre: 'market', locationLabel: 'x', region: 'th', language: 'en' });
  assert.ok(buildHistoryRow({ lat: 1, lng: 2, radiusMeters: 1000, maxCount: 5, places: [], region: 'x'.repeat(100) }).meta.region.length <= 10);
});
