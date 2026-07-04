import { getPreferredLanguageCode } from './config.js';

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

  const preferredLang = getPreferredLanguageCode();
  const langsToTry = preferredLang === 'en' ? ['en'] : [preferredLang, 'en'];

  for (const lang of langsToTry) {
    const result = await fetchFromWikipediaLang(lang, name);
    if (result) return result;
  }
  return null;
}
