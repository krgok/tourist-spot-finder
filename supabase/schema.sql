-- 観光地調査アプリ: Supabase スキーマ定義
-- 既存のSupabaseプロジェクトに同居させるため、専用スキーマ tourist_app を使う。
-- Supabaseダッシュボードの SQL Editor でそのまま実行してください。
--
-- 実行後、Supabaseダッシュボード → Project Settings → API → Exposed schemas に
-- "tourist_app" を追加してください（デフォルトでは public 以外は REST API 経由で見えません）。

create schema if not exists tourist_app;

create extension if not exists "pgcrypto";

create type tourist_app.place_category as enum (
  'tourist_attraction',
  'restaurant',
  'lodging',
  'event',
  'other'
);

-- お気に入り
create table tourist_app.favorites (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  place_id        text not null,
  category        tourist_app.place_category not null default 'tourist_attraction',
  display_name    text not null,
  address         text,
  lat             double precision,
  lng             double precision,
  rating          numeric(2,1),
  google_maps_uri text,
  snapshot        jsonb not null default '{}'::jsonb,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (user_id, place_id)
);

create index favorites_user_idx on tourist_app.favorites (user_id, created_at desc);
create index favorites_user_category_idx on tourist_app.favorites (user_id, category, created_at desc);

-- 検索履歴
create table tourist_app.search_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  searched_at   timestamptz not null default now(),
  lat           double precision not null,
  lng           double precision not null,
  radius_meters integer not null,
  max_count     integer not null,
  result_count  integer,
  results       jsonb not null default '[]'::jsonb,
  meta          jsonb not null default '{}'::jsonb
);

create index search_history_user_idx on tourist_app.search_history (user_id, searched_at desc);
create index search_history_meta_gin_idx on tourist_app.search_history using gin (meta);

-- RLS
alter table tourist_app.favorites enable row level security;
alter table tourist_app.search_history enable row level security;

create policy "own favorites select" on tourist_app.favorites
  for select using (auth.uid() = user_id);
create policy "own favorites insert" on tourist_app.favorites
  for insert with check (auth.uid() = user_id);
create policy "own favorites delete" on tourist_app.favorites
  for delete using (auth.uid() = user_id);

create policy "own history select" on tourist_app.search_history
  for select using (auth.uid() = user_id);
create policy "own history insert" on tourist_app.search_history
  for insert with check (auth.uid() = user_id);
create policy "own history delete" on tourist_app.search_history
  for delete using (auth.uid() = user_id);

-- PostgRESTがこのスキーマの関数/テーブルを見つけられるよう権限を付与
grant usage on schema tourist_app to anon, authenticated;
grant all on tourist_app.favorites to anon, authenticated;
grant all on tourist_app.search_history to anon, authenticated;
