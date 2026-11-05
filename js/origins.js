// よく使う起点(ホテル・自宅など)の保存データを扱う純粋関数。
// 保存先はこの端末の localStorage のみ(Supabase などには送らない)。自宅の座標になりうるため。

export const ORIGIN_LIMITS = { max: 10, nameMax: 40 };
export const ORIGINS_STORAGE_KEY = 'tourist-app.savedOrigins';

const isCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// 小数 5 桁(約 1m)に丸める。必要以上に精密な位置を持たない。
const round5 = (n) => Math.round(n * 1e5) / 1e5;

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, ORIGIN_LIMITS.nameMax) : '';
}

// 保存された文字列を読み込む。壊れている/想定外の形なら、その要素・全体を捨てる(例外にしない)。
export function parseStoredOrigins(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const out = [];
  for (const item of data) {
    const name = cleanName(item?.name);
    const id = typeof item?.id === 'string' && /^[\w-]{1,40}$/.test(item.id) ? item.id : null;
    if (!name || !id || seen.has(id) || !isCoord(item.lat, item.lng)) continue;
    seen.add(id);
    out.push({ id, name, lat: round5(item.lat), lng: round5(item.lng) });
    if (out.length >= ORIGIN_LIMITS.max) break;
  }
  return out;
}

export function serializeOrigins(list) {
  return JSON.stringify(list);
}

// 追加。戻り値: { ok: true, list } か { ok: false, error }
export function addOrigin(list, { name, lat, lng }, { idGen = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36) } = {}) {
  const cleaned = cleanName(name);
  if (!cleaned) return { ok: false, error: '名前を入力してください。' };
  if (!isCoord(lat, lng)) return { ok: false, error: '位置が正しくありません。先に検索して、地点を確定してください。' };
  if (list.some((o) => o.name === cleaned)) return { ok: false, error: `「${cleaned}」はすでに保存されています。別の名前にしてください。` };
  if (list.length >= ORIGIN_LIMITS.max) return { ok: false, error: `保存できるのは${ORIGIN_LIMITS.max}件までです。不要なものを削除してください。` };
  const id = String(idGen()).replace(/[^\w-]/g, '').slice(0, 40) || 'o' + Date.now().toString(36);
  return { ok: true, list: [...list, { id, name: cleaned, lat: round5(lat), lng: round5(lng) }] };
}

export function removeOrigin(list, id) {
  return list.filter((o) => o.id !== id);
}
