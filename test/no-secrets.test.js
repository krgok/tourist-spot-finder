// 公開リポジトリのため、秘密が紛れ込んでいないかを機械的に検査する(再発防止)。
// 見つかった場合も、値そのものは出力せず、ファイル名と種類だけを出す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !/\.(png|jpe?g|gif|ico|woff2?)$/i.test(f));

test('Google APIキー / Supabase secret / 秘密鍵 / service_role の JWT が含まれない', () => {
  const problems = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = f.slice(ROOT.length);
    if (/AIza[0-9A-Za-z_-]{30,}/.test(src)) problems.push(`${rel}: Google APIキー形式`);
    if (/sb_secret_[0-9A-Za-z_-]{10,}/.test(src)) problems.push(`${rel}: Supabase secret key 形式`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(src)) problems.push(`${rel}: 秘密鍵`);
    if (/\bgh[pousr]_[0-9A-Za-z]{30,}/.test(src)) problems.push(`${rel}: GitHubトークン形式`);
    for (const m of src.matchAll(/eyJ[\w-]{10,}\.([\w-]{10,})\.[\w-]{10,}/g)) {
      let role = '(解析不能)';
      try {
        role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role;
      } catch {
        /* JWT ではない */
      }
      if (role !== 'anon') problems.push(`${rel}: JWT (role=${role})`);
    }
  }
  assert.deepEqual(problems, []);
});
