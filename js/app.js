import { initSettingsPanel, loadSettings } from './settings.js?v=20260708-4';
import { initAuth } from './auth.js?v=20260708-4';
import { getCurrentPosition } from './geolocation.js?v=20260708-4';
import { searchNearbyTouristSpots, geocodeLocation, sortPlaces } from './places.js?v=20260708-4';
import { setStatus, renderResults, renderFavorites, renderHistory, updateRouteInfo, scrollToCard, prefersReducedMotion } from './ui.js?v=20260708-4';
import { MapController } from './map.js?v=20260708-4';
import { fetchWikipediaExtract } from './wikipedia.js?v=20260708-4';
import { LOW_ACCURACY_THRESHOLD_METERS, GENRES, SORT_OPTIONS, TRAVEL_MODES, REGIONS, LANGUAGES } from './config.js?v=20260708-4';
import { normalizeRegion, normalizeLanguage, guessRegion, genreKeysFor, genreForRegion } from './region.js?v=20260708-4';
import { storageGet, storageSet } from './storage.js?v=20260708-4';
import { normalizeForUi, clampSearchParams, isOneOf } from './params.js?v=20260708-4';
import { isValidLatLng } from './validate.js?v=20260708-4';
import { addFavorite, removeFavorite, listFavorites, updateFavorite } from './favorites.js?v=20260708-4';
import { buildFavoritePatch, filterFavorites } from './favoriteNotes.js?v=20260708-4';
import { recordSearch, listHistory, deleteHistoryEntry } from './history.js?v=20260708-4';
import { fetchRoute } from './routes.js?v=20260708-4';
import { formatDuration } from './format.js?v=20260708-4';
import { buildDirectionsUrl, buildShareText, MAX_STOPS } from './mapsLinks.js?v=20260708-4';
import { shareOrCopy } from './share.js?v=20260708-4';
import { parseStoredOrigins, serializeOrigins, addOrigin, removeOrigin, ORIGINS_STORAGE_KEY } from './origins.js?v=20260708-4';

const SORT_KEY_STORAGE = 'tourist-app.sortKey';
const TRAVEL_MODE_STORAGE = 'tourist-app.travelMode';

let currentSettings = loadSettings();
let currentPlaces = [];
let currentPosition = null;
let mapController = null;
let mapReadyPromise = null;
let currentUser = null;
let favoritesCache = [];
let currentGenre = 'sightseeing';
// 保存値が古い/壊れている場合に備えて、選択肢にある値だけ採用する。
const storedSort = storageGet(SORT_KEY_STORAGE);
const storedTravelMode = storageGet(TRAVEL_MODE_STORAGE);
let currentSortKey = isOneOf(storedSort, SORT_OPTIONS) ? storedSort : 'recommended';
let currentTravelMode = isOneOf(storedTravelMode, TRAVEL_MODES) ? storedTravelMode : 'WALK';
let lastSearchRadius = Number(document.getElementById('radius-select').value) || 2000;
let isSearching = false;
let currentOriginMode = 'current'; // 'current' | 'custom'(共有リンクに出発地を入れるのは custom のときだけ)

const searchBtn = document.getElementById('search-btn');
const genreSelect = document.getElementById('genre-select');
const regionSelect = document.getElementById('region-select');
const languageSelect = document.getElementById('language-select');
const REGION_STORAGE = 'tourist-app.region';
const LANGUAGE_STORAGE = 'tourist-app.language';
let currentResultsLanguage = 'ja'; // 検索結果を取得したときの言語(説明文の判定に使う)
const genreDescriptionEl = document.getElementById('genre-description');
const radiusSelect = document.getElementById('radius-select');
const countSelect = document.getElementById('count-select');
const locationModeRadios = document.querySelectorAll('input[name="location-mode"]');
const locationQueryInput = document.getElementById('location-query-input');
const sortSelect = document.getElementById('sort-select');
const travelModeSelect = document.getElementById('travel-mode-select');
const backToMapBtn = document.getElementById('back-to-map-btn');
const mapEl = document.getElementById('map');
const resultsListEl = document.getElementById('results-list');
const SEARCH_BTN_LABEL = searchBtn.textContent;

sortSelect.value = currentSortKey;
travelModeSelect.value = currentTravelMode;

