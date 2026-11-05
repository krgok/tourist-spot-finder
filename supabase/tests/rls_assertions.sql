-- local-rls-test.sh から呼ばれる検証。使い捨てのローカル DB 専用(スタブの auth スキーマを前提とする)。
-- 本番の SQL Editor では実行しないこと(本番向けの確認は supabase/audit-queries.sql)。

\set ON_ERROR_STOP on
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'

-- 指定ロール・指定ユーザーとして SQL を実行し、結果を 'ok:<行数>' か 'err:<SQLSTATE>' で返す
create function pg_temp.run_as(r text, uid text, stmt text) returns text
language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute format('set local role %I', r);
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    reset role;
    return 'err:' || sqlstate;
  end;
  reset role;
  return 'ok:' || n;
end $$;

create function pg_temp.check_eq(name text, actual text, expected text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL - %: expected %, got %', name, expected, actual;
  end if;
  raise notice 'ok - %', name;
end $$;

-- 種データ(スーパーユーザーとして。RLS を通らない)
insert into tourist_app.favorites (user_id, place_id, display_name)
  values (:'A', 'pA', 'A-spot'), (:'B', 'pB', 'B-spot');
insert into tourist_app.search_history (user_id, lat, lng, radius_meters, max_count)
  values (:'A', 35, 139, 1000, 10), (:'B', 35, 139, 1000, 10);

-- ===== 未ログイン(anon): どの操作も通らない =====
select pg_temp.check_eq('anon select favorites', pg_temp.run_as('anon', null, 'select * from tourist_app.favorites'), 'err:42501');
select pg_temp.check_eq('anon select history', pg_temp.run_as('anon', null, 'select * from tourist_app.search_history'), 'err:42501');
select pg_temp.check_eq('anon insert favorites', pg_temp.run_as('anon', null, $q$insert into tourist_app.favorites(user_id,place_id,display_name) values ('00000000-0000-0000-0000-00000000000a','x','x')$q$), 'err:42501');
select pg_temp.check_eq('anon insert history', pg_temp.run_as('anon', null, $q$insert into tourist_app.search_history(user_id,lat,lng,radius_meters,max_count) values ('00000000-0000-0000-0000-00000000000a',1,1,1000,10)$q$), 'err:42501');
select pg_temp.check_eq('anon delete favorites', pg_temp.run_as('anon', null, 'delete from tourist_app.favorites'), 'err:42501');
select pg_temp.check_eq('anon delete history', pg_temp.run_as('anon', null, 'delete from tourist_app.search_history'), 'err:42501');
select pg_temp.check_eq('anon update favorites', pg_temp.run_as('anon', null, $q$update tourist_app.favorites set display_name='x'$q$), 'err:42501');
select pg_temp.check_eq('anon truncate', pg_temp.run_as('anon', null, 'truncate tourist_app.favorites'), 'err:42501');

-- ===== ログイン済みの本人(A) =====
select pg_temp.check_eq('A sees only own favorites', pg_temp.run_as('authenticated', :'A', 'select * from tourist_app.favorites'), 'ok:1');
select pg_temp.check_eq('A sees only own history', pg_temp.run_as('authenticated', :'A', 'select * from tourist_app.search_history'), 'ok:1');
select pg_temp.check_eq('A insert own favorite (explicit user_id)', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(user_id,place_id,display_name) values ('00000000-0000-0000-0000-00000000000a','pA2','A2')$q$), 'ok:1');
select pg_temp.check_eq('A insert favorite (default user_id)', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name) values ('pA3','A3')$q$), 'ok:1');
select pg_temp.check_eq('A cannot insert as B (favorites)', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(user_id,place_id,display_name) values ('00000000-0000-0000-0000-00000000000b','evil','evil')$q$), 'err:42501');
select pg_temp.check_eq('A cannot insert as B (history)', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(user_id,lat,lng,radius_meters,max_count) values ('00000000-0000-0000-0000-00000000000b',1,1,1000,10)$q$), 'err:42501');
select pg_temp.check_eq('A delete only affects own favorites', pg_temp.run_as('authenticated', :'A', $q$delete from tourist_app.favorites where place_id in ('pA3','pB')$q$), 'ok:1');
select pg_temp.check_eq('A cannot update (no privilege/policy)', pg_temp.run_as('authenticated', :'A', $q$update tourist_app.favorites set display_name='x'$q$), 'err:42501');
select pg_temp.check_eq('A cannot truncate', pg_temp.run_as('authenticated', :'A', 'truncate tourist_app.favorites'), 'err:42501');
select pg_temp.check_eq('A cannot call limit trigger fn directly', pg_temp.run_as('authenticated', :'A', 'select tourist_app.enforce_favorites_limit()'), 'err:42501');

-- B の行は無傷
select pg_temp.check_eq('B rows intact', (select count(*)::text from tourist_app.favorites where user_id = :'B'), '1');

-- ===== 他人(B)から A の行は見えない・消せない =====
select pg_temp.check_eq('B sees only own favorites', pg_temp.run_as('authenticated', :'B', 'select * from tourist_app.favorites'), 'ok:1');
select pg_temp.check_eq('B cannot delete A rows', pg_temp.run_as('authenticated', :'B', $q$delete from tourist_app.favorites where place_id like 'pA%'$q$), 'ok:0');

