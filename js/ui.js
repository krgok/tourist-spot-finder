import { buildPhotoUrl } from './places.js';
import { buildDescription } from './description.js';

export function setStatus(elementId, message, type = '') {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

export function renderResults(places, apiKey, { onCardClick } = {}) {
  const container = document.getElementById('results-list');
  container.innerHTML = '';

  if (!places.length) {
    container.innerHTML = '<p class="hint">この条件では観光地が見つかりませんでした。半径や件数を変更して再検索してください。</p>';
    return;
  }

  places.forEach((place, index) => {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.dataset.index = String(index);

    const photoUrl = buildPhotoUrl(place.photos?.[0], apiKey);
    const description = buildDescription(place);
    const name = place.displayName?.text || '名称不明';
    const address = place.formattedAddress || '';

    const img = document.createElement('img');
    img.className = 'place-photo';
    img.alt = name;
    img.src = photoUrl || '';
    if (!photoUrl) img.style.visibility = 'hidden';

    const body = document.createElement('div');
    body.className = 'place-body';

    const heading = document.createElement('h3');
    const badge = document.createElement('span');
    badge.className = 'place-index';
    badge.textContent = String(index + 1);
    heading.appendChild(badge);
    heading.appendChild(document.createTextNode(name));

    const ratingEl = document.createElement('div');
    ratingEl.className = 'place-rating';
    if (place.rating) {
      ratingEl.textContent = `★ ${place.rating} (${place.userRatingCount || 0}件)`;
    }

    const addressEl = document.createElement('p');
    addressEl.className = 'place-address';
    addressEl.textContent = address;

    const descEl = document.createElement('p');
    descEl.className = 'place-desc';
    descEl.textContent = description;

    const linksEl = document.createElement('div');
    linksEl.className = 'place-links';
    if (place.websiteUri) {
      const websiteLink = document.createElement('a');
      websiteLink.href = place.websiteUri;
      websiteLink.target = '_blank';
      websiteLink.rel = 'noopener';
      websiteLink.textContent = '公式サイト';
      linksEl.appendChild(websiteLink);
    }
    if (place.googleMapsUri) {
      const mapsLink = document.createElement('a');
      mapsLink.href = place.googleMapsUri;
      mapsLink.target = '_blank';
      mapsLink.rel = 'noopener';
      mapsLink.textContent = 'Googleマップで見る';
      linksEl.appendChild(mapsLink);
    }
    if (place._wikipedia?.url) {
      const wikiLink = document.createElement('a');
      wikiLink.href = place._wikipedia.url;
      wikiLink.target = '_blank';
      wikiLink.rel = 'noopener';
      wikiLink.textContent = 'Wikipedia（出典）';
      linksEl.appendChild(wikiLink);
    }

    body.appendChild(heading);
    body.appendChild(ratingEl);
    body.appendChild(addressEl);
    body.appendChild(descEl);
    body.appendChild(linksEl);

    card.appendChild(img);
    card.appendChild(body);

    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      onCardClick?.(index);
    });

    container.appendChild(card);
  });
}