backToMapBtn.addEventListener('click', () => {
  mapEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
});

// ---- オフライン表示 ----
const offlineBanner = document.getElementById('offline-banner');
function updateOnlineState() {
  offlineBanner.classList.toggle('hidden', navigator.onLine !== false);
}
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);
updateOnlineState();

// ---- 位置情報の許可状態(ブロック済みなら、検索前に案内する) ----
const locationHintEl = document.getElementById('location-hint');
const LOCATION_HINT_DEFAULT = locationHintEl.textContent;
const LOCATION_HINT_DENIED =
  '位置情報がブロックされています。アドレスバー付近の鍵(設定)アイコンから「位置情報」を許可するか、「場所を指定」で地名を入力してください。';
navigator.permissions
  ?.query({ name: 'geolocation' })
  .then((status) => {
    const update = () => {
      locationHintEl.textContent = status.state === 'denied' ? LOCATION_HINT_DENIED : LOCATION_HINT_DEFAULT;
    };
    update();
    status.addEventListener('change', update);
  })
  .catch(() => {});

// スマホでは地図と結果一覧が縦積みになるため、地図が画面外に出たら
// 「地図に戻る」ボタンを表示する(狭い画面かどうかはCSS側のメディアクエリでも制御)。
new IntersectionObserver(
  ([entry]) => {
    backToMapBtn.classList.toggle('hidden', entry.isIntersecting);
  },
  { threshold: 0.1 }
).observe(mapEl);

sortSelect.addEventListener('change', () => {
  currentSortKey = sortSelect.value;
  storageSet(SORT_KEY_STORAGE, currentSortKey);
  applySortAndRerender();
});

travelModeSelect.addEventListener('change', () => {
  currentTravelMode = travelModeSelect.value;
  storageSet(TRAVEL_MODE_STORAGE, currentTravelMode);
});

const settingsDialog = document.getElementById('settings-dialog');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsWarningBadge = document.getElementById('settings-warning-badge');

openSettingsBtn.addEventListener('click', () => settingsDialog.showModal());
closeSettingsBtn.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (e) => {
  if (e.target === settingsDialog) settingsDialog.close();
});

function updateSearchButtonState() {
  searchBtn.disabled = !currentSettings.apiKey;
  settingsWarningBadge.classList.toggle('hidden', Boolean(currentSettings.apiKey));
}

function updateGenreDescription() {
  genreDescriptionEl.textContent = GENRES[genreSelect.value]?.description || '';
}

genreSelect.addEventListener('change', updateGenreDescription);

// ---- 地域(日本/タイ)と言語 ----
function populateGenres(region, keep) {
  const selected = genreForRegion(region, keep ?? genreSelect.value);
  genreSelect.replaceChildren();
  genreKeysFor(region).forEach((key) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = GENRES[key].label;
    genreSelect.appendChild(opt);
  });
  genreSelect.value = selected;
  updateGenreDescription();
}

function applyRegion(region, { keepGenre } = {}) {
  const r = normalizeRegion(region);
  regionSelect.value = r;
  populateGenres(r, keepGenre);
}

const storedRegion = storageGet(REGION_STORAGE);
// 初回(保存された設定なし)は、タイムゾーンから地域を推定する(位置情報は使わない)。
applyRegion(storedRegion ?? guessRegion(Intl.DateTimeFormat().resolvedOptions().timeZone));
languageSelect.value = normalizeLanguage(storageGet(LANGUAGE_STORAGE));

regionSelect.addEventListener('change', () => {
  storageSet(REGION_STORAGE, regionSelect.value);
  applyRegion(regionSelect.value);
});
languageSelect.addEventListener('change', () => {
  storageSet(LANGUAGE_STORAGE, languageSelect.value);
  if (currentPlaces.length) {
    setStatus('search-status', `表示言語を${LANGUAGES[languageSelect.value].label}に変更しました。次の検索から反映されます。`);
  }
});

const savedOriginSelect = document.getElementById('saved-origin-select');
function updateLocationInputs() {
  const mode = getLocationMode();
  locationQueryInput.classList.toggle('hidden', mode !== 'custom');
  savedOriginSelect.classList.toggle('hidden', mode !== 'saved');
}
locationModeRadios.forEach((radio) => radio.addEventListener('change', updateLocationInputs));

