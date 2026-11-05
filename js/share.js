// 共有(Web Share API → クリップボード → 手動コピーの順で試す)。
// 戻り値: 'shared' | 'copied' | 'cancelled' | 'unsupported'
export async function shareOrCopy({ title, text, url }, { nav = globalThis.navigator } = {}) {
  if (typeof nav?.share === 'function') {
    try {
      await nav.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'; // 利用者が閉じた
      // それ以外(非対応・権限など)はクリップボードへフォールバック
    }
  }
  if (typeof nav?.clipboard?.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text || url);
      return 'copied';
    } catch {
      /* 権限なし */
    }
  }
  return 'unsupported';
}
