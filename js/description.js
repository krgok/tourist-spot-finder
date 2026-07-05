import { MIN_DESCRIPTION_LENGTH } from './config.js';

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
  playground: '遊び場',
  coworking_space: 'コワーキングスペース',
  library: '図書館',
};

function describeTypes(types = []) {
  const labels = types.map((t) => TYPE_LABELS[t]).filter(Boolean);
  return labels.length ? labels.join('・') : '観光スポット';
}

function describeOpeningHours(openingHours) {
  if (!openingHours?.weekdayDescriptions?.length) return '';
  return `営業時間の目安は「${openingHours.weekdayDescriptions[0]}」などとなっています。`;
}

export function buildDescription(place) {
  const name = place.displayName?.text || '名称不明のスポット';
  const address = place.formattedAddress || '';
  const typeLabel = describeTypes(place.types);
  const rating = place.rating;
  const reviewCount = place.userRatingCount;

  const parts = [];

  if (place._wikipedia?.extract) {
    parts.push(place._wikipedia.extract);
  } else if (place.editorialSummary?.text) {
    parts.push(place.editorialSummary.text);
  }

  let intro = `${name}は${address ? address + 'にある' : ''}${typeLabel}です。`;
  parts.push(intro);

  if (rating) {
    parts.push(
      `Googleでの評価は星${rating}${reviewCount ? `（${reviewCount}件のレビュー）` : ''}となっており、多くの訪問者に親しまれています。`
    );
  }

  const hoursText = describeOpeningHours(place.regularOpeningHours);
  if (hoursText) parts.push(hoursText);

  let text = parts.join('');

  if (text.length < MIN_DESCRIPTION_LENGTH && place.reviews?.length) {
    for (const review of place.reviews) {
      if (text.length >= MIN_DESCRIPTION_LENGTH) break;
      const reviewText = review.text?.text;
      if (reviewText) {
        text += `訪問者の声（Googleレビューより）：「${reviewText}」`;
      }
    }
  }

  const fillerSentences = [
    `現地を訪れる際は、最新の営業状況や周辺の交通アクセスを事前に確認することをおすすめします。`,
    `地図アプリと合わせて、周辺の観光スポットも巡ってみてはいかがでしょうか。`,
    `${typeLabel}として地域でも知られており、季節や時間帯によって異なる魅力を楽しめるスポットです。`,
    `訪問の際は、公式サイトやGoogleマップの最新情報もあわせてご確認ください。`,
    `周辺には飲食店や休憩スポットもあることが多いため、旅程に組み込みやすいのも魅力です。`,
  ];

  let fillerIndex = 0;
  while (text.length < MIN_DESCRIPTION_LENGTH && fillerIndex < fillerSentences.length) {
    text += fillerSentences[fillerIndex];
    fillerIndex += 1;
  }

  return text;
}
