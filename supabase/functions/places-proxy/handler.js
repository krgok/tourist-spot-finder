// Google Places / Routes API への中継(Supabase Edge Function の本体)。
// Deno 固有の API には依存しない純粋なハンドラー(Node でテストできる)。index.ts から呼ばれる。
//
// 目的: Google の API キーをブラウザに置かずに済ませる。キーはサーバー側の秘密(環境変数)にだけ置く。
// - ログイン済み(Supabase の JWT をサーバー側で検証済み)の利用者だけが呼べる
// - 任意で、許可する利用者(ALLOWED_USER_IDS)を家族だけに絞れる
// - 呼べる操作・フィールド・件数・半径はサーバー側で固定/制限する(クライアントは課金の大きい項目を要求できない)
// - エラー文にキーが混ざらない。キーはログにも出さない
//
// 環境変数(Supabase の secrets。リポジトリには書かない):
//   GOOGLE_MAPS_SERVER_KEY  必須。Places API (New) と Routes API だけに制限した、サーバー用のキー
//   ALLOWED_ORIGIN          必須。このアプリを配信する URL の origin(カンマ区切りで複数可)。例: https://example.github.io
//   ALLOWED_USER_IDS        推奨。呼び出しを許可する利用者の ID(auth.users.id)のカンマ区切り。未設定なら、ログイン済みの全員
//   RATE_LIMIT_PER_MIN      任意。1 人あたり 1 分の上限(既定 30)。※ 実行環境ごとのメモリ上の制限(ベストエフォート)

// クライアント(js/config.js の PLACE_FIELD_MASK)と同じ内容。ずれないことはテストで検査する。
export const PLACE_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.rating',
  'places.userRatingCount', 'places.editorialSummary', 'places.reviews', 'places.websiteUri',
  'places.googleMapsUri', 'places.photos', 'places.types', 'places.primaryType',
  'places.primaryTypeDisplayName', 'places.regularOpeningHours', 'places.currentOpeningHours',
  'places.utcOffsetMinutes', 'places.priceLevel', 'places.businessStatus',
].join(',');
const SEARCH_TEXT_FIELD_MASK = 'places.location,places.formattedAddress,places.displayName';
const ROUTES_FIELD_MASK = 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration';