-- ===== 入力の制約 =====
select pg_temp.check_eq('lat out of range', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count) values (100,139,1000,10)$q$), 'err:23514');
select pg_temp.check_eq('lng out of range', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count) values (35,181,1000,10)$q$), 'err:23514');
select pg_temp.check_eq('radius too large', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count) values (35,139,100000,10)$q$), 'err:23514');
select pg_temp.check_eq('max_count too large', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count) values (35,139,1000,500)$q$), 'err:23514');
select pg_temp.check_eq('results not an array', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count,results) values (35,139,1000,10,'{"a":1}')$q$), 'err:23514');
select pg_temp.check_eq('results too many items', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count,results) select 35,139,1000,10,jsonb_agg(i) from generate_series(1,51) i$q$), 'err:23514');
select pg_temp.check_eq('results too large', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count,results) values (35,139,1000,10,jsonb_build_array(repeat('a',60000)))$q$), 'err:23514');
select pg_temp.check_eq('history meta too large', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count,meta) values (35,139,1000,10,jsonb_build_object('x',repeat('a',5000)))$q$), 'err:23514');
select pg_temp.check_eq('snapshot too large', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name,snapshot) values ('big','big',jsonb_build_object('x',repeat('a',250000)))$q$), 'err:23514');
select pg_temp.check_eq('snapshot not an object', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name,snapshot) values ('arr','arr','[]')$q$), 'err:23514');
select pg_temp.check_eq('javascript: maps uri rejected', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name,google_maps_uri) values ('js','js','javascript:alert(1)')$q$), 'err:23514');
select pg_temp.check_eq('https maps uri accepted', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name,google_maps_uri) values ('ok1','ok1','https://maps.google.com/?cid=1')$q$), 'ok:1');
select pg_temp.check_eq('rating out of range', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name,rating) values ('r','r',5.9)$q$), 'err:23514');
select pg_temp.check_eq('empty display_name rejected', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name) values ('e','')$q$), 'err:23514');
select pg_temp.check_eq('normal app-shaped history row accepted', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count,result_count,results,meta) values (13.7563,100.5018,2000,10,10,'[{"place_id":"x","display_name":"y","rating":4.5,"location":{"latitude":1,"longitude":2}}]','{"genre":"sightseeing","locationLabel":"現在地"}')$q$), 'ok:1');

-- ===== 件数の上限 =====
-- A のお気に入りを 999 件にそろえてから(スーパーユーザーとして)、1000 件目は通り、1001 件目は拒否される
delete from tourist_app.favorites where user_id = :'A';
insert into tourist_app.favorites (user_id, place_id, display_name)
  select :'A', 'bulk' || i, 'bulk' from generate_series(1, 999) i;
select pg_temp.check_eq('1000th favorite accepted', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name) values ('last','last')$q$), 'ok:1');
select pg_temp.check_eq('1001st favorite rejected', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.favorites(place_id,display_name) values ('over','over')$q$), 'err:23514');
select pg_temp.check_eq('B unaffected by A limit', pg_temp.run_as('authenticated', :'B', $q$insert into tourist_app.favorites(place_id,display_name) values ('pB2','B2')$q$), 'ok:1');

-- 履歴は新しい 500 件だけ残る(B の分は影響を受けない)
select pg_temp.check_eq('505 history inserts', pg_temp.run_as('authenticated', :'A', $q$insert into tourist_app.search_history(lat,lng,radius_meters,max_count) select 35,139,1000,10 from generate_series(1,505)$q$), 'ok:505');
select pg_temp.check_eq('A history pruned to 500', (select count(*)::text from tourist_app.search_history where user_id = :'A'), '500');
select pg_temp.check_eq('B history untouched by pruning', (select count(*)::text from tourist_app.search_history where user_id = :'B'), '1');

-- ===== カタログでの確認 =====
select pg_temp.check_eq('RLS enabled on both tables',
  (select string_agg(relname || '=' || relrowsecurity, ',' order by relname)
     from pg_class where relnamespace = 'tourist_app'::regnamespace and relkind = 'r'),
  'favorites=true,search_history=true');
select pg_temp.check_eq('no policy without a user_id condition',
  (select count(*)::text from pg_policies where schemaname = 'tourist_app'
     and (coalesce(qual, '') !~ 'user_id' and coalesce(with_check, '') !~ 'user_id')), '0');
select pg_temp.check_eq('no update policy (intended)',
  (select count(*)::text from pg_policies where schemaname = 'tourist_app' and cmd = 'UPDATE'), '0');
select pg_temp.check_eq('anon holds no table privileges',
  (select count(*)::text from information_schema.role_table_grants
     where table_schema = 'tourist_app' and grantee in ('anon', 'PUBLIC')), '0');
select pg_temp.check_eq('authenticated holds exactly select/insert/delete',
  (select string_agg(distinct privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
     where table_schema = 'tourist_app' and grantee = 'authenticated'), 'DELETE,INSERT,SELECT');
