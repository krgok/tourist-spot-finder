// Google の各 API(Places / Routes)への通信の共通部品。
// - タイムアウトを必ず付ける(以前は無期限に待ち続けることがあった)
// - HTTP エラー・通信失敗・オフラインを、利用者が次に何をすればよいか分かる日本語にする
// - エラー文に API キーが混ざらないようにする(Google のメッセージ中のキーは伏せる)

export const DEFAULT_TIMEOUT_MS = 15000;

// タイムアウト付きの AbortSignal。AbortSignal.timeout が無い環境(iOS 15 以前の Safari など)では、
// 呼ぶだけで TypeError になり、すべての通信が「通信に失敗しました」になってしまうため、
// AbortController + setTimeout で代替する。clear() は必ず finally で呼ぶ(タイマーを残さない)。
// 別の signal(parent)を渡すと、それが中断されたときも中断する。
// タイムアウト時の理由は name が 'TimeoutError'(describeNetworkError が「タイムアウト」と分類する)。
export function timeoutSignal(ms, parent = null) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(ms);
    const signal = parent && typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, parent]) : timeout;
    return { signal, clear() {} };
  }
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    let reason;
    try {
      reason = new DOMException('The operation timed out.', 'TimeoutError');
    } catch {
      reason = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    }
    controller.abort(reason);
  }, ms);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

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
  const timer = timeoutSignal(timeoutMs);
  try {
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
        signal: timer.signal,
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
  } finally {
    timer.clear();
  }
}

// ---- サーバー側の中継(Supabase Edge Function)経由の呼び出し ----
// キーはサーバー側にあるため、ブラウザからは Supabase のログイン(JWT)だけを送る。

export function describeProxyError(status, serverMessage = '') {
  const detail = serverMessage ? `(${serverMessage})` : '';
  if (status === 401) return `ログインが必要です。ログインし直してください。${detail}`;
  if (status === 403) return `このアカウントには、検索機能(サーバー経由)の利用が許可されていません。${detail}`;
  if (status === 413 || status === 400) return `リクエストが正しくありません。${detail}`;
  if (status === 429) return `利用上限に達したか、短時間に操作が集中しました。しばらく待ってから再試行してください。${detail}`;
  if (status >= 500) return `サーバー側で問題が発生しました。${serverMessage || 'しばらくしてから再試行してください。'}`;
  return serverMessage || `サーバーとの通信に失敗しました (HTTP ${status})`;
}

export async function postProxy({ url, getToken, payload, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch }) {
  const token = await getToken?.();
  if (!token) throw new Error('ログインが必要です。ログインしてから、もう一度お試しください。');
  const timer = timeoutSignal(timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: timer.signal,
      });
    } catch (err) {
      throw new Error(describeNetworkError(err));
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(describeProxyError(response.status, truncate(body?.error?.message)));
    }
    try {
      return await response.json();
    } catch {
      throw new Error('サーバーから想定外の応答が返りました。しばらくしてから再試行してください。');
    }
  } finally {
    timer.clear();
  }
}
