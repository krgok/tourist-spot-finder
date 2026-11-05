import { buildPhotoUrl } from './places.js?v=20260708-4';
import { buildDescription } from './description.js?v=20260708-4';
import { GENRES } from './config.js?v=20260708-4';
import { createExternalLink } from './safeUrl.js?v=20260708-4';
import { buildPlaceUrl } from './mapsLinks.js?v=20260708-4';
import { STATUS_LABELS, NOTE_MAX, favoriteStatus, todayLocalISO } from './favoriteNotes.js?v=20260708-4';
import { openStatus, OPEN_STATE_LABELS } from './openingHours.js?v=20260708-4';

export function setStatus(elementId, message, type = '') {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function showEmptyMessage(container, text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  container.replaceChildren(p);
}

export function renderResults(places, apiKey, { onCardClick, onFavoriteToggle, onRouteClick, isFavorited, getDirectionsUrl, lang } = {}) {
  const container = document.getElementById('results-list');
  container.replaceChildren();

  if (!places.length) {
    showEmptyMessage(container, 'この条件ではスポットが見つかりませんでした。ジャンル・半径・件数を変更して再検索してください。');
    return;
  }

  places.forEach((place, index) => {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.dataset.index = String(index);

    const photoUrl = buildPhotoUrl(place.photos?.[0], apiKey);
    const description = buildDescription(place, { lang });
    const name = place.displayName?.text || '名称不明';

    // 写真がない場所では、空の枠を出さない(スマホで横幅を無駄にしないため)。
    let img = null;
    if (photoUrl) {
      img = document.createElement('img');
      img.className = 'place-photo';
      img.alt = '';
      img.loading = 'lazy';
      img.src = photoUrl;
    }

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
    const open = openStatus(place);
    if (open.state !== 'unknown') {
      const badge = document.createElement('span');
      badge.className = `open-badge ${open.state}`;
      badge.textContent = OPEN_STATE_LABELS[open.state] + (open.detail ? `(${open.detail})` : '');
      ratingEl.appendChild(badge);
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
    // 外部由来の URL は http(s) だけ許可し、noopener noreferrer を付けて開く。
    [
      createExternalLink(place.websiteUri, '公式サイト'),
      createExternalLink(place.googleMapsUri, 'Googleマップで見る'),
      createExternalLink(getDirectionsUrl?.(place), 'マップアプリで経路を開く'),
      createExternalLink(place._wikipedia?.url, 'Wikipedia（出典）'),
    ]
      .filter(Boolean)
      .forEach((link) => linksEl.appendChild(link));

    const actionsEl = document.createElement('div');
    actionsEl.className = 'place-actions';

    // カード全体のクリックはマウス向け。キーボード・スクリーンリーダー向けに、同じ操作のボタンも置く。
    const mapBtn = document.createElement('button');
    mapBtn.className = 'btn btn-small';
    mapBtn.type = 'button';
    mapBtn.textContent = '地図で見る';
    mapBtn.setAttribute('aria-label', `${name}を地図で見る`);
    mapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onCardClick?.(index);
    });
    actionsEl.appendChild(mapBtn);

    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'btn btn-small';
    favoriteBtn.type = 'button';
    const favorited = isFavorited?.(place.id);
    favoriteBtn.textContent = favorited ? '★ お気に入り済み' : '☆ お気に入りに追加';
    favoriteBtn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
    favoriteBtn.setAttribute('aria-label', `${name}を${favorited ? 'お気に入りから外す' : 'お気に入りに追加'}`);
    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onFavoriteToggle?.(index);
    });
    actionsEl.appendChild(favoriteBtn);

    const routeBtn = document.createElement('button');
    routeBtn.className = 'btn btn-small';
    routeBtn.type = 'button';
    routeBtn.textContent = '経路を表示';
    routeBtn.setAttribute('aria-label', `${name}への経路を表示`);
    routeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRouteClick?.(index);
    });
    actionsEl.appendChild(routeBtn);

    const routeInfoEl = document.createElement('span');
    routeInfoEl.className = 'route-info';
    routeInfoEl.setAttribute('role', 'status');
    actionsEl.appendChild(routeInfoEl);

    body.appendChild(heading);
    body.appendChild(ratingEl);
    body.appendChild(descEl);
    body.appendChild(linksEl);
    body.appendChild(actionsEl);

    if (img) card.appendChild(img);
    card.appendChild(body);

    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      onCardClick?.(index);
    });

    container.appendChild(card);
  });
}

