// 外部CDN(esm.sh)から読み込むため、バージョンは完全固定にする(@2 のような浮動指定だと、
// 配信側の更新や改ざんがそのまま動いてしまう)。更新するときは意図的にここを書き換える。
// ES モジュールの import には SRI(integrity)を付けられない。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260708-4';

// 既存のSupabaseプロジェクトに同居させるため、専用スキーマ tourist_app を使う。
// Supabaseダッシュボードの Project Settings > API > Exposed schemas に
// "tourist_app" を追加しておく必要がある(supabase/schema.sql参照)。
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'tourist_app' },
});

// ログイン中の利用者のアクセストークン(サーバー側の中継へ送る)。ログインしていなければ null。
export async function getAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function isSupabaseConfigured() {
  return !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.includes('YOUR-SUPABASE-ANON-KEY');
}