// ---- よく使う起点(この端末の localStorage のみ) ----
let savedOrigins = parseStoredOrigins(storageGet(ORIGINS_STORAGE_KEY));
let lastSearchedPoint = null; // { lat, lng, label }: 「最後に検索した地点を保存」の対象
const originNameInput = document.getElementById('origin-name-input');
const saveOriginBtn = document.getElementById('save-origin-btn');
const originsListEl = document.getElementById('origins-list');

function persistOrigins() {
  const ok = storageSet(ORIGINS_STORAGE_KEY, serializeOrigins(savedOrigins));
  if (!ok) {
    setStatus('origins-status', 'このブラウザでは端末に保存できません(プライベートブラウズ等)。このタブを閉じると消えます。', 'error');
  }
  return ok;
}

function renderOrigins() {
  // 選択肢(保存した起点)
  const previous = savedOriginSelect.value;
  savedOriginSelect.replaceChildren();
  if (!savedOrigins.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '保存した起点がありません';
    savedOriginSelect.appendChild(opt);
  }
  savedOrigins.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    savedOriginSelect.appendChild(opt);
  });
  if (savedOrigins.some((o) => o.id === previous)) savedOriginSelect.value = previous;

  // 管理リスト
  originsListEl.replaceChildren();
  savedOrigins.forEach((o) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'origin-name';
    name.textContent = o.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-small';
    del.textContent = '削除';
    del.setAttribute('aria-label', `${o.name}を削除`);
    del.addEventListener('click', () => {
      savedOrigins = removeOrigin(savedOrigins, o.id);
      persistOrigins();
      renderOrigins();
      setStatus('origins-status', `「${o.name}」を削除しました。`);
    });
    li.append(name, del);
    originsListEl.appendChild(li);
  });
  saveOriginBtn.disabled = !lastSearchedPoint;
}

saveOriginBtn.addEventListener('click', () => {
  if (!lastSearchedPoint) return;
  const fallbackName = lastSearchedPoint.label && lastSearchedPoint.label !== '現在地' ? lastSearchedPoint.label : '';
  const result = addOrigin(savedOrigins, {
    name: originNameInput.value || fallbackName,
    lat: lastSearchedPoint.lat,
    lng: lastSearchedPoint.lng,
  });
  if (!result.ok) return setStatus('origins-status', result.error, 'error');
  savedOrigins = result.list;
  originNameInput.value = '';
  if (persistOrigins()) setStatus('origins-status', '起点を保存しました。「保存した起点」から選べます。', 'success');
  renderOrigins();
});
renderOrigins();

function getLocationMode() {
  return document.querySelector('input[name="location-mode"]:checked')?.value || 'current';
}

async function ensureMapReady() {
  if (!currentSettings.apiKey) return null;
  if (!mapController) {
    const controller = new MapController();
    mapController = controller;
    mapReadyPromise = controller.init(currentSettings.apiKey, {
      onAuthFailure: () =>
        setStatus(
          'search-status',
          '地図の読み込みが Google に拒否されました。APIキーの制限(HTTPリファラー・「Maps JavaScript API」の有効化)を確認してください。',
          'error'
        ),
    });
  }
  try {
    await mapReadyPromise;
  } catch (err) {
    // 失敗した Promise を保持したままだと、以後の検索・経路が再読み込みまで全部失敗する。
    mapController = null;
    mapReadyPromise = null;
    throw err;
  }
  return mapController;
}

function isFavorited(placeId) {
  return favoritesCache.some((fav) => fav.place_id === placeId);
}

const favoritesFilter = document.getElementById('favorites-filter');
favoritesFilter.addEventListener('change', renderFavoritesList);

function renderFavoritesList() {
  renderFavorites(filterFavorites(favoritesCache, favoritesFilter.value), {
    onRemove: handleRemoveFavorite,
    onSearchNear: handleFavoriteSearchNear,
    onUpdate: handleUpdateFavorite,
  });
}

// メモ・訪問済みの保存。失敗は編集フォームに表示するため、例外をそのまま呼び出し元(フォーム)へ返す。
async function handleUpdateFavorite(fav, values) {
  const result = buildFavoritePatch(values);
  if (!result.ok) throw new Error(result.error);
  await updateFavorite(fav.place_id, result.patch);
  await refreshFavorites();
  setStatus('favorites-status', `「${fav.display_name}」を更新しました。`, 'success');
}

