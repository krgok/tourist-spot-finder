// 画面の基本的なアクセシビリティを、HTML/CSS の静的検査で守る(実ブラウザでの axe-core 検査は PR に記載)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const hex = (h) => {
  const v = h.replace('#', '');
  const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const cssVar = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`))[1];
const WHITE = [255, 255, 255];

test('コントラスト比(WCAG AA 4.5:1)', () => {
  const rating = css.match(/\.place-rating\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/)[1];
  assert.ok(contrast(hex(rating), WHITE) >= 4.5, `評価の星 ${contrast(hex(rating), WHITE).toFixed(2)}`);
  assert.ok(contrast(hex(cssVar('text-secondary')), WHITE) >= 4.5, 'hint');
  assert.ok(contrast(hex(cssVar('text-secondary')), hex(cssVar('bg'))) >= 4.5, 'hint on bg');
  assert.ok(contrast(hex(cssVar('danger')), WHITE) >= 4.5, 'danger');
  assert.ok(contrast(WHITE, hex(cssVar('primary'))) >= 4.5, 'primary button');
  const success = css.match(/\.status-msg\.success\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/)[1];
  assert.ok(contrast(hex(success), WHITE) >= 4.5, 'success');
  // ヘッダーの設定ボタン: 半透明の黒をヘッダー色に重ねた背景に、白文字
  const alpha = Number(css.match(/\.btn-icon\s*\{\s*background:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/)[1]);
  const base = hex(cssVar('primary'));
  const blended = base.map((c) => Math.round(c * (1 - alpha)));
  assert.ok(contrast(WHITE, blended) >= 4.5, `設定ボタン ${contrast(WHITE, blended).toFixed(2)}`);
});

test('すべての入力・選択に、ラベルまたは aria-label がある', () => {
  // ラジオ・チェックボックスは <label> で囲んでいること(下で別に検査)
  const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter((m) => !/type="(radio|checkbox)"/.test(m[2]));
  assert.ok(controls.length >= 7);
  for (const m of controls) {
    const id = m[2].match(/\bid="([^"]+)"/)?.[1];
    const labelled = /aria-label=/.test(m[2]) || (id && new RegExp(`<label[^>]*for="${id}"`).test(html));
    assert.ok(labelled, `ラベルなし: ${m[0]}`);
  }
});

test('チェックボックス・ラジオは <label> に囲まれている', () => {
  const inputs = [...html.matchAll(/<input\b[^>]*type="(?:radio|checkbox)"[^>]*>/g)];
  assert.ok(inputs.length >= 5);
  for (const m of inputs) {
    const before = html.slice(0, m.index);
    const lastOpen = before.lastIndexOf('<label');
    const lastClose = before.lastIndexOf('</label>');
    assert.ok(lastOpen > lastClose, `label に囲まれていない: ${m[0]}`);
  }
});

test('ラベルだけで対象のない <label> がない(検索地点はグループ名として扱う)', () => {
  for (const m of html.matchAll(/<label(?![^>]*\bfor=)[^>]*>([\s\S]*?)<\/label>/g)) {
    assert.match(m[1], /<input/, `対象のない label: ${m[1].slice(0, 30)}`);
  }
  assert.match(html, /role="group" aria-labelledby="location-mode-label"/);
});

test('状態メッセージは読み上げ対象(role="status")、地図・結果にも名前がある', () => {
  for (const id of ['search-status', 'favorites-status', 'history-status', 'settings-status']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="status"`), id);
  }
  assert.match(html, /id="map"[^>]*aria-label="地図"/);
  assert.match(html, /<h2 class="visually-hidden">検索結果<\/h2>/); // 見出しの階層(h1→h2→h3)
  assert.match(html, /id="offline-banner"[^>]*role="status"/);
});

test('アイコンだけ/曖昧なボタンに名前がある。画像の alt は装飾なら空', () => {
  assert.match(html, /id="close-settings-btn"[^>]*aria-label="閉じる"/);
  assert.match(html, /id="user-avatar"[^>]*alt=""/);
});

test('カード内の操作はボタンでも可能(キーボード操作)', () => {
  const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /地図で見る/);
  assert.match(ui, /aria-pressed/);
});

test('モバイル(375px)向けの CSS がある(折り返し・タップ領域・入れ子スクロールの解除)', () => {
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*flex-wrap: wrap/);
  assert.match(css, /min-height: 40px/);
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.results-list \{ max-height: none/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
