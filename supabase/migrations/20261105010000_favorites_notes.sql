-- お気に入りにメモと「行きたい/訪問済み」を持たせる(機能追加)。
--
-- 対象は tourist_app.favorites のみ。public や他アプリのスキーマには触れない。
-- 冪等(何度実行しても同じ結果)。1 トランザクション。
-- 実行は Supabase ダッシュボードの SQL Editor で、利用者が行う。
-- 前提: supabase/schema.sql と、これより前の migrations(20261105000000_harden_tourist_app.sql)が適用済み。
--
-- 変更内容:
--   1. 列の追加: note(メモ。1000 文字まで)/ status('want' = 行きたい、'visited' = 訪問済み。既定 'want')/
--      visited_at(訪問日。status が 'visited' のときだけ)
--   2. update を、**この 3 列に限って**許可する(列単位の権限)。
--      user_id・place_id・表示名などは更新できない(他人になりすます・別の場所にすり替える操作を防ぐ)。
--   3. update ポリシー: 自分の行だけ(using / with check とも auth.uid() = user_id)。
--
-- 注意: 20261105000000_harden_tourist_app.sql を後から再実行すると、テーブル権限の取り消し(revoke)により
--       この列単位の update 権限も外れる。その場合は、このファイルをもう一度実行すれば戻る
--       (migrations は番号順に、すべて実行するのが安全)。
--
-- 巻き戻し(必要になったら。SQL Editor で実行。列のデータも消える):
--   revoke update on tourist_app.favorites from authenticated;
--   drop policy if exists "own favorites update" on tourist_app.favorites;
--   alter table tourist_app.favorites drop column if exists note, drop column if exists status, drop column if exists visited_at;

begin;

-- ---------------------------------------------------------------------------
-- 1. 列の追加
-- ---------------------------------------------------------------------------
alter table tourist_app.favorites add column if not exists note text;
alter table tourist_app.favorites add column if not exists status text not null default 'want';
alter table tourist_app.favorites add column if not exists visited_at date;

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('favorites_note_chk',
         'note is null or char_length(note) <= 1000'),
      ('favorites_status_chk',
         'status in (''want'', ''visited'')'),
      ('favorites_visited_at_chk',
         '(visited_at is null) or (status = ''visited'' and visited_at between date ''2000-01-01'' and date ''2100-01-01'')')
    ) as t(name, expr)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = c.name and conrelid = 'tourist_app.favorites'::regclass
    ) then
      execute format('alter table tourist_app.favorites add constraint %I check (%s)', c.name, c.expr);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. 列単位の update 権限(user_id などは更新できない)
-- ---------------------------------------------------------------------------
revoke update on tourist_app.favorites from public, anon, authenticated;
grant update (note, status, visited_at) on tourist_app.favorites to authenticated;

-- ---------------------------------------------------------------------------
-- 3. update ポリシー(自分の行だけ)
-- ---------------------------------------------------------------------------
drop policy if exists "own favorites update" on tourist_app.favorites;
create policy "own favorites update" on tourist_app.favorites
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
