-- 観光地調査アプリ: tourist_app スキーマの権限・入力・件数の強化(2026-11 点検)
--
-- 対象は tourist_app スキーマの favorites / search_history のみ。
-- public スキーマや他アプリのスキーマには一切触れない。
-- 冪等(何度実行しても同じ結果)。1つのトランザクションなので、途中で失敗したら全部巻き戻る。
--
-- 実行は Supabase ダッシュボードの SQL Editor で、利用者が行う(自動では実行されない)。
-- 先に supabase/schema.sql が実行済みであること。
--
-- 変更内容:
--   1. 権限の最小化: `grant all ... to anon, authenticated` を取り消し、
--      authenticated に select / insert / delete だけを与える(anon には何も与えない)。
--      `grant all` には TRUNCATE / REFERENCES / TRIGGER も含まれ、TRUNCATE は RLS の対象外。
--      アプリは update をしない(update ポリシーも元々無い)ので update 権限も与えない。
--   2. ポリシーを `to authenticated` に限定し、auth.uid() を (select auth.uid()) に(行ごとの再評価を避ける)。
--      条件は従来と同じ「自分の行だけ」。
--   3. 入力の check 制約(NOT VALID: 既存の行は検査しない。新規・更新の行だけ検査する)。
--   4. 1ユーザーあたりの件数の上限: お気に入りは 1000 件(超えると insert が失敗)、
--      検索履歴は新しい 500 件だけ残す(古いものは自動で消える)。
--
-- 巻き戻し(必要になったら。SQL Editor で実行):
--   grant usage on schema tourist_app to anon;
--   grant all on tourist_app.favorites, tourist_app.search_history to anon, authenticated;
--
-- 既存の行も検査したくなったら(制約に違反する行があると失敗する。先に違反行を確認すること):
--   alter table tourist_app.favorites validate constraint <制約名>;
--   (制約名は下の add constraint にある favorites_*_chk / search_history_*_chk)

begin;

-- ---------------------------------------------------------------------------
-- 1. 権限の最小化
-- ---------------------------------------------------------------------------
revoke all on tourist_app.favorites from public, anon, authenticated;
revoke all on tourist_app.search_history from public, anon, authenticated;

grant select, insert, delete on tourist_app.favorites to authenticated;
grant select, insert, delete on tourist_app.search_history to authenticated;

-- 未ログインの利用者は、このスキーマに何も用が無い。
revoke usage on schema tourist_app from anon;
grant usage on schema tourist_app to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ポリシー(自分の行だけ。update ポリシーは意図的に無い)
-- ---------------------------------------------------------------------------
alter table tourist_app.favorites enable row level security;
alter table tourist_app.search_history enable row level security;

drop policy if exists "own favorites select" on tourist_app.favorites;
drop policy if exists "own favorites insert" on tourist_app.favorites;
drop policy if exists "own favorites delete" on tourist_app.favorites;
drop policy if exists "own history select" on tourist_app.search_history;
drop policy if exists "own history insert" on tourist_app.search_history;
drop policy if exists "own history delete" on tourist_app.search_history;

create policy "own favorites select" on tourist_app.favorites
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own favorites insert" on tourist_app.favorites
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own favorites delete" on tourist_app.favorites
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own history select" on tourist_app.search_history
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own history insert" on tourist_app.search_history
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own history delete" on tourist_app.search_history
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. 入力の check 制約(NOT VALID)
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('tourist_app.favorites', 'favorites_place_id_chk',
         'char_length(place_id) between 1 and 300'),
      ('tourist_app.favorites', 'favorites_display_name_chk',
         'char_length(display_name) between 1 and 300'),
      ('tourist_app.favorites', 'favorites_address_chk',
         'address is null or char_length(address) <= 500'),
      ('tourist_app.favorites', 'favorites_maps_uri_chk',
         'google_maps_uri is null or (char_length(google_maps_uri) <= 2000 and google_maps_uri ~* ''^https?://'')'),
      ('tourist_app.favorites', 'favorites_lat_chk',
         'lat is null or lat between -90 and 90'),
      ('tourist_app.favorites', 'favorites_lng_chk',
         'lng is null or lng between -180 and 180'),
      ('tourist_app.favorites', 'favorites_rating_chk',
         'rating is null or rating between 0 and 5'),
      ('tourist_app.favorites', 'favorites_snapshot_chk',
         'jsonb_typeof(snapshot) = ''object'' and octet_length(snapshot::text) <= 200000'),
      ('tourist_app.favorites', 'favorites_meta_chk',
         'jsonb_typeof(meta) = ''object'' and octet_length(meta::text) <= 4000'),
      ('tourist_app.search_history', 'search_history_lat_chk',
         'lat between -90 and 90'),
      ('tourist_app.search_history', 'search_history_lng_chk',
         'lng between -180 and 180'),
      ('tourist_app.search_history', 'search_history_radius_chk',
         'radius_meters between 1 and 50000'),
      ('tourist_app.search_history', 'search_history_max_count_chk',
         'max_count between 1 and 50'),
      ('tourist_app.search_history', 'search_history_result_count_chk',
         'result_count is null or result_count between 0 and 100'),
      ('tourist_app.search_history', 'search_history_results_chk',
         'jsonb_typeof(results) = ''array'' and jsonb_array_length(results) <= 50 and octet_length(results::text) <= 50000'),
      ('tourist_app.search_history', 'search_history_meta_chk',
         'jsonb_typeof(meta) = ''object'' and octet_length(meta::text) <= 4000')
    ) as t(tbl, name, expr)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = c.name and conrelid = c.tbl::regclass
    ) then
      execute format('alter table %s add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. 1ユーザーあたりの件数の上限
--    どちらも security invoker(呼び出した利用者の権限で動く)。RLS が効くので、
--    数えるのも消すのも自分の行だけ。search_path は空にして固定する。
-- ---------------------------------------------------------------------------
create or replace function tourist_app.enforce_favorites_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from tourist_app.favorites where user_id = new.user_id) >= 1000 then
    raise exception 'favorites limit reached (max 1000 per user)'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create or replace function tourist_app.prune_search_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from tourist_app.search_history
  where user_id = new.user_id
    and id in (
      select id from tourist_app.search_history
      where user_id = new.user_id
      order by searched_at desc, id
      offset 500
    );
  return null;
end
$$;

revoke all on function tourist_app.enforce_favorites_limit() from public, anon, authenticated;
revoke all on function tourist_app.prune_search_history() from public, anon, authenticated;

drop trigger if exists favorites_limit_trg on tourist_app.favorites;
create trigger favorites_limit_trg
  before insert on tourist_app.favorites
  for each row execute function tourist_app.enforce_favorites_limit();

drop trigger if exists search_history_prune_trg on tourist_app.search_history;
create trigger search_history_prune_trg
  after insert on tourist_app.search_history
  for each row execute function tourist_app.prune_search_history();

commit;
