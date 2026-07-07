import { supabase } from './supabaseClient.js?v=20260708-2';

export async function addFavorite(place, category = 'tourist_attraction', meta = {}) {
  const { data, error } = await supabase
    .from('favorites')
    .insert({
      place_id: place.id,
      category,
      display_name: place.displayName?.text || '',
      address: place.formattedAddress || null,
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      rating: place.rating ?? null,
      google_maps_uri: place.googleMapsUri || null,
      snapshot: place,
      meta,
    })
    .select()
    .single();

  if (error) throw new Error('お気に入りの保存に失敗しました: ' + error.message);
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
