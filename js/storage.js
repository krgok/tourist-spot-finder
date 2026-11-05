// localStorage の安全な読み書き。プライベートブラウズやサイトデータのブロック時は
// localStorage へのアクセス自体が例外になるため、握りつぶしてメモリ上の値で代替する
// (以前は読み込み時の例外でアプリ全体が起動しなかった)。

const memory = new Map();

function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function storageGet(key) {
  try {
    const value = getStorage()?.getItem(key);
    if (value != null) return value;
  } catch {
    /* 使えない環境 */
  }
  return memory.has(key) ? memory.get(key) : null;
}

// 戻り値: 永続化できたか(false ならこのタブを閉じると消える)
export function storageSet(key, value) {
  memory.set(key, String(value));
  try {
    const s = getStorage();
    if (!s) return false;
    s.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key) {
  memory.delete(key);
  try {
    getStorage()?.removeItem(key);
  } catch {
    /* 使えない環境 */
  }
}