export function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function updateRouteInfo(index, text) {
  const card = document.querySelector(`.place-card[data-index="${index}"]`);
  const el = card?.querySelector('.route-info');
  if (el) el.textContent = text;
}

export function scrollToCard(index) {
  const card = document.querySelector(`.place-card[data-index="${index}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  card.classList.add('place-card-highlight');
  setTimeout(() => card.classList.remove('place-card-highlight'), 1500);
}

// メモ・訪問済みの編集フォーム(外部・利用者由来の文字列は、すべて value / textContent で扱う)
function buildFavoriteEditor(fav, { onSave, onCancel }) {
  const form = document.createElement('form');
  form.className = 'fav-editor';
  const uid = `fav-${Math.random().toString(36).slice(2, 8)}`;

  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = '状態';
  fieldset.appendChild(legend);
  const radios = {};
  Object.entries(STATUS_LABELS).forEach(([value, label]) => {
    const l = document.createElement('label');
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = `${uid}-status`;
    r.value = value;
    r.checked = favoriteStatus(fav) === value;
    radios[value] = r;
    l.append(r, document.createTextNode(` ${label}`));
    fieldset.appendChild(l);
  });

  const dateLabel = document.createElement('label');
  dateLabel.textContent = '訪問日(任意)';
  const date = document.createElement('input');
  date.type = 'date';
  date.min = '2000-01-01';
  date.max = todayLocalISO();
  date.value = fav.visited_at || '';
  dateLabel.appendChild(date);

  const noteLabel = document.createElement('label');
  noteLabel.textContent = `メモ(${NOTE_MAX}文字まで)`;
  const note = document.createElement('textarea');
  note.rows = 3;
  note.maxLength = NOTE_MAX;
  note.value = fav.note || '';
  noteLabel.appendChild(note);

  const error = document.createElement('p');
  error.className = 'status-msg error';
  error.setAttribute('role', 'alert');

  const buttons = document.createElement('div');
  buttons.className = 'editor-buttons';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-small btn-primary';
  save.textContent = '保存';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-small';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () => onCancel());
  buttons.append(save, cancel);

  const syncDate = () => dateLabel.classList.toggle('hidden', !radios.visited.checked);
  Object.values(radios).forEach((r) => r.addEventListener('change', syncDate));
  syncDate();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    error.textContent = '';
    try {
      await onSave({
        status: radios.visited.checked ? 'visited' : 'want',
        visitedAt: date.value,
        note: note.value,
      });
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  });

  form.append(fieldset, dateLabel, noteLabel, error, buttons);
  return form;
}

export function renderFavorites(favorites, { onRemove, onSearchNear, onUpdate } = {}) {
  const container = document.getElementById('favorites-list');
  container.replaceChildren();

  if (!favorites.length) {
    showEmptyMessage(container, 'お気に入りはまだありません。');
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
    const mapLink = createExternalLink(
      buildPlaceUrl({ lat: fav.lat, lng: fav.lng, placeId: fav.place_id, name: fav.display_name }),
      'Googleマップで開く'
    );
    if (mapLink) info.appendChild(mapLink);

    const status = favoriteStatus(fav);
    const statusEl = document.createElement('p');
    statusEl.className = `fav-status ${status}`;
    statusEl.textContent = STATUS_LABELS[status] + (status === 'visited' && fav.visited_at ? `(${fav.visited_at})` : '');
    info.appendChild(statusEl);
    if (fav.note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'fav-note';
      noteEl.textContent = fav.note;
      info.appendChild(noteEl);
    }

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

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-small';
    editBtn.type = 'button';
    editBtn.textContent = 'メモ・訪問済み';
    editBtn.setAttribute('aria-label', `${fav.display_name}のメモ・訪問済みを編集`);
    editBtn.setAttribute('aria-expanded', 'false');
    let editor = null;
    editBtn.addEventListener('click', () => {
      if (editor) {
        editor.remove();
        editor = null;
        editBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      editor = buildFavoriteEditor(fav, {
        onSave: (values) => onUpdate?.(fav, values),
        onCancel: () => {
          editor?.remove();
          editor = null;
          editBtn.setAttribute('aria-expanded', 'false');
        },
      });
      item.appendChild(editor);
      editBtn.setAttribute('aria-expanded', 'true');
      editor.querySelector('textarea')?.focus();
    });
    buttonsEl.appendChild(editBtn);

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
  container.replaceChildren();

  if (!history.length) {
    showEmptyMessage(container, '検索履歴はまだありません。');
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
