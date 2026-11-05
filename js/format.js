// 表示用の整形(DOMに依存しない純粋関数)。

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}時間${remainMinutes}分`;
}
