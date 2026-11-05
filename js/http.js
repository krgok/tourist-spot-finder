// Google の各 API(Places / Routes)への通信の共通部品。
// - タイムアウトを必ず付ける(以前は無期限に待ち続けることがあった)
// - HTTP エラー・通信失敗・オフラインを、利用者が次に何をすればよいか分かる日本語にする
// - エラー文に API キーが混ざらないようにする(Google のメッセージ中のキーは伏せる)

export const DEFAULT_TIMEOUT_MS = 15000;

function truncate(text, max = 200) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function redact(text, apiKey) {
  let out = String(text ?? '');
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('***');
  return truncate(out);
}

export function describeHttpError(status, apiLabel, serverMessage = '') {
  const detail = serverMessage ? `(${serverMessage})` : '';
  if (status === 400) return `リクエストが正しくありません [${apiLabel}]${detail}`;
  if (status === 401) return `APIキーが認識されませんでした。設定を確認してください。${detail}`;
  if (status === 403) {
    return (
      `APIキーが無効か、${apiLabel} が有効化されていません。キーの制限(HTTPリファラー・APIの制限)に` +
      `このサイトのURLと${apiLabel}が含まれているかも確認してください。${detail}`
    );
  }
  if (status === 404) return `${apiLabel} が見つかりませんでした。${detail}`;
  if (status === 429) {
    return `APIの利用上限(クォータ)に達したか、短時間にリクエストが集中しました。しばらく待ってから再試行してください。${detail}`;
  }
  if (status >= 500) return `Google のサーバーで一時的な問題が発生しています(HTTP ${status})。しばらくしてから再試行してください。`;
  return serverMessage || `${apiLabel} の呼び出しに失敗しました (HTTP ${status})`;
}

export function describeNetworkError(err, online = globalThis.navigator?.onLine) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return '通信がタイムアウトしました。電波の良い場所でもう一度お試しください。';
  }
  if (online === false) return 'インターネットに接続されていません。接続を確認してからもう一度お試しください。';
  return '通信に失敗しました。ネットワーク接続や、広告ブロッカー等のブラウザ拡張機能を確認してください。';
}

// JSON を返す Google API を POST で呼ぶ。失敗時は利用者向けメッセージの Error を投げる。
export async function postGoogleApi({
  url,
  apiKey,
  fieldMask,
  body,
  apiLabel,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(describeNetworkError(err));
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const serverMessage = redact(errBody?.error?.message, apiKey);
    throw new Error(describeHttpError(response.status, apiLabel, serverMessage));
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${apiLabel} から想定外の応答が返りました。しばらくしてから再試行してください。`);
  }
}