async function refreshFavorites() {
  if (!currentUser) {
    favoritesCache = [];
    renderFavorites([], {});
    updateRouteButtons();
    return;
  }
  try {
    favoritesCache = await listFavorites();
    renderFavoritesList();
    setStatus('favorites-status', '');
    updateRouteButtons();
  } catch (err) {
    console.error(err);
    setStatus('favorites-status', err.message, 'error');
  }
}

async function refreshHistory() {
  if (!currentUser) {
    renderHistory([], {});
    return;
  }
  try {
    const history = await listHistory();
    renderHistory(history, { onDelete: handleDeleteHistory, onRerun: handleHistoryRerun });
    setStatus('history-status', '');
  } catch (err) {
    console.error(err);
    setStatus('history-status', err.message, 'error');
  }
}

function applyPositionOverride(label) {
  document.querySelector('input[name="location-mode"][value="custom"]').checked = true;
  updateLocationInputs();
  locationQueryInput.value = label;
}

function handleFavoriteSearchNear(fav) {
  if (!isValidLatLng(fav.lat, fav.lng)) return;
  const label = fav.display_name ? `${fav.display_name}の周辺` : 'お気に入り周辺';
  applyPositionOverride(label);
  runSearch({ lat: fav.lat, lng: fav.lng, label });
}

function handleHistoryRerun(entry) {
  if (!isValidLatLng(entry.lat, entry.lng)) {
    setStatus('search-status', 'この履歴の検索地点が正しくないため、再検索できません。', 'error');
    return;
  }
  if (entry.meta?.region && REGIONS[entry.meta.region]) applyRegion(entry.meta.region, { keepGenre: entry.meta.genre });
  if (entry.meta?.language && LANGUAGES[entry.meta.language]) languageSelect.value = entry.meta.language;
  if (entry.meta?.genre && genreKeysFor(regionSelect.value).includes(entry.meta.genre)) {
    genreSelect.value = entry.meta.genre;
    updateGenreDescription();
  }
  // 履歴の値が現在の選択肢にない場合(古い履歴・手で書き換えられた値)でも、空の選択にならないよう合わせる。
  const { radiusMeters, maxCount } = normalizeForUi({ radiusMeters: entry.radius_meters, maxCount: entry.max_count });
  radiusSelect.value = String(radiusMeters);
  countSelect.value = String(maxCount);
  const label = entry.meta?.locationLabel || '過去の検索地点';
  applyPositionOverride(label);
  runSearch({ lat: entry.lat, lng: entry.lng, label });
}

function applySortAndRerender() {
  if (!currentPlaces.length) return;
  currentPlaces = sortPlaces(currentPlaces, currentSortKey, currentPosition, lastSearchRadius);
  rerenderResults();
  if (mapController) {
    mapController.clearMarkers();
    mapController.renderPlaces(currentPlaces, {
      onMarkerClick: (index) => {
        mapController.panToMarker(index);
        scrollToCard(index);
      },
    });
  }
}

async function handleFavoriteToggle(index) {
  const place = currentPlaces[index];
  if (!currentUser) {
    setStatus('search-status', 'お気に入りに追加するにはログインしてください。', 'error');
    return;
  }
  try {
    if (isFavorited(place.id)) {
      await removeFavorite(place.id);
    } else {
      const genreConfig = GENRES[currentGenre] || GENRES.sightseeing;
      await addFavorite(place, genreConfig.favoriteCategory, { genre: currentGenre });
    }
    await refreshFavorites();
    rerenderResults();
  } catch (err) {
    console.error(err);
    setStatus('search-status', err.message, 'error');
  }
}

async function handleRemoveFavorite(placeId) {
  try {
    await removeFavorite(placeId);
    await refreshFavorites();
    rerenderResults();
  } catch (err) {
    console.error(err);
    setStatus('favorites-status', err.message, 'error');
  }
}

async function handleDeleteHistory(id) {
  try {
    await deleteHistoryEntry(id);
    await refreshHistory();
  } catch (err) {
    console.error(err);
    setStatus('history-status', err.message, 'error');
  }
}

