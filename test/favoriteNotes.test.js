import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNote, buildFavoritePatch, filterFavorites, favoriteStatus, describeUpdateError, todayLocalISO, NOTE_MAX } from '../js/favoriteNotes.js';

const today = '2026-11-05';

test('normalizeNote: 前後の空白を除き、改行は保つ。1000 文字(コードポイント)で切る', () => {
  assert.equal(normalizeNote('  午前に行く\r\n子供が喜んだ  '), '午前に行く\n子供が喜んだ');
  assert.equal(normalizeNote(undefined), '');
  assert.equal(normalizeNote(42), '');
  assert.equal([...normalizeNote('あ'.repeat(1500))].length, NOTE_MAX);
});

test('normalizeNote: 絵文字(サロゲートペア)を途中で切らず、DB の文字数(コードポイント)で数える', () => {
  const out = normalizeNote('😀'.repeat(1200));
  assert.equal([...out].length, 1000);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out), '末尾が壊れたサロゲートで終わらない');
});

test('buildFavoritePatch: 行きたい → 訪問日は常に null、空メモは null', () => {
  const r = buildFavoritePatch({ note: '  ', status: 'want', visitedAt: '2026-01-01' }, { today });
  assert.deepEqual(r, { ok: true, patch: { note: null, status: 'want', visited_at: null } });
});

test('buildFavoritePatch: 訪問済み(日付あり/なし)', () => {
  assert.deepEqual(buildFavoritePatch({ note: 'よかった', status: 'visited', visitedAt: '2026-10-01' }, { today }).patch, { note: 'よかった', status: 'visited', visited_at: '2026-10-01' });
  assert.deepEqual(buildFavoritePatch({ note: '', status: 'visited', visitedAt: '' }, { today }).patch, { note: null, status: 'visited', visited_at: null });
  assert.equal(buildFavoritePatch({ status: 'visited', visitedAt: today }, { today }).ok, true); // 今日は可
});

test('buildFavoritePatch: 不正な状態・日付・未来の日付・範囲外はエラー', () => {
  assert.equal(buildFavoritePatch({ status: 'done' }).ok, false);
  assert.equal(buildFavoritePatch({ status: 'constructor' }).ok, false);
  for (const d of ['2026-13-01', '2026-02-30', '26-01-01', '2026/01/01', '1999-12-31', '2101-01-01', 'abc']) {
    assert.equal(buildFavoritePatch({ status: 'visited', visitedAt: d }, { today: '2100-12-31' }).ok, false, d);
  }
  assert.match(buildFavoritePatch({ status: 'visited', visitedAt: '2026-11-06' }, { today }).error, /未来/);
});

test('buildFavoritePatch: DB が更新を許す 3 列だけを返す', () => {
  const { patch } = buildFavoritePatch({ note: 'x', status: 'visited', visitedAt: '2026-01-01', user_id: 'evil', place_id: 'evil' }, { today });
  assert.deepEqual(Object.keys(patch).sort(), ['note', 'status', 'visited_at']);
});

test('filterFavorites / favoriteStatus: status 列が無い行は「行きたい」', () => {
  const favs = [{ place_id: 'a' }, { place_id: 'b', status: 'visited' }, { place_id: 'c', status: 'want' }];
  assert.equal(favoriteStatus(favs[0]), 'want');
  assert.deepEqual(filterFavorites(favs, 'visited').map((f) => f.place_id), ['b']);
  assert.deepEqual(filterFavorites(favs, 'want').map((f) => f.place_id), ['a', 'c']);
  assert.equal(filterFavorites(favs, 'all').length, 3);
  assert.equal(filterFavorites(favs, 'bogus').length, 3);
});

test('describeUpdateError: マイグレーション未適用(列なし・権限なし)を案内する', () => {
  for (const e of [{ code: 'PGRST204', message: "Could not find the 'note' column of 'favorites' in the schema cache" }, { code: '42703', message: 'column "note" does not exist' }, { code: '42501', message: 'permission denied for table favorites' }]) {
    assert.match(describeUpdateError(e), /マイグレーション/);
  }
  assert.match(describeUpdateError({ code: '23514', message: 'violates check constraint' }), /更新に失敗しました: violates check/);
});

test('todayLocalISO: ゼロ埋め', () => {
  assert.equal(todayLocalISO(new Date(2026, 0, 5)), '2026-01-05');
});
