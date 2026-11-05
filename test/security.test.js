import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { safeHttpUrl, safeHttpsUrl } from '../js/safeUrl.js';
import { checkApiKeyFormat, isValidLatLng } from '../js/validate.js';
import { buildPhotoUrl } from '../js/places.js';
import { SUPABASE_URL } from '../js/config.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const jsFiles = readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'));

test('safeHttpUrl: http(s) のみ許可し、javascript: / data: / file: などは拒否', () => {
  assert.equal(safeHttpUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(safeHttpUrl('  https://example.com  '), 'https://example.com/');
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    'example.com',
    '',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(safeHttpUrl(bad), null, String(bad));
  }
});

test('safeHttpUrl: 長すぎる URL は拒否', () => {
  assert.equal(safeHttpUrl('https://example.com/' + 'a'.repeat(2100)), null);
});

test('safeHttpsUrl: http は拒否', () => {
  assert.equal(safeHttpsUrl('http://example.com/a.png'), null);
  assert.equal(safeHttpsUrl('https://lh3.googleusercontent.com/a.png'), 'https://lh3.googleusercontent.com/a.png');
});

test('checkApiKeyFormat: 通常のキー形式は ok、形式違いは警告、危険な文字は拒否', () => {
  const good = 'AIza' + 'a'.repeat(35);
  assert.deepEqual(checkApiKeyFormat(` ${good} `), { ok: true, level: 'ok', key: good });
  assert.equal(checkApiKeyFormat('short-but-safe_key').level, 'warning');
  assert.equal(checkApiKeyFormat('').ok, false);
  assert.equal(checkApiKeyFormat(undefined).ok, false);
  for (const bad of ['abc&key=x', 'abc def', 'abc\nX-Evil: 1', 'キー', 'a'.repeat(129), 'abc#frag', 'abc/../x']) {
    assert.equal(checkApiKeyFormat(bad).ok, false, bad);
  }
});

test('isValidLatLng: 範囲と型', () => {
  assert.equal(isValidLatLng(35, 139), true);
  assert.equal(isValidLatLng(90, 180), true);
  assert.equal(isValidLatLng(-90, -180), true);
  assert.equal(isValidLatLng(90.0001, 0), false);
  assert.equal(isValidLatLng(0, 180.0001), false);
  assert.equal(isValidLatLng(NaN, 0), false);
  assert.equal(isValidLatLng('35', '139'), false);
  assert.equal(isValidLatLng(null, null), false);
});

test('buildPhotoUrl: 正しい形式の photo.name のみ。キーはエンコードされる', () => {
  const photo = { name: 'places/ChIJabc-123/photos/AUy_1-x' };
  assert.equal(
    buildPhotoUrl(photo, 'AIzaKEY', 240),
    'https://places.googleapis.com/v1/places/ChIJabc-123/photos/AUy_1-x/media?maxWidthPx=240&key=AIzaKEY'
  );
  assert.ok(buildPhotoUrl(photo, 'a&b=c#d').includes('key=a%26b%3Dc%23d'));
  assert.equal(buildPhotoUrl({ name: 'places/x/photos/../../../evil' }, 'k'), null);
  assert.equal(buildPhotoUrl({ name: 'https://evil.example/x' }, 'k'), null);
  assert.equal(buildPhotoUrl(undefined, 'k'), null);
  assert.equal(buildPhotoUrl(photo, ''), null);
  assert.ok(buildPhotoUrl(photo, 'k', 99999).includes('maxWidthPx=1600'));
});

test('js/ に innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function を使わない', () => {
  const banned = /\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/;
  for (const f of jsFiles) {
    const src = read('../js/' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, banned, f);
  }
});

test('map.js: 情報ウィンドウに外部由来の文字列を HTML として渡さない', () => {
  assert.doesNotMatch(read('../js/map.js'), /setContent\(\s*`/);
});

test('外部リンクは createExternalLink(http(s)限定 + noopener noreferrer)経由のみ', () => {
  const ui = read('../js/ui.js');
  assert.doesNotMatch(ui, /\.href\s*=/);
  assert.match(read('../js/safeUrl.js'), /rel = 'noopener noreferrer'/);
});

test('CSP: index.html に設定があり、script に unsafe-inline / unsafe-eval を使わない', () => {
  const html = read('../index.html');
  const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'CSP meta がない');
  const directives = Object.fromEntries(
    m[1].split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v])
  );
  assert.ok(directives['script-src'].includes("'self'"));
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.ok(!directives['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  // connect-src は、このアプリの Supabase プロジェクトのホストだけ(ワイルドカード *.supabase.co は不可)
  const supabaseHost = new URL(SUPABASE_URL).origin;
  assert.ok(directives['connect-src'].includes(supabaseHost), 'config.js の SUPABASE_URL と CSP が不一致');
  assert.ok(!directives['connect-src'].some((s) => s.includes('*.supabase.co')));
  assert.ok(!directives['connect-src'].includes('*'));
  assert.ok(!directives['default-src'].includes('*'));
});

test('外部CDNの import は完全固定バージョン(@2 のような浮動指定は不可)', () => {
  const src = read('../js/supabaseClient.js');
  const m = src.match(/from '(https:\/\/esm\.sh\/[^']+)'/);
  assert.ok(m, 'esm.sh からの import が見つからない');
  assert.match(m[1], /@\d+\.\d+\.\d+$/, m[1]);
});

test('設定ダイアログに、APIキーの制限(HTTPリファラー・APIの制限)の案内がある', () => {
  const html = read('../index.html');
  assert.match(html, /HTTPリファラー/);
  assert.match(html, /割り当て/);
  assert.match(html, /localStorage に平文/);
});
