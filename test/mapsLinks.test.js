import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectionsUrl, buildPlaceUrl, buildShareText, MAX_STOPS } from '../js/mapsLinks.js';
import { shareOrCopy } from '../js/share.js';

const PID = (n) => 'ChIJ' + String(n).padStart(20, 'x');
const stop = (i, withId = true) => ({ lat: 35 + i / 1000, lng: 139 + i / 1000, placeId: withId ? PID(i) : undefined });
const parse = (u) => new URL(u);

test('buildDirectionsUrl: 1 か所なら目的地のみ。出発地は省略(開いた端末の現在地が使われる)', () => {
  const r = buildDirectionsUrl({ stops: [stop(1)], travelMode: 'WALK' });
  const u = parse(r.url);
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('destination'), '35.001,139.001');
  assert.equal(u.searchParams.get('destination_place_id'), PID(1));
  assert.equal(u.searchParams.get('travelmode'), 'walking');
  assert.equal(u.searchParams.has('origin'), false);
  assert.equal(u.searchParams.has('waypoints'), false);
  assert.deepEqual([r.count, r.truncated], [1, false]);
});

test('buildDirectionsUrl: 複数地点は、最後が目的地・それ以前が経由地(回る順)', () => {
  const r = buildDirectionsUrl({ stops: [stop(1), stop(2), stop(3)], travelMode: 'TRANSIT' });
  const u = parse(r.url);
  assert.equal(u.searchParams.get('destination'), '35.003,139.003');
  assert.equal(u.searchParams.get('waypoints'), '35.001,139.001|35.002,139.002');
  assert.equal(u.searchParams.get('waypoint_place_ids'), `${PID(1)}|${PID(2)}`);
  assert.equal(u.searchParams.get('travelmode'), 'transit');
});

test('buildDirectionsUrl: 場所 ID が 1 つでも欠けていたら、場所 ID は付けない(対応のずれ防止)', () => {
  const r = buildDirectionsUrl({ stops: [stop(1), stop(2, false), stop(3)] });
  const u = parse(r.url);
  assert.equal(u.searchParams.has('destination_place_id'), false);
  assert.equal(u.searchParams.has('waypoint_place_ids'), false);
  assert.equal(u.searchParams.get('waypoints').split('|').length, 2);
});

test('buildDirectionsUrl: 経由地は最大 9 件(目的地込みで 10 か所)。超えたら切り捨てて truncated', () => {
  const stops = Array.from({ length: 13 }, (_, i) => stop(i + 1));
  const r = buildDirectionsUrl({ stops });
  assert.equal(r.count, MAX_STOPS);
  assert.equal(r.truncated, true);
  assert.equal(parse(r.url).searchParams.get('waypoints').split('|').length, 9);
  assert.equal(parse(r.url).searchParams.get('destination'), '35.01,139.01'); // 10 番目
});

test('buildDirectionsUrl: 不正な座標の地点は除外。有効な地点が無ければ null', () => {
  const r = buildDirectionsUrl({ stops: [{ lat: 999, lng: 0 }, stop(1), { lat: NaN, lng: 1 }, null] });
  assert.equal(r.count, 1);
  assert.equal(buildDirectionsUrl({ stops: [{ lat: 999, lng: 0 }] }), null);
  assert.equal(buildDirectionsUrl({ stops: [] }), null);
  assert.equal(buildDirectionsUrl({}), null);
});

test('buildDirectionsUrl: 出発地は指定されたときだけ入る(範囲外は無視)。未知の移動手段は付けない', () => {
  assert.equal(parse(buildDirectionsUrl({ stops: [stop(1)], origin: { lat: 13.7563, lng: 100.5018 } }).url).searchParams.get('origin'), '13.7563,100.5018');
  assert.equal(parse(buildDirectionsUrl({ stops: [stop(1)], origin: { lat: 999, lng: 1 } }).url).searchParams.has('origin'), false);
  assert.equal(parse(buildDirectionsUrl({ stops: [stop(1)], travelMode: 'FLY' }).url).searchParams.has('travelmode'), false);
});

test('buildDirectionsUrl: 場所 ID に不正な文字があれば無視(URL へ注入させない)', () => {
  const r = buildDirectionsUrl({ stops: [{ lat: 1, lng: 2, placeId: 'abc&evil=1#x' }] });
  const u = parse(r.url);
  assert.equal(u.searchParams.has('destination_place_id'), false);
  assert.equal(u.searchParams.has('evil'), false);
  assert.equal(u.hostname, 'www.google.com');
});

test('buildPlaceUrl: 名前と場所 ID。名前は検索語として安全にエンコードされる', () => {
  const u = parse(buildPlaceUrl({ lat: 35, lng: 139, placeId: PID(1), name: '浅草寺 & <b>x</b>' }));
  assert.equal(u.pathname, '/maps/search/');
  assert.equal(u.searchParams.get('query'), '浅草寺 & <b>x</b>');
  assert.equal(u.searchParams.get('query_place_id'), PID(1));
  assert.equal(u.hostname, 'www.google.com');
});

test('buildPlaceUrl: 名前が無ければ座標、どちらも無ければ null', () => {
  assert.equal(parse(buildPlaceUrl({ lat: 35.5, lng: 139.5 })).searchParams.get('query'), '35.5,139.5');
  assert.equal(buildPlaceUrl({}), null);
  assert.equal(buildPlaceUrl({ lat: 999, lng: 0 }), null);
});

test('buildShareText: 番号つきの一覧+URL。10 件まで、1 件 100 文字まで', () => {
  const text = buildShareText({ title: '行きたい場所', names: Array.from({ length: 12 }, (_, i) => 'あ'.repeat(150) + i), url: 'https://example.com/x' });
  const lines = text.split('\n');
  assert.equal(lines[0], '行きたい場所');
  assert.equal(lines.length, 1 + 10 + 1);
  assert.ok(lines[1].startsWith('1. ') && lines[1].length <= 3 + 100);
  assert.equal(lines.at(-1), 'https://example.com/x');
});

test('shareOrCopy: Web Share → クリップボード → 非対応 の順', async () => {
  const data = { title: 't', text: 'body', url: 'https://x.test/' };
  assert.equal(await shareOrCopy(data, { nav: { share: async () => {} } }), 'shared');
  assert.equal(await shareOrCopy(data, { nav: { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } } }), 'cancelled');
  let copied;
  const clipboard = { writeText: async (t) => { copied = t; } };
  assert.equal(await shareOrCopy(data, { nav: { clipboard } }), 'copied');
  assert.equal(copied, 'body');
  // share が失敗(AbortError 以外)したらクリップボードへ
  assert.equal(await shareOrCopy(data, { nav: { share: async () => { throw new Error('NotAllowed'); }, clipboard } }), 'copied');
  assert.equal(await shareOrCopy(data, { nav: {} }), 'unsupported');
  assert.equal(await shareOrCopy(data, { nav: { clipboard: { writeText: async () => { throw new Error('denied'); } } } }), 'unsupported');
});
