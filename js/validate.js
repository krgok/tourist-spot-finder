// 入力値の検査(DOMに依存しない純粋関数)。

// Google の API キーは通常 "AIza" で始まる 39 文字([A-Za-z0-9_-])。
// 形式が違っても Google 側が仕様を変える可能性があるため、AIza 形式でないだけなら警告に留め、
// URL やヘッダーに入れると壊れる/注入になりうる文字を含む場合だけ拒否する。
export function checkApiKeyFormat(raw) {
  const key = (raw ?? '').trim();
  if (!key) return { ok: false, level: 'error', message: 'APIキーを入力してください。' };
  if (key.length > 128 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return {
      ok: false,
      level: 'error',
      message: 'APIキーに使えない文字が含まれています(英数字・ハイフン・アンダースコアのみ)。コピーし直してください。',
    };
  }
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) {
    return { ok: true, level: 'warning', key, message: 'キーの形式が通常(AIza で始まる39文字)と異なります。間違いがないか確認してください。' };
  }
  return { ok: true, level: 'ok', key };
}

export function isValidLatLng(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}
