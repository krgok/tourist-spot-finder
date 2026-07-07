import { getPreferredLanguageCode } from './config.js?v=20260707-5';

const WIKIPEDIA_TIMEOUT_MS = 5000;

async function fetchFromWikipediaLang(lang, name) {
  try {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      name
    )}&format=json&origin=*&srlimit=1`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;

    const extractUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(
      title
    )}&format=json&origin=*`;
    const extractRes = await fetch(extractUrl, { signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS) });
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
    return null;
  }
}

export async function fetchWikipediaExtract(name) {
  if (!name) return null;

  // アプリのUI・説明文テンプレートは日本語固定のため、要約文が英語だらけにならないよう
  // ブラウザの言語設定に関わらず常に日本語版を最優先で試し、見つからない場合のみ
  // ブラウザの言語→英語版の順にフォールバックする。
  const preferredLang = getPreferredLanguageCode();
  const langsToTry = ['ja', preferredLang, 'en'].filter((lang, index, arr) => arr.indexOf(lang) === index);

  for (const lang of langsToTry) {
    const result = await fetchFromWikipediaLang(lang, name);
    if (result) return result;
  }
  return null;
}
