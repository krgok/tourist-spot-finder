import { supabase } from './supabaseClient.js?v=20260708-4';
import { buildFavoriteRow } from './records.js?v=20260708-4';
import { describeUpdateError } from './favoriteNotes.js?v=20260708-4';

export async function addFavorite(place, category = 'tourist_attraction', meta = {}) {
  const { data, error } = await supabase
    .from('favorites')
    .insert(buildFavoriteRow(place, category, meta))
    .select()
    .single();

  if (error) throw new Error('お気に入りの保存に失敗しました: ' + error.message);
  return data;
}

// メモ・訪問済みの更新。DB が更新を許すのは note / status / visited_at の 3 列だけ(列単位の権限)。
export async function updateFavorite(placeId, patch) {
  const { note, status, visited_at } = patch;
  const { data, error } = await supabase
    .from('favorites')
    .update({ note, status, visited_at })
    .eq('place_id', placeId)
    .select()
    .single();
  if (error) throw new Error(describeUpdateError(error));
  return data;
}

export async function removeFavorite(placeId) {
  const { error } = await supabase.from('favorites').delete().eq('place_id', placeId);
  if (error) throw new Error('お気に入りの削除に失敗しました: ' + error.message);
}

export async function listFavorites() {
  const { data, error } = await supabase
    .from('favorites')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error('お気に入りの取得に失敗しました: ' + error.message);
  return data;
}