async function handleRouteClick(index) {
  const place = currentPlaces[index];
  if (!place?.location) return;
  if (!currentPosition) {
    updateRouteInfo(index, '');
    setStatus('search-status', '出発地が未設定です。先に検索を実行してください。', 'error');
    return;
  }
  if (!currentSettings.apiKey) {
    setStatus('search-status', 'APIキーを設定してください。', 'error');
    return;
  }
  try {
    updateRouteInfo(index, '経路を取得中...');
    const controller = await ensureMapReady();
    if (!controller) throw new Error('地図を読み込めないため、経路を表示できません。');
    const route = await fetchRoute({
      apiKey: currentSettings.apiKey,
      origin: currentPosition,
      destination: { lat: place.location.latitude, lng: place.location.longitude },
      travelMode: currentTravelMode,
    });
    controller.renderRoute(route.encodedPolyline);

    const durationText = formatDuration(route.durationSeconds);
    const distanceText = route.distanceMeters != null ? `${(route.distanceMeters / 1000).toFixed(1)}km` : null;
    const travelModeLabel = travelModeSelect.selectedOptions[0]?.textContent || '';
    updateRouteInfo(index, [travelModeLabel, durationText, distanceText].filter(Boolean).join(' / '));
  } catch (err) {
    console.error(err);
    updateRouteInfo(index, '');
    setStatus('search-status', err.message || '経路の取得に失敗しました。', 'error');
  }
}

