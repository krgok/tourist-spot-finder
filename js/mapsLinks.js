// Google マップ(アプリ/Web)で開くための URL を組み立てる(通信なし・API 課金なし)。
// 仕様: Google Maps URLs (https://www.google.com/maps/dir/?api=1&...)
// - 経由地は最大 9 件(目的地を含めて 10 か所)。超える分は切り捨て、truncated で知らせる。
// - 出発地(origin)は、指定されたときだけ入れる。省略すると、開いた端末の現在地が出発地になる
//   (共有リンクに自分の現在地を入れないため、既定は省略)。
import { isValidLatLng } from './validate.js?v=20260708-4';

export const MAX_STOPS = 10; // 経由地 9 + 目的地 1

const TRAVEL_MODES = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', TRANSIT: 'transit' };
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;
const BASE = 'https://www.google.com/maps';

// 小数 6 桁(約 0.1m)に丸める。末尾の 0 は付けない。
function coord(p) {
  return `${Number(p.lat.toFixed(6))},${Number(p.lng.toFixed(6))}`;
}

function normalizeStop(stop) {
  const lat = stop?.lat;
  const lng = stop?.lng;
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng, placeId: PLACE_ID_RE.test(stop.placeId ?? '') ? stop.placeId : null };
}

// stops: [{ lat, lng, placeId? }, ...](回る順)。最後が目的地、それ以前が経由地。
// 戻り値: { url, count, truncated } / 有効な地点が無ければ null
export function buildDirectionsUrl({ stops, origin = null, travelMode = 'WALK' }) {
  const valid = (stops || []).map(normalizeStop).filter(Boolean);
  if (!valid.length) return null;
  const truncated = valid.length > MAX_STOPS;
  const used = valid.slice(0, MAX_STOPS);
  const destination = used[used.length - 1];
  const waypoints = used.slice(0, -1);

  const params = new URLSearchParams({ api: '1', destination: coord(destination) });
  if (waypoints.length) params.set('waypoints', waypoints.map(coord).join('|'));
  // 場所 ID は、すべての地点で揃っているときだけ付ける(部分的だと対応がずれるため)
  if (used.every((s) => s.placeId)) {
    params.set('destination_place_id', destination.placeId);
    if (waypoints.length) params.set('waypoint_place_ids', waypoints.map((w) => w.placeId).join('|'));
  }
  const o = normalizeStop(origin);
  if (o) params.set('origin', coord(o));
  if (TRAVEL_MODES[travelMode]) params.set('travelmode', TRAVEL_MODES[travelMode]);

  return { url: `${BASE}/dir/?${params}`, count: used.length, truncated };
}

// 1 か所を Google マップで開く(名前があれば検索語に使う)
export function buildPlaceUrl({ lat, lng, placeId, name }) {
  const hasCoord = isValidLatLng(lat, lng);
  const label = typeof name === 'string' ? name.trim().slice(0, 200) : '';
  if (!hasCoord && !label) return null;
  const params = new URLSearchParams({ api: '1', query: label || coord({ lat, lng }) });
  if (PLACE_ID_RE.test(placeId ?? '')) params.set('query_place_id', placeId);
  return `${BASE}/search/?${params}`;
}

// 共有する文面(施設名は外部由来の文字列なので、長さを制限するだけで加工しない)
export function buildShareText({ title, names, url }) {
  const list = (names || []).slice(0, MAX_STOPS).map((n, i) => `${i + 1}. ${String(n).slice(0, 100)}`);
  return [title, ...list, url].filter(Boolean).join('\n');
}
