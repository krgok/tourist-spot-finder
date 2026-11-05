// 営業中かどうかの判定と表示用の整形(DOM・通信に依存しない純粋関数)。
// 判定は Google が返す currentOpeningHours.openNow を使う(リクエスト時点の営業状況)。
// 時刻は「その場所の現地時間」で表示する(utcOffsetMinutes で換算。バンコクの家族が日本の場所を見るときなど、
// 端末のタイムゾーンと場所のタイムゾーンが違っても正しく表示するため)。

const pad = (n) => String(n).padStart(2, '0');

// ISO 8601 の時刻文字列を、指定のオフセット(分)の現地時刻に換算して { date: 'M/D', time: 'HH:mm', ymd } を返す。
export function toPlaceLocal(iso, offsetMinutes) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || typeof offsetMinutes !== 'number' || !Number.isFinite(offsetMinutes)) return null;
  const d = new Date(ms + offsetMinutes * 60000);
  return {
    date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
  };
}

// 戻り値: { state: 'open' | 'closed' | 'unknown', detail: string }
export function openStatus(place, { now = Date.now() } = {}) {
  const hours = place?.currentOpeningHours ?? place?.regularOpeningHours;
  const openNow = hours?.openNow;
  if (typeof openNow !== 'boolean') return { state: 'unknown', detail: '' };
  const offset = place?.utcOffsetMinutes;

  if (openNow) {
    const close = toPlaceLocal(hours.nextCloseTime, offset);
    if (!close) return { state: 'open', detail: '' };
    const today = toPlaceLocal(new Date(now).toISOString(), offset);
    const sameDay = today && close.ymd === today.ymd;
    return { state: 'open', detail: `${sameDay ? '' : close.date + ' '}${close.time}まで` };
  }
  const open = toPlaceLocal(hours.nextOpenTime, offset);
  if (!open) return { state: 'closed', detail: '' };
  const today = toPlaceLocal(new Date(now).toISOString(), offset);
  const sameDay = today && open.ymd === today.ymd;
  return { state: 'closed', detail: `${sameDay ? '' : open.date + ' '}${open.time}から` };
}

export const OPEN_STATE_LABELS = { open: '営業中', closed: '営業時間外' };

// 営業時間外だと分かっている場所だけを除く(営業時間が不明な場所は残す)
export function filterOpenNow(places, opts) {
  return places.filter((p) => openStatus(p, opts).state !== 'closed');
}
