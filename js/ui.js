import { buildPhotoUrl } from './places.js?v=20260708-3';
import { buildDescription } from './description.js?v=20260708-3';
import { GENRES } from './config.js?v=20260708-3';

export function setStatus(elementId, message, type = '') {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

export function renderResults(places, apiKey, { onCardClick, onFavoriteToggle, onRouteClick, isFavorited } = {}) {
  const container = document.getElementById('results-list');
  container.innerHTML = '';

  if (!places.length) {
    container.innerHTML = '<p class="hint">この条件ではスポットが見つかりませんでした。ジャンル・半径・件数を変更して再検索してください。</p>';
    return;
  }

  places.forEach((place, index) => {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.dataset.index = String(index);

    const photoUrl = buildPhotoUrl(place.photos?.[0], apiKey);
    const description = buildDescription(place);
    const name = place.displayName?.text || '名称不明';

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
    if (place.primaryTypeDisplayName?.text) {
      const typeBadge = document.createElement('span');
      typeBadge.className = 'place-type-badge';
      typeBadge.textContent = place.primaryTypeDisplayName.text;
      ratingEl.appendChild(typeBadge);
    }

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

    const actionsEl = document.createElement('div');
    actionsEl.className = 'place-actions';

    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'btn btn-small';
    favoriteBtn.type = 'button';
    const favorited = isFavorited?.(place.id);
    favoriteBtn.textContent = favorited ? '★ お気に入り済み' : '☆ お気に入りに追加';
    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onFavoriteToggle?.(index);
    });
    actionsEl.appendChild(favoriteBtn);

    const routeBtn = document.createElement('button');
    routeBtn.className = 'btn btn-small';
    routeBtn.type = 'button';
    routeBtn.textContent = '経路を表示';
    routeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRouteClick?.(index);
    });
    actionsEl.appendChild(routeBtn);

    const routeInfoEl = document.createElement('span');
    routeInfoEl.className = 'route-info';
    actionsEl.appendChild(routeInfoEl);

    body.appendChild(heading);
    body.appendChild(ratingEl);
    body.appendChild(descEl);
    body.appendChild(linksEl);
    body.appendChild(actionsEl);

    card.appendChild(img);
    card.appendChild(body);

    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      onCardClick?.(index);
    });

    container.appendChild(card);
  });
}

export function updateRouteInfo(index, text) {
  const card = document.querySelector(`.place-card[data-index="${index}"]`);
  const el = card?.querySelector('.route-info');
  if (el) el.textContent = text;
}

export function scrollToCard(index) {
  const card = document.querySelector(`.place-card[data-index="${index}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.add('place-card-highlight');
  setTimeout(() => card.classList.remove('place-card-highlight'), 1500);
}

export function renderFavorites(favorites, { onRemove, onSearchNear } = {}) {
  const container = document.getElementById('favorites-list');
  container.innerHTML = '';

  if (!favorites.length) {
    container.innerHTML = '<p class="hint">お気に入りはまだありません。</p>';
    return;
  }

  favorites.forEach((fav) => {
    const item = document.createElement('div');
    item.className = 'side-item';

    const info = document.createElement('div');
    info.className = 'side-item-info';
    const title = document.createElement('strong');
    title.textContent = fav.display_name;
    const address = document.createElement('p');
    address.className = 'hint';
    address.textContent = fav.address || '';
    info.appendChild(title);
    info.appendChild(address);

    const buttonsEl = document.createElement('div');
    buttonsEl.className = 'side-item-buttons';

    if (fav.lat != null && fav.lng != null) {
      const searchNearBtn = document.createElement('button');
      searchNearBtn.className = 'btn btn-small';
      searchNearBtn.type = 'button';
      searchNearBtn.textContent = 'この周辺を検索';
      searchNearBtn.addEventListener('click', () => onSearchNear?.(fav));
      buttonsEl.appendChild(searchNearBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-small';
    removeBtn.type = 'button';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => onRemove?.(fav.place_id));
    buttonsEl.appendChild(removeBtn);

    item.appendChild(info);
    item.appendChild(buttonsEl);
    container.appendChild(item);
  });
}

export function renderHistory(history, { onDelete, onRerun } = {}) {
  const container = document.getElementById('history-list');
  container.innerHTML = '';

  if (!history.length) {
    container.innerHTML = '<p class="hint">検索履歴はまだありません。</p>';
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'side-item';

    const info = document.createElement('div');
    info.className = 'side-item-info';
    const title = document.createElement('strong');
    const radiusKm = entry.radius_meters / 1000;
    const date = new Date(entry.searched_at).toLocaleString('ja-JP');
    const genreLabel = entry.meta?.genre ? GENRES[entry.meta.genre]?.label : null;
    const locationLabel = entry.meta?.locationLabel;
    title.textContent = `${date} - ${genreLabel ? genreLabel + ' / ' : ''}半径${radiusKm}km / ${entry.max_count}件`;
    const summary = document.createElement('p');
    summary.className = 'hint';
    summary.textContent = `${locationLabel ? locationLabel + ' - ' : ''}${entry.result_count ?? 0}件ヒット`;
    info.appendChild(title);
    info.appendChild(summary);

    const buttonsEl = document.createElement('div');
    buttonsEl.className = 'side-item-buttons';

    const rerunBtn = document.createElement('button');
    rerunBtn.className = 'btn btn-small';
    rerunBtn.type = 'button';
    rerunBtn.textContent = 'この条件で再検索';
    rerunBtn.addEventListener('click', () => onRerun?.(entry));
    buttonsEl.appendChild(rerunBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-small';
    deleteBtn.type = 'button';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => onDelete?.(entry.id));
    buttonsEl.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(buttonsEl);
    container.appendChild(item);
  });
}
