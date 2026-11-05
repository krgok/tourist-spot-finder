// お気に入りのメモ・「行きたい/訪問済み」の整形と検証(DOM・通信に依存しない純粋関数)。
// 上限は supabase/migrations/20261105010000_favorites_notes.sql の check 制約と揃えてある。

export const NOTE_MAX = 1000;
export const STATUS_LABELS = { want: '行きたい', visited: '訪問済み' };
export const FILTER_LABELS = { all: 'すべて', want: '行きたい', visited: '訪問済み' };

// DB の char_length は文字(コードポイント)数。JS の length は絵文字を 2 と数えるため、コードポイントで切る。
export function normalizeNote(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  return [...trimmed].slice(0, NOTE_MAX).join('');
}

// 端末のローカル日付(YYYY-MM-DD)
export function todayLocalISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

// 保存する内容(DB の更新対象の 3 列)を作る。矛盾(行きたいなのに訪問日がある等)は作らない。
// 戻り値: { ok: true, patch } か { ok: false, error }
export function buildFavoritePatch({ note, status, visitedAt }, { today = todayLocalISO() } = {}) {
  if (!Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)) {
    return { ok: false, error: '状態(行きたい/訪問済み)が正しくありません。' };
  }
  const cleanNote = normalizeNote(note);
  if (status === 'want') {
    return { ok: true, patch: { note: cleanNote || null, status: 'want', visited_at: null } };
  }
  const date = visitedAt || null;
  if (date !== null) {
    if (!isValidDateString(date)) return { ok: false, error: '訪問日が正しくありません。' };
    if (date > today) return { ok: false, error: '訪問日に未来の日付は指定できません。' };
  }
  return { ok: true, patch: { note: cleanNote || null, status: 'visited', visited_at: date } };
}

// status 列が無い(マイグレーション前の)行は「行きたい」として扱う
export function favoriteStatus(fav) {
  return fav?.status === 'visited' ? 'visited' : 'want';
}

export function filterFavorites(favorites, filter) {
  if (filter !== 'want' && filter !== 'visited') return favorites;
  return favorites.filter((f) => favoriteStatus(f) === filter);
}

// 列が無い/権限が無い=マイグレーション未適用、を見分けて分かりやすい文言にする
export function describeUpdateError(error) {
  const code = String(error?.code ?? '');
  const msg = String(error?.message ?? '');
  if (code === 'PGRST204' || code === '42703' || code === '42501' || /column .* does not exist|could not find the .* column|permission denied/i.test(msg)) {
    return 'メモ・訪問済みの保存に必要なデータベースの更新(マイグレーション)が、まだ適用されていないようです。READMEの手順(supabase/migrations の実行)を確認してください。';
  }
  return 'お気に入りの更新に失敗しました: ' + msg;
}
