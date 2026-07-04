import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// 既存のSupabaseプロジェクトに同居させるため、専用スキーマ tourist_app を使う。
// Supabaseダッシュボードの Project Settings > API > Exposed schemas に
// "tourist_app" を追加しておく必要がある(supabase/schema.sql参照)。
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'tourist_app' },
});

export function isSupabaseConfigured() {
  return !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.includes('YOUR-SUPABASE-ANON-KEY');
}
