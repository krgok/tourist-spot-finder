import { supabase } from './supabaseClient.js';

export async function recordSearch({ lat, lng, radiusMeters, maxCount, places, genre, locationLabel }) {
  const results = places.slice(0, 20).map((place) => ({
    place_id: place.id,
    display_name: place.displayName?.text || '',
    rating: place.rating ?? null,
    location: place.location || null,
  }));

  const { error } = await supabase.from('search_history').insert({
    lat,
    lng,
    radius_meters: radiusMeters,
    max_count: maxCount,
    result_count: places.length,
    results,
    meta: { genre, locationLabel },
  });

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
