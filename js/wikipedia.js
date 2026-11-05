import { getPreferredLanguageCode } from './config.js?v=20260708-4';
import { isValidLatLng } from './validate.js?v=20260708-4';

const WIKIPEDIA_TIMEOUT_MS = 5000;

// 名前だけでの全文検索(旧実装)は、同じカテゴリの単語(「博物館」「公園」等)が
// 一致するだけで全く無関係な記事(例: 海外の場所の説明文に別大陸の施設の記事)を
// 誤って採用してしまう事故が起きていた。位置情報(緯度経度)による近傍検索で
// 「実際にその場所の近くにある記事か」を確認できた場合のみ採用する。
const GEO_RADIUS_METERS = 500;
const STRONG_MATCH_DISTANCE_METERS = 150;
const MIN_NAME_SIMILARITY = 0.3;

function normalizeForCompare(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[\s　()（）「」『』・,、。.]/g, '');
}

// 文字ベースの簡易類似度(0〜1)。多言語表記の揺れがあっても、部分一致や
// 文字集合の重なりである程度の判定ができるようにする厳密な形態素解析ではない。
export function nameSimilarity(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  let common = 0;
  const setB = new Set(nb);
  for (const ch of na) {
    if (setB.has(ch)) common += 1;
  }
  return common / Math.max(na.length, nb.length);
}

async function geosearchWikipedia(lang, lat, lng, fetchImpl = fetch) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=${GEO_RADIUS_METERS}&gslimit=10&format=json&origin=*`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.query?.geosearch || [];
  } catch {
    return [];
  }
}

async function fetchExtractByTitle(lang, title, fetchImpl = fetch) {
  const extractUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(
    title
  )}&format=json&origin=*`;
  try {
    const extractRes = await fetchImpl(extractUrl, { signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS) });
    if (!extractRes.ok) return null;
    const extractData = await extractRes.json();
    const pages = extractData?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    const extract = page?.extract?.trim();
    if (!extract) return null;

    return {
      title,
      extract,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };
  } catch {
    // Wikipedia は補足情報にすぎない。タイムアウトや通信失敗で検索結果全体を失敗させない。
    return null;
  }
}

// geosearchの候補から、名前と距離の両面で採用できる記事を1件選ぶ(なければnull)。
// 名前がほぼ一致しない場合、近傍記事であっても別の建物・地物である可能性が高いため
// 採用しない。ただし極めて近い(150m以内)場合は名前の表記揺れとみなし採用する。
export function pickBestCandidate(candidates, name) {
  if (!candidates?.length) return null;
  const scored = candidates
    .map((c) => ({ ...c, similarity: nameSimilarity(c.title, name) }))
    .sort((a, b) => b.similarity - a.similarity || a.dist - b.dist);

  const best = scored[0];
  if (best.similarity < MIN_NAME_SIMILARITY && best.dist > STRONG_MATCH_DISTANCE_METERS) {
    console.debug('[wikipedia] rejected geosearch candidate (low similarity):', name, '->', best.title, best.similarity, best.dist);
    return null;
  }
  return best;
}

async function fetchVerifiedByLocation(lang, name, location, fetchImpl = fetch) {
  if (!location) return null;

  const candidates = await geosearchWikipedia(lang, location.lat, location.lng, fetchImpl);
  if (!candidates.length) return null;

  const best = pickBestCandidate(candidates, name);
  if (!best) return null;

  return fetchExtractByTitle(lang, best.title, fetchImpl);
}

export async function fetchWikipediaExtract(name, location, { fetchImpl = globalThis.fetch, lang: preferred = 'ja' } = {}) {
  if (!name || !location || !isValidLatLng(location.lat, location.lng)) return null;

  // アプリのUI・説明文テンプレートは日本語固定のため、要約文が英語だらけにならないよう
  // ブラウザの言語設定に関わらず常に日本語版を最優先で試し、見つからない場合のみ
  // ブラウザの言語→英語版の順にフォールバックする。
  const preferredLang = getPreferredLanguageCode();
  // 表示言語の版を最優先にし、なければ日本語 → ブラウザの言語 → 英語の順に探す。
  const langsToTry = [preferred, 'ja', preferredLang, 'en'].filter((lang, index, arr) => /^[a-z]{2,3}$/.test(lang) && arr.indexOf(lang) === index);

  for (const lang of langsToTry) {
    const result = await fetchVerifiedByLocation(lang, name, location, fetchImpl);
    if (result) return result;
  }
  return null;
}
