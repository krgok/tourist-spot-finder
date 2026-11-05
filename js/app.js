import { initSettingsPanel, loadSettings } from './settings.js?v=20260708-4';
import { initAuth } from './auth.js?v=20260708-4';
import { getCurrentPosition } from './geolocation.js?v=20260708-4';
import { searchNearbyTouristSpots, geocodeLocation, sortPlaces } from './places.js?v=20260708-4';
import { setStatus, renderResults, renderFavorites, renderHistory, updateRouteInfo, scrollToCard } from './ui.js?v=20260708-4';
import { MapController } from './map.js?v=20260708-4';
import { fetchWikipediaExtract } from './wikipedia.js?v=20260708-4';
import { LOW_ACCURACY_THRESHOLD_METERS, GENRES, SORT_OPTIONS, TRAVEL_MODES } from './config.js?v=20260708-4';
import { storageGet, storageSet } from './storage.js?v=20260708-4';
import { normalizeForUi, clampSearchParams, isOneOf } from './params.js?v=20260708-4';
import { isValidLatLng } from './validate.js?v=20260708-4';
import { addFavorite, removeFavorite, listFavorites } from './favorites.js?v=20260708-4';
import { recordSearch, listHistory, deleteHistoryEntry } from './history.js?v=20260708-4';
import { fetchRoute } from './routes.js?v=20260708-4';
import { formatDuration } from './format.js?v=20260708-4';

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

const searchBtn = document.getElementById('search-btn');
const genreSelect = document.getElementById('genre-select');
const genreDescriptionEl = document.getElementById('genre-description');
const radiusSelect = document.getElementById('radius-select');
const countSelect = document.getElementById('count-select');
const locationModeRadios = document.querySelectorAll('input[name="location-mode"]');
const locationQueryInput = document.getElementById('location-query-input');
const sortSelect = document.getElementById('sort-select');
const travelModeSelect = document.getElementById('travel-mode-select');
const backToMapBtn = document.getElementById('back-to-map-btn');
const mapEl = document.getElementById('map');

sortSelect.value = currentSortKey;
travelModeSelect.value = currentTravelMode;

backToMapBtn.addEventListener('click', () => {
  mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

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
updateGenreDescription();

locationModeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    locationQueryInput.classList.toggle('hidden', radio.value !== 'custom' || !radio.checked);
  });
});

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

async function refreshFavorites() {
  if (!currentUser) {
    favoritesCache = [];
    renderFavorites([], {});
    return;
  }
  try {
    favoritesCache = await listFavorites();
    renderFavorites(favoritesCache, { onRemove: handleRemoveFavorite, onSearchNear: handleFavoriteSearchNear });
    setStatus('favorites-status', '');
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
  locationQueryInput.classList.remove('hidden');
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
  if (entry.meta?.genre && GENRES[entry.meta.genre]) {
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

function rerenderResults() {
  renderResults(currentPlaces, currentSettings.apiKey, {
    onCardClick: (index) => mapController?.focusPlace(index, currentPlaces[index]),
    onFavoriteToggle: handleFavoriteToggle,
    onRouteClick: handleRouteClick,
    isFavorited,
  });
}

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

  try {
    let position;
    let locationLabel;
    if (override) {
      position = { lat: override.lat, lng: override.lng };
      locationLabel = override.label;
    } else if (locationMode === 'custom') {
      const query = locationQueryInput.value.trim();
      if (!query) {
        setStatus('search-status', '検索したい場所を入力してください。', 'error');
        return;
      }
      setStatus('search-status', '指定した場所を検索しています...');
      position = await geocodeLocation({ apiKey: currentSettings.apiKey, query });
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
    });

    setStatus('search-status', '各スポットの情報を補完しています...');
    // Wikipedia は補足情報。1件の失敗・遅延が検索全体を止めないよう、個別に失敗を吸収する。
    const wikipediaResults = await Promise.all(
      places.map((place) =>
        fetchWikipediaExtract(
          place.displayName?.text,
          place.location ? { lat: place.location.latitude, lng: place.location.longitude } : null
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
