-- 読み取り専用の点検クエリ(SELECT のみ。何も変更しない)。
-- このプロジェクトは他のアプリと共有しているため、「anon キーが公開されている前提で、
-- 他のスキーマが露出していないか」を、利用者が SQL Editor で確認するためのもの。
-- 結果に行が出たものが「要確認」。値(キーなど)は出力されない。
--
-- 注意: 他アプリのスキーマの中身を変更するものではない。確認結果を見て、必要なら各アプリ側で対処する。

-- 1) RLS が無効なテーブル(anon / authenticated に権限があれば、全行が読み書きできてしまう)
select n.nspname as schema, c.relname as table, c.relkind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and not c.relrowsecurity
  and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_%'
  and exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = n.nspname and g.table_name = c.relname
      and g.grantee in ('anon', 'authenticated', 'PUBLIC')
  )
order by 1, 2;

-- 2) 条件が実質「常に真」のポリシー(using (true) など)と、対象ロール
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname not in ('pg_catalog', 'information_schema')
  and (
    coalesce(qual, '') in ('true', '(true)')
    or coalesce(with_check, '') in ('true', '(true)')
  )
order by 1, 2, 3;

-- 3) anon / PUBLIC に付いているテーブル権限(スキーマ別の件数と権限の種類)
select table_schema,
       count(distinct table_name) as tables,
       string_agg(distinct privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where grantee in ('anon', 'PUBLIC')
  and table_schema not in ('pg_catalog', 'information_schema')
group by 1
order by 1;

-- 4) anon に usage が付いているスキーマ(Exposed schemas に入っていれば REST から見える)
select n.nspname as schema,
       has_schema_privilege('anon', n.oid, 'USAGE') as anon_usage,
       has_schema_privilege('authenticated', n.oid, 'USAGE') as authenticated_usage
from pg_namespace n
where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_%'
order by 1;

-- 5) security definer の関数(呼び出した人ではなく所有者の権限で動く = RLS を迂回しうる)
select n.nspname as schema, p.proname as function,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'graphql',
                        'graphql_public', 'realtime', 'vault', 'pgsodium', 'pgsodium_masks', 'supabase_functions')
order by 1, 2;

-- 6) ビュー(security_invoker でないビューは所有者の権限で読むため、RLS を迂回しうる)
select n.nspname as schema, c.relname as view,
       coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') as security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v', 'm')
  and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'graphql',
                        'graphql_public', 'realtime', 'vault', 'pgsodium', 'pgsodium_masks', 'supabase_functions')
order by 1, 2;

-- 7) このアプリ(tourist_app)の現在の権限とポリシー(migrations 適用後は
--    authenticated に DELETE,INSERT,SELECT のみ・anon は 0 件になっていること)
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'tourist_app' and grantee in ('anon', 'authenticated', 'PUBLIC')
group by 1, 2
order by 2, 1;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'tourist_app'
order by 1, 2;

-- 8) このアプリの制約(NOT VALID のままの制約は、既存行を未検査。convalidated = false)
select conrelid::regclass as table, conname, convalidated
from pg_constraint
where connamespace = 'tourist_app'::regnamespace and contype = 'c'
order by 1, 2;

-- 9) 利用者数と1人あたりの行数(個人のデータは出さず、件数だけ)
select (select count(*) from auth.users) as auth_users,
       (select count(*) from tourist_app.favorites) as favorites_rows,
       (select count(*) from tourist_app.search_history) as history_rows,
       (select coalesce(max(c), 0) from (select count(*) c from tourist_app.favorites group by user_id) s) as max_favorites_per_user,
       (select coalesce(max(c), 0) from (select count(*) c from tourist_app.search_history group by user_id) s) as max_history_per_user,
       (select coalesce(max(octet_length(snapshot::text)), 0) from tourist_app.favorites) as max_snapshot_bytes;
