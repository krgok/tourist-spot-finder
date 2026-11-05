// Supabase Edge Function(Deno)の入口。ロジックは handler.js にあり、Node でテスト済み。
// この入口(Deno 固有の部分)だけは、ローカルに Deno が無いためテストできていない。デプロイ後に動作確認すること。
// デプロイ・環境変数の設定は supabase/functions/places-proxy/README.md の手順で、利用者が行う。
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleRequest } from './handler.js';

// SUPABASE_URL / SUPABASE_ANON_KEY は、Edge Functions に自動で設定される(公開前提の値)。
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// JWT はサーバー側で検証する(Supabase Auth に問い合わせる)。
async function getUser(jwt: string) {
  const { data, error } = await supabase.auth.getUser(jwt);
  return error ? null : data.user;
}

Deno.serve((request: Request) =>
  handleRequest(request, {
    env: {
      GOOGLE_MAPS_SERVER_KEY: Deno.env.get('GOOGLE_MAPS_SERVER_KEY'),
      ALLOWED_ORIGIN: Deno.env.get('ALLOWED_ORIGIN'),
      ALLOWED_USER_IDS: Deno.env.get('ALLOWED_USER_IDS'),
      RATE_LIMIT_PER_MIN: Deno.env.get('RATE_LIMIT_PER_MIN'),
    },
    getUser,
  })
);