const MAX_BODY_BYTES = 8192;
const MAX_RADIUS_METERS = 10000;
const FETCH_POOL_SIZE = 20;
const UPSTREAM_TIMEOUT_MS = 15000;
const LANGS = new Set(['ja', 'en', 'th']);
const REGIONS = new Set(['JP', 'TH']);
const TRAVEL_MODES = new Set(['WALK', 'DRIVE', 'BICYCLE', 'TRANSIT']);
const TYPE_RE = /^[a-z][a-z_]{1,49}$/;
const PHOTO_NAME_RE = /^places\/[\w-]+\/photos\/[\w-]+$/;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// ---- 1 人あたりの呼び出し回数の制限(メモリ上・ベストエフォート) ----
export function createRateLimiter({ limit = 30, windowMs = 60000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    // 許可なら true
    take(key) {
      const t = now();
      const recent = (hits.get(key) || []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
      return true;
    },
  };
}

// ---- 操作ごとの検証と、Google への要求の組み立て(フィールドマスク等はサーバー側で固定) ----
export function buildUpstream(op, p) {
  switch (op) {
    case 'searchNearby': {
      if (!isCoord(p.lat, p.lng)) throw new HttpError(400, 'BAD_REQUEST', '緯度・経度が正しくありません。');
      const radius = Number(p.radiusMeters);
      if (!Number.isFinite(radius) || radius < 100 || radius > MAX_RADIUS_METERS) {
        throw new HttpError(400, 'BAD_REQUEST', `半径は 100〜${MAX_RADIUS_METERS}m で指定してください。`);
      }
      const types = p.genreTypes;
      if (!Array.isArray(types) || types.length < 1 || types.length > 6 || !types.every((t) => typeof t === 'string' && TYPE_RE.test(t))) {
        throw new HttpError(400, 'BAD_REQUEST', 'ジャンルの指定が正しくありません。');
      }
      const body = {
        includedPrimaryTypes: types,
        maxResultCount: FETCH_POOL_SIZE,
        rankPreference: 'POPULARITY',
        languageCode: LANGS.has(p.language) ? p.language : 'ja',
        locationRestriction: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius } },
      };
      if (REGIONS.has(p.region)) body.regionCode = p.region;
      return { url: 'https://places.googleapis.com/v1/places:searchNearby', method: 'POST', fieldMask: PLACE_FIELD_MASK, body };
    }
    case 'searchText': {
      const q = typeof p.query === 'string' ? p.query.trim() : '';
      if (!q || q.length > 200) throw new HttpError(400, 'BAD_REQUEST', '検索語は 1〜200 文字で指定してください。');
      return {
        url: 'https://places.googleapis.com/v1/places:searchText',
        method: 'POST',
        fieldMask: SEARCH_TEXT_FIELD_MASK,
        body: { textQuery: q, languageCode: LANGS.has(p.language) ? p.language : 'ja', maxResultCount: 1 },
      };
    }
    case 'computeRoutes': {
      const o = p.origin;
      const d = p.destination;
      if (!isCoord(o?.lat, o?.lng) || !isCoord(d?.lat, d?.lng)) throw new HttpError(400, 'BAD_REQUEST', '出発地または目的地の位置が正しくありません。');
      if (!TRAVEL_MODES.has(p.travelMode)) throw new HttpError(400, 'BAD_REQUEST', '移動手段が正しくありません。');
      return {
        url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
        method: 'POST',
        fieldMask: ROUTES_FIELD_MASK,
        body: {
          origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
          destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
          travelMode: p.travelMode,
        },
      };
    }
    case 'photo': {
      if (typeof p.name !== 'string' || !PHOTO_NAME_RE.test(p.name)) throw new HttpError(400, 'BAD_REQUEST', '写真の指定が正しくありません。');
      const w = Math.min(Math.max(Math.round(Number(p.maxWidthPx)) || 240, 1), 800);
      // skipHttpRedirect=true: 画像そのものではなく、キーを含まない画像の URL(photoUri)を JSON で返させる
      return { url: `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=${w}&skipHttpRedirect=true`, method: 'GET', fieldMask: null, body: null };
    }
    default:
      throw new HttpError(400, 'BAD_REQUEST', '未対応の操作です。');
  }
}

function redact(text, key) {
  let out = String(text ?? '');
  if (key && key.length >= 8) out = out.split(key).join('***');
  return out.length > 300 ? out.slice(0, 300) + '…' : out;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function respond(status, payload, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(origin ? corsHeaders(origin) : {}) };
  return new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
}

// RATE_LIMIT_PER_MIN ごとに 1 つのリミッターを使い回す(実行環境のメモリ上)
const limiters = new Map();
function limiterFor(env) {
  const n = Number(env.RATE_LIMIT_PER_MIN);
  const limit = Number.isInteger(n) && n >= 1 && n <= 600 ? n : 30;
  if (!limiters.has(limit)) limiters.set(limit, createRateLimiter({ limit }));
  return limiters.get(limit);
}

/**
 * @param {Request} request
 * @param {{ env: Record<string,string|undefined>, getUser: (jwt: string) => Promise<{id?: string}|null>,
 *           fetchImpl?: typeof fetch, rateLimiter?: ReturnType<typeof createRateLimiter> }} deps
 */
