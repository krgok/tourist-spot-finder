import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { GENRES, SORT_OPTIONS, TRAVEL_MODES, REGIONS, LANGUAGES, DEFAULT_REGION } from '../js/config.js';

test('GENRES: 必須項目があり、リクエスト用の型に place_of_worship を使っていない', () => {
  for (const [key, g] of Object.entries(GENRES)) {
    assert.ok(g.label && g.description, key);
    assert.ok(g.includedPrimaryTypes.length > 0, key);
    assert.ok(g.allowedTypes.length > 0, key);
    assert.ok(Array.isArray(g.excludedTypes), key);
    assert.ok(['tourist_attraction', 'restaurant', 'lodging', 'event', 'other'].includes(g.favoriteCategory), key);
    // 検索リクエストで使う型は、レスポンス側の許可リストに含まれていること(自分で自分を弾かない)
    for (const t of g.includedPrimaryTypes) assert.ok(g.allowedTypes.includes(t), `${key}:${t}`);
    assert.ok(!g.includedPrimaryTypes.includes('place_of_worship'), key);
  }
});

test('index.html: ジャンル・並び替え・移動手段の選択肢が config と一致する', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const optionValues = (id) => {
    const m = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`));
    return [...m[1].matchAll(/value="([^"]+)"/g)].map((x) => x[1]).sort();
  };
  // ジャンルの選択肢は app.js が地域に応じて組み立てる。HTML の初期値は既定の地域の一覧と一致させる。
  assert.deepEqual(optionValues('genre-select'), [...REGIONS[DEFAULT_REGION].genreKeys].sort());
  assert.deepEqual(optionValues('region-select'), Object.keys(REGIONS).sort());
  assert.deepEqual(optionValues('language-select'), Object.keys(LANGUAGES).sort());
  assert.deepEqual(optionValues('sort-select'), Object.keys(SORT_OPTIONS).sort());
  assert.deepEqual(optionValues('travel-mode-select'), Object.keys(TRAVEL_MODES).sort());
});

test('キャッシュ更新用の ?v= が全ファイルで同じ値(更新漏れ検知)', () => {
  const dir = new URL('../js/', import.meta.url);
  const versions = new Set();
  const files = [...readdirSync(dir).map((f) => new URL(f, dir)), new URL('../index.html', import.meta.url)];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.js\?v=([\w-]+)/g)) versions.add(m[1]);
  }
  assert.equal(versions.size, 1, [...versions].join(','));
});

test('相対 import / script src の参照先が実在する', () => {
  const dir = new URL('../js/', import.meta.url);
  const sources = readdirSync(dir).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);
  for (const [name, src] of sources) {
    for (const m of src.matchAll(/from '(\.\/[^'?]+)/g)) {
      assert.ok(existsSync(new URL(m[1], dir)), `${name} -> ${m[1]}`);
    }
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="((?:js\/|style)[^"?]+)/g)) {
    assert.ok(existsSync(new URL('../' + m[1], import.meta.url)), m[1]);
  }
});
