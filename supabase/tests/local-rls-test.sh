#!/usr/bin/env bash
# tourist_app の RLS・権限・制約を、使い捨てのローカル PostgreSQL で検証する。
#
# 安全性: 一時ディレクトリに専用クラスタを作り、TCP は待ち受けない(unix ソケットのみ)ため、
# Supabase の本番や他のデータベースには接続できない。終了時にクラスタごと削除する。
# Supabase 側の部品(anon / authenticated ロール、auth.users、auth.uid())は最小限のスタブで代用する。
#
# 使い方:  bash supabase/tests/local-rls-test.sh        (PostgreSQL のサーバー一式が必要)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -x "${PGBIN:-/nonexistent}/initdb" ] || { echo "PostgreSQL server binaries not found (/usr/lib/postgresql/*/bin)"; exit 2; }

WORK="$(mktemp -d)"
chmod 755 "$WORK"
RUN=()
if [ "$(id -u)" = "0" ]; then
  # initdb は root で動かせないため postgres ユーザーで実行する
  chown -R postgres "$WORK"
  RUN=(runuser -u postgres --)
fi
SOCK="$WORK/sock"
mkdir -p "$SOCK"
[ ${#RUN[@]} -gt 0 ] && chown postgres "$SOCK"
cleanup() {
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -c unix_socket_directories='$SOCK'" \
  -l "$WORK/pg.log" -w start >/dev/null

psql_() { "${RUN[@]}" "$PGBIN/psql" -h "$SOCK" -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

# --- Supabase の最小スタブ ---------------------------------------------------
psql_ -d postgres -c "create database scratch_rls_test" >/dev/null
psql_ -d scratch_rls_test <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
SQL

echo "== schema.sql を適用 =="
psql_ -d scratch_rls_test -f "$ROOT/supabase/schema.sql"
echo "== マイグレーションを 2 回適用(冪等性の確認) =="
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql_ -d scratch_rls_test -f "$f"
  psql_ -d scratch_rls_test -f "$f"
done

echo "== 権限・RLS・制約のテスト =="
psql_ -d scratch_rls_test -o /dev/null -f "$ROOT/supabase/tests/rls_assertions.sql"
echo "ALL RLS TESTS PASSED"