export async function handleRequest(request, { env, getUser, fetchImpl = globalThis.fetch, rateLimiter }) {
  const origin = request.headers.get('origin');
  const origins = allowedOrigins(env);
  if (!origins.length) return respond(500, { error: { code: 'NOT_CONFIGURED', message: 'サーバーの設定(ALLOWED_ORIGIN)が未完了です。' } }, null);

  // ブラウザ(許可した配信元)以外からの呼び出しは受け付けない
  if (!origin || !origins.includes(origin)) return respond(403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: '許可されていない配信元です。' } }, null);

  if (request.method === 'OPTIONS') return respond(204, null, origin);
  if (request.method !== 'POST') return respond(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST のみ対応しています。' } }, origin);

  try {
    // 認証(JWT はサーバー側で検証する。anon キーのトークンは user を持たないので不可)
    const auth = request.headers.get('authorization') || '';
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'ログインが必要です。');
    let user = null;
    try {
      user = await getUser(token);
    } catch {
      user = null;
    }
    if (!user?.id) throw new HttpError(401, 'UNAUTHENTICATED', 'ログインの有効期限が切れました。ログインし直してください。');

    const allow = String(env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length && !allow.includes(user.id)) {
      throw new HttpError(403, 'USER_NOT_ALLOWED', 'このアカウントには、この機能の利用が許可されていません。');
    }

    const limiter = rateLimiter || limiterFor(env);
    if (!limiter.take(user.id)) throw new HttpError(429, 'RATE_LIMITED', '短時間に操作が集中しました。しばらく待ってから再試行してください。');

    const key = env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) throw new HttpError(500, 'NOT_CONFIGURED', 'サーバーの設定(Google の API キー)が未完了です。');

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new HttpError(413, 'TOO_LARGE', 'リクエストが大きすぎます。');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'リクエストの形式が正しくありません。');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'BAD_REQUEST', 'リクエストの形式が正しくありません。');

    const up = buildUpstream(payload.op, payload);
    const headers = { 'X-Goog-Api-Key': key };
    if (up.body) headers['Content-Type'] = 'application/json';
    if (up.fieldMask) headers['X-Goog-FieldMask'] = up.fieldMask;

    let res;
    try {
      res = await fetchImpl(up.url, {
        method: up.method,
        headers,
        body: up.body ? JSON.stringify(up.body) : undefined,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(504, 'UPSTREAM_UNREACHABLE', 'Google への通信に失敗しました。しばらくしてから再試行してください。');
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const message = redact(errBody?.error?.message, key);
      // 400(タイプ名の誤りなど)と 429 は、そのまま利用者に分かるように返す。
      // 401/403 は「サーバー側のキーの設定」の問題で、利用者のログインの問題ではない。
      if (res.status === 400) throw new HttpError(400, 'UPSTREAM_BAD_REQUEST', message || 'Google がリクエストを受け付けませんでした。');
      if (res.status === 429) throw new HttpError(429, 'UPSTREAM_QUOTA', 'Google の利用上限(クォータ)に達しました。しばらく待ってから再試行してください。');
      if (res.status === 401 || res.status === 403) throw new HttpError(502, 'UPSTREAM_AUTH', 'サーバー側の Google API キーの設定(有効な API・制限)を確認してください。');
      throw new HttpError(502, 'UPSTREAM_ERROR', 'Google のサーバーで一時的な問題が発生しています。');
    }

    const data = await res.json().catch(() => null);
    if (data === null) throw new HttpError(502, 'UPSTREAM_ERROR', 'Google から想定外の応答が返りました。');

    if (payload.op === 'photo') {
      // 画像の URL は、Google の画像配信ホストの https のみ返す
      let photoUri = null;
      try {
        const u = new URL(data.photoUri);
        if (u.protocol === 'https:' && /(^|\.)(googleusercontent|ggpht)\.com$/.test(u.hostname)) photoUri = u.href;
      } catch {
        /* 不正 */
      }
      if (!photoUri) throw new HttpError(502, 'UPSTREAM_ERROR', '写真の URL を取得できませんでした。');
      return respond(200, { photoUri }, origin);
    }
    return respond(200, data, origin);
  } catch (err) {
    if (err instanceof HttpError) return respond(err.status, { error: { code: err.code, message: err.message } }, origin);
    // 想定外の例外: 詳細(キーを含みうる)は返さない・ログにも出さない
    return respond(500, { error: { code: 'INTERNAL', message: 'サーバーでエラーが発生しました。' } }, origin);
  }
}
