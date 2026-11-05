import { supabase } from './supabaseClient.js?v=20260708-4';
import { buildHistoryRow } from './records.js?v=20260708-4';

export async function recordSearch({ lat, lng, radiusMeters, maxCount, places, genre, locationLabel, region, language }) {
  const { error } = await supabase
    .from('search_history')
    .insert(buildHistoryRow({ lat, lng, radiusMeters, maxCount, places, genre, locationLabel, region, language }));

  if (error) throw new Error('検索履歴の保存に失敗しました: ' + error.message);
}

export async function listHistory(limit = 50) {
  const { data, error } = await supabase
    .from('search_history')
    .select('*')
    .order('searched_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('検索履歴の取得に失敗しました: ' + error.message);
  return data;
}

export async function deleteHistoryEntry(id) {
  const { error } = await supabase.from('search_history').delete().eq('id', id);
  if (error) throw new Error('検索履歴の削除に失敗しました: ' + error.message);
}