// 一覧から地図の該当スポットへ(カードのクリックと「地図で見る」ボタンの共通処理)。
function focusOnMap(index) {
  if (!mapController) {
    setStatus('search-status', '地図を利用できません(APIキーの設定や通信状況を確認してください)。', 'error');
    return;
  }
  mapController.focusPlace(index, currentPlaces[index]);
  // スマホでは地図が画面外にあるため、見える位置まで戻す。
  if (!backToMapBtn.classList.contains('hidden')) {
    mapEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
}

function rerenderResults() {
  renderResults(currentPlaces, currentSettings.apiKey, {
    lang: currentResultsLanguage,
    onCardClick: focusOnMap,
    onFavoriteToggle: handleFavoriteToggle,
    onRouteClick: handleRouteClick,
    isFavorited,
    getDirectionsUrl: (place) =>
      buildDirectionsUrl({
        stops: [{ lat: place.location?.latitude, lng: place.location?.longitude, placeId: place.id }],
        origin: currentOriginMode === 'custom' ? currentPosition : null,
        travelMode: currentTravelMode,
      })?.url,
  });
  updateRouteButtons();
}

// ---- Google マップで順に回る / 共有 ----
const openRouteBtn = document.getElementById('open-route-btn');
const shareRouteBtn = document.getElementById('share-route-btn');
const favOpenRouteBtn = document.getElementById('fav-open-route-btn');
const favShareBtn = document.getElementById('fav-share-btn');

function updateRouteButtons() {
  openRouteBtn.disabled = shareRouteBtn.disabled = currentPlaces.length === 0;
  const hasFav = favoritesCache.some((f) => f.lat != null && f.lng != null);
  favOpenRouteBtn.disabled = favShareBtn.disabled = !hasFav;
}

function routeFrom(items, { toStop, toName }) {
  const stops = items.map(toStop);
  const route = buildDirectionsUrl({
    stops,
    origin: currentOriginMode === 'custom' ? currentPosition : null,
    travelMode: currentTravelMode,
  });
  return route && { ...route, names: items.slice(0, route.count).map(toName) };
}

const placeAdapter = {
  toStop: (p) => ({ lat: p.location?.latitude, lng: p.location?.longitude, placeId: p.id }),
  toName: (p) => p.displayName?.text || '名称不明',
};
const favoriteAdapter = {
  toStop: (f) => ({ lat: f.lat, lng: f.lng, placeId: f.place_id }),
  toName: (f) => f.display_name,
};

function handleOpenRoute(items, adapter, statusId) {
  const route = routeFrom(items, adapter);
  if (!route) return setStatus(statusId, '位置情報のあるスポットがありません。', 'error');
  window.open(route.url, '_blank', 'noopener,noreferrer');
  if (route.truncated) {
    setStatus(statusId, `Google マップで開ける地点は最大${MAX_STOPS}か所のため、先頭の${route.count}か所を開きました。`);
  }
}

async function handleShareRoute(items, adapter, statusId, title) {
  const route = routeFrom(items, adapter);
  if (!route) return setStatus(statusId, '位置情報のあるスポットがありません。', 'error');
  const text = buildShareText({ title, names: route.names, url: route.url });
  const result = await shareOrCopy({ title, text, url: route.url });
  const note = route.truncated ? `(先頭の${route.count}か所のみ)` : '';
  if (result === 'copied') setStatus(statusId, `共有用のリンクをコピーしました${note}。`, 'success');
  else if (result === 'unsupported') setStatus(statusId, `この端末では共有できません。次のリンクをコピーしてください: ${route.url}`);
  else if (result === 'shared') setStatus(statusId, `共有しました${note}。`, 'success');
}

openRouteBtn.addEventListener('click', () => handleOpenRoute(currentPlaces, placeAdapter, 'search-status'));
shareRouteBtn.addEventListener('click', () => handleShareRoute(currentPlaces, placeAdapter, 'search-status', '行きたい場所'));
favOpenRouteBtn.addEventListener('click', () =>
  handleOpenRoute(favoritesCache.filter((f) => f.lat != null && f.lng != null), favoriteAdapter, 'favorites-status')
);
favShareBtn.addEventListener('click', () =>
  handleShareRoute(favoritesCache.filter((f) => f.lat != null && f.lng != null), favoriteAdapter, 'favorites-status', 'お気に入りの場所')
);

async function runSearch(override) {
  if (!currentSettings.apiKey) {
    setStatus('search-status', 'APIキーを設定してください。', 'error');
    return;
  }

  // 検索中の二重実行(「この周辺を検索」「再検索」の連打など)で、古い結果が新しい結果を上書きするのを防ぐ。
  if (isSearching) {
    setStatus('search-status', '検索中です。完了してからもう一度お試しください。');
    return;
  }
  isSearching = true;

  const genre = genreSelect.value;
  currentGenre = genre;
  const { radiusMeters, maxCount } = clampSearchParams({
    radiusMeters: radiusSelect.value,
    maxCount: countSelect.value,
  });

  const locationMode = getLocationMode();

  searchBtn.disabled = true;
  searchBtn.textContent = '検索中…';
  resultsListEl.setAttribute('aria-busy', 'true');

  try {
    let position;
    let locationLabel;
    if (override) {
      position = { lat: override.lat, lng: override.lng };
      locationLabel = override.label;
    } else if (locationMode === 'saved') {
      const origin = savedOrigins.find((o) => o.id === savedOriginSelect.value);
      if (!origin) {
        setStatus('search-status', '保存した起点を選んでください(「よく使う起点を保存・管理」から追加できます)。', 'error');
        return;
      }
      position = { lat: origin.lat, lng: origin.lng };
      locationLabel = origin.name;
    } else if (locationMode === 'custom') {
      const query = locationQueryInput.value.trim();
      if (!query) {
        setStatus('search-status', '検索したい場所を入力してください。', 'error');
        return;
      }
      setStatus('search-status', '指定した場所を検索しています...');
      position = await geocodeLocation({ apiKey: currentSettings.apiKey, query, language: languageSelect.value });
      locationLabel = position.formattedAddress || query;
    } else {
      setStatus('search-status', '現在地を取得しています...');
      position = await getCurrentPosition();
      locationLabel = '現在地';
    }
    if (!isValidLatLng(position.lat, position.lng)) {
      throw new Error('検索地点の位置情報が正しくありません。場所を指定し直してください。');
    }
    currentPosition = position;
    currentOriginMode = override || locationMode !== 'current' ? 'custom' : 'current';
    lastSearchedPoint = { lat: position.lat, lng: position.lng, label: locationLabel };
    renderOrigins();
    lastSearchRadius = radiusMeters;
    const isLowAccuracy = position.accuracy != null && position.accuracy > LOW_ACCURACY_THRESHOLD_METERS;

    setStatus('search-status', '周辺のスポットを検索しています...');
    const { places, relaxed } = await searchNearbyTouristSpots({
      apiKey: currentSettings.apiKey,
      lat: position.lat,
      lng: position.lng,
      radiusMeters,
      maxCount,
      genre,
      language: languageSelect.value,
      region: regionSelect.value,
    });
    currentResultsLanguage = normalizeLanguage(languageSelect.value);

    setStatus('search-status', '各スポットの情報を補完しています...');
    // Wikipedia は補足情報。1件の失敗・遅延が検索全体を止めないよう、個別に失敗を吸収する。
    const wikipediaResults = await Promise.all(
      places.map((place) =>
        fetchWikipediaExtract(
          place.displayName?.text,
          place.location ? { lat: place.location.latitude, lng: place.location.longitude } : null,
          { lang: currentResultsLanguage }
        ).catch(() => null)
      )
    );
    const enrichedPlaces = places.map((place, index) => ({ ...place, _wikipedia: wikipediaResults[index] }));
    currentPlaces = sortPlaces(enrichedPlaces, currentSortKey, position, radiusMeters);

    // 地図の読み込みに失敗しても、検索結果の一覧は表示する。
    let controller = null;
    let mapError = null;
    try {
      controller = await ensureMapReady();
    } catch (err) {
      console.error(err);
      mapError = '地図を読み込めませんでした(一覧は表示しています)。';
    }
    if (controller) {
      controller.clearResults();
      controller.clearRoute();
      controller.setCurrentLocation(position, radiusMeters, locationLabel);
      controller.renderPlaces(currentPlaces, {
        onMarkerClick: (index) => {
          controller.panToMarker(index);
          scrollToCard(index);
        },
      });
    }

    rerenderResults();

    if (currentUser) {
      recordSearch({
        lat: position.lat,
        lng: position.lng,
        radiusMeters,
        maxCount,
        genre,
        locationLabel,
        places: currentPlaces,
        region: regionSelect.value,
        language: languageSelect.value,
      })
        .then(refreshHistory)
        .catch((err) => {
          console.error(err);
          setStatus('history-status', err.message, 'error');
        });
    }

    const relaxedNote = relaxed ? '(評価件数の少ないスポットを含みます)' : '';
    const mapNote = mapError ? ` ${mapError}` : '';

    if (isLowAccuracy) {
      setStatus(
        'search-status',
        `${currentPlaces.length}件のスポットが見つかりました${relaxedNote}。ただし現在地の精度が低い可能性があります(誤差約${Math.round(
          position.accuracy / 1000
        )}km)。VPN接続中やPCの位置情報サービスがオフの場合、実際の場所と大きくずれることがあります。VPNを切断するか、位置情報サービスを確認してください。`,
        'error'
      );
    } else {
      setStatus(
        'search-status',
        `${currentPlaces.length}件のスポットが見つかりました${relaxedNote}。${mapNote}`,
        mapError ? 'error' : 'success'
      );
    }
  } catch (err) {
    console.error(err);
    setStatus('search-status', err.message || '検索中にエラーが発生しました。', 'error');
  } finally {
    isSearching = false;
    searchBtn.disabled = !currentSettings.apiKey;
    searchBtn.textContent = SEARCH_BTN_LABEL;
    resultsListEl.removeAttribute('aria-busy');
  }
}

async function setupAuth() {
  await initAuth({
    onLogin: async (user) => {
      currentUser = user;
      await Promise.all([refreshFavorites(), refreshHistory()]);
      rerenderResults();
    },
    onLogout: () => {
      currentUser = null;
      favoritesCache = [];
      renderFavorites([], {});
      renderHistory([], {});
      setStatus('favorites-status', '');
      setStatus('history-status', '');
      rerenderResults();
    },
    onError: (message) => setStatus('search-status', message, 'error'),
  });
}

initSettingsPanel({
  onSaved: (settings) => {
    currentSettings = settings;
    updateSearchButtonState();
    // 一度読み込んだ Google マップのスクリプトは、ページを再読み込みするまで古いキーのまま。
    if (mapReadyPromise) {
      setStatus('search-status', 'APIキーを変更しました。地図に反映するには、ページを再読み込みしてください。');
    }
    mapController = null;
    mapReadyPromise = null;
    settingsDialog.close();
  },
  onCleared: () => {
    currentSettings = { apiKey: '' };
    updateSearchButtonState();
    mapController = null;
    mapReadyPromise = null;
  },
});

if (!currentSettings.apiKey) {
  settingsDialog.showModal();
}

updateSearchButtonState();
setupAuth();

searchBtn.addEventListener('click', () => runSearch());
