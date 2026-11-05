// 外部から来た文字列(Google Places の websiteUri / googleMapsUri、Wikipedia の URL、
// Google アカウントのアバター等)を、href / src に入れてよい形か検査する。
// javascript: や data: などの危険なスキームを弾くのが目的。

// http / https のみ許可。許可できれば正規化した URL 文字列、だめなら null。
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

// https のみ許可(画像など、通信が盗み見・改ざんされると困るもの用)。
export function safeHttpsUrl(value) {
  const href = safeHttpUrl(value);
  return href && href.startsWith('https:') ? href : null;
}

// 外部リンクを作る。許可できない URL なら null を返す(呼び出し側はリンクを出さない)。
export function createExternalLink(href, label) {
  const safe = safeHttpUrl(href);
  if (!safe) return null;
  const a = document.createElement('a');
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  return a;
}
