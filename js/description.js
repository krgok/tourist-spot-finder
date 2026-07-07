import { MIN_DESCRIPTION_LENGTH } from './config.js?v=20260708-1';

const TYPE_LABELS = {
  tourist_attraction: '観光名所',
  museum: '博物館・美術館',
  park: '公園',
  place_of_worship: '寺社・宗教施設',
  art_gallery: 'ギャラリー',
  amusement_park: '遊園地',
  zoo: '動物園',
  aquarium: '水族館',
  landmark: 'ランドマーク',
  restaurant: 'レストラン',
  cafe: 'カフェ',
  coffee_shop: 'コーヒーショップ',
  tea_house: '喫茶店',
  sandwich_shop: '軽食屋',
  bakery: 'ベーカリー',
  playground: '遊び場',
  coworking_space: 'コワーキングスペース',
  library: '図書館',
  business_center: 'ビジネスセンター',
  spa: '温泉・スパ',
};

const PRICE_LEVEL_LABELS = {
  PRICE_LEVEL_FREE: '無料',
  PRICE_LEVEL_INEXPENSIVE: '価格帯は控えめ(¥)',
  PRICE_LEVEL_MODERATE: '価格帯は標準的(¥¥)',
  PRICE_LEVEL_EXPENSIVE: '価格帯はやや高め(¥¥¥)',
  PRICE_LEVEL_VERY_EXPENSIVE: '価格帯は高級(¥¥¥¥)',
};

const GENERIC_FILLERS = [
  '現地を訪れる際は、最新の営業状況や周辺の交通アクセスを事前に確認することをおすすめします。',
  '地図アプリと合わせて、周辺の観光スポットも巡ってみてはいかがでしょうか。',
  '訪問の際は、公式サイトやGoogleマップの最新情報もあわせてご確認ください。',
  '周辺には飲食店や休憩スポットもあることが多いため、旅程に組み込みやすいのも魅力です。',
];

function describeTypes(types = []) {
  const labels = types.map((t) => TYPE_LABELS[t]).filter(Boolean);
  return labels.length ? labels.join('・') : '観光スポット';
}

// place.idの文字コード合計を種にした簡易ハッシュ。同じ場所は常に同じ並びになりつつ、
// 場所ごとに穴埋め文の選び方(汎用フォールバックの利用時のみ)を変える。
function seededShuffle(array, seed) {
  const result = array.slice();
  let s = seed;
  for (let i = result.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function hashString(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) % 1000000;
  }
  return hash;
}

function describeOpeningHours(openingHours) {
  const descriptions = openingHours?.weekdayDescriptions;
  if (!descriptions?.length) return '';
  return `営業時間は${descriptions.join('、')}となっています。`;
}

// Google側に日本語訳が用意されていないeditorialSummary/レビューは原文(多くは英語)のまま
// 返ってくることがある。説明文が英語だらけにならないよう、日本語の割合が低いテキストは
// そもそも採用せず、テンプレート文のフォールバックに任せる。
function isMostlyJapanese(text) {
  if (!text) return false;
  const nonSpaceLength = text.replace(/\s/g, '').length;
  if (nonSpaceLength === 0) return false;
  const japaneseCharCount = (text.match(/[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g) || []).length;
  return japaneseCharCount / nonSpaceLength >= 0.3;
}

function pickReviewExcerpts(reviews = [], maxCount = 2, maxLengthEach = 120) {
  const candidates = reviews
    .map((review) => ({
      text: review.text?.text?.trim(),
      rating: review.rating,
    }))
    .filter((review) => isMostlyJapanese(review.text));

  // 短すぎる相槌的なレビュー(「良い」「最高」等)よりも、内容のあるものを優先する。
  candidates.sort((a, b) => b.text.length - a.text.length);

  return candidates.slice(0, maxCount).map((review) => {
    const excerpt =
      review.text.length > maxLengthEach ? review.text.slice(0, maxLengthEach) + '…' : review.text;
    const ratingLabel = review.rating ? `★${review.rating} ` : '';
    return `${ratingLabel}「${excerpt}」`;
  });
}

export function buildDescription(place) {
  const name = place.displayName?.text || '名称不明のスポット';
  const address = place.formattedAddress || '';
  const typeLabel = describeTypes(place.types);
  const rating = place.rating;
  const reviewCount = place.userRatingCount;

  const parts = [];

  if (isMostlyJapanese(place._wikipedia?.extract)) {
    parts.push(place._wikipedia.extract);
  } else if (isMostlyJapanese(place.editorialSummary?.text)) {
    parts.push(place.editorialSummary.text);
  }

  let intro = `${name}は${address ? address + 'にある' : ''}${typeLabel}です。`;
  parts.push(intro);

  if (rating) {
    parts.push(
      `Googleでの評価は星${rating}${reviewCount ? `（${reviewCount}件のレビュー）` : ''}となっており、多くの訪問者に親しまれています。`
    );
  }

  const priceLabel = PRICE_LEVEL_LABELS[place.priceLevel];
  if (priceLabel) {
    parts.push(`${priceLabel}です。`);
  }

  const hoursText = describeOpeningHours(place.regularOpeningHours);
  if (hoursText) parts.push(hoursText);

  // 実際のクチコミはこのスポット固有の情報なので、文字数が足りているかに関わらず
  // 積極的に本文へ組み込む(以前は文字数不足時の最終手段でしか使われず、結果的に
  // どの場所も同じテンプレート文だけで構成されがちだった)。
  const reviewExcerpts = pickReviewExcerpts(place.reviews);
  reviewExcerpts.forEach((excerpt) => {
    parts.push(`訪問者の声（Googleレビューより）：${excerpt}`);
  });

  let text = parts.join('');

  // ここまでの内容は場所ごとの実データに基づくため、大半のケースで既に十分な文字数になる。
  // それでも情報が薄い場所(レビュー0件・営業時間未登録等)向けの最終手段として、
  // 汎用文を場所ごとに異なる順序・組み合わせで補う。
  if (text.length < MIN_DESCRIPTION_LENGTH) {
    const shuffledFillers = seededShuffle(GENERIC_FILLERS, hashString(place.id || name));
    let fillerIndex = 0;
    while (text.length < MIN_DESCRIPTION_LENGTH && fillerIndex < shuffledFillers.length) {
      text += shuffledFillers[fillerIndex];
      fillerIndex += 1;
    }
    if (text.length < MIN_DESCRIPTION_LENGTH) {
      text += `${typeLabel}として、季節や時間帯によって異なる魅力を楽しめるスポットです。`;
    }
  }

  return text;
}
