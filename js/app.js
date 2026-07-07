import { initSettingsPanel, loadSettings } from './settings.js?v=20260708-3';
import { initAuth } from './auth.js?v=20260708-3';
import { getCurrentPosition } from './geolocation.js?v=20260708-3';
import { searchNearbyTouristSpots, geocodeLocation, sortPlaces } from './places.js?v=20260708-3';
import { setStatus, renderResults, renderFavorites, renderHistory, updateRouteInfo, scrollToCard } from './ui.js?v=20260708-3';
import { MapController } from './map.js?v=20260708-3';
import { fetchWikipediaExtract } from './wikipedia.js?v=20260708-3';
import { LOW_ACCURACY_THRESHOLD_METERS, GENRES } from './config.js?v=20260708-3';
import { addFavorite, removeFavorite, listFavorites } from './favorites.js?v=20260708-3';
import { recordSearch, listHistory, deleteHistoryEntry } from './history.js?v=20260708-3';
import { fetchRoute } from './routes.js?v=20260708-3';

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
let currentSortKey = localStorage.getItem(SORT_KEY_STORAGE) || 'recommended';
let currentTravelMode = localStorage.getItem(TRAVEL_MODE_STORAGE) || 'WALK';

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
  localStorage.setItem(SORT_KEY_STORAGE, currentSortKey);
  applySortAndRerender();
});

travelModeSelect.addEventListener('change', () => {
  currentTravelMode = travelModeSelect.value;
  localStorage.setItem(TRAVEL_MODE_STORAGE, currentTravelMode);
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
    mapController = new MapController();
    mapReadyPromise = mapController.init(currentSettings.apiKey);
  }
  await mapReadyPromise;
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
  favoritesCache = await listFavorites();
  renderFavorites(favoritesCache, { onRemove: handleRemoveFavorite, onSearchNear: handleFavoriteSearchNear });
}

async function refreshHistory() {
  if (!currentUser) {
    renderHistory([], {});
    return;
  }
  const history = await listHistory();
  renderHistory(history, { onDelete: handleDeleteHistory, onRerun: handleHistoryRerun });
}

function applyPositionOverride(label) {
  document.querySelector('input[name="location-mode"][value="custom"]').checked = true;
  locationQueryInput.classList.remove('hidden');
  locationQueryInput.value = label;
}

function handleFavoriteSearchNear(fav) {
  if (fav.lat == null || fav.lng == null) return;
  const label = fav.display_name ? `${fav.display_name}の周辺` : 'お気に入り周辺';
  applyPositionOverride(label);
  runSearch({ lat: fav.lat, lng: fav.lng, label });
}

function handleHistoryRerun(entry) {
  if (entry.meta?.genre && GENRES[entry.meta.genre]) {
    genreSelect.value = entry.meta.genre;
    updateGenreDescription();
  }
  radiusSelect.value = String(entry.radius_meters);
  countSelect.value = String(entry.max_count);
  const label = entry.meta?.locationLabel || '過去の検索地点';
  applyPositionOverride(label);
  runSearch({ lat: entry.lat, lng: entry.lng, label });
}

function applySortAndRerender() {
  if (!currentPlaces.length) return;
  currentPlaces = sortPlaces(currentPlaces, currentSortKey, currentPosition, Number(radiusSelect.value));
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
  }
}

async function handleDeleteHistory(id) {
  try {
    await deleteHistoryEntry(id);
    await refreshHistory();
  } catch (err) {
    console.error(err);
  }
}

function formatDuration(seconds) {
  if (seconds == null) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}時間${remainMinutes}分`;
}

async function handleRouteClick(index) {
  const place = currentPlaces[index];
  if (!currentPosition || !place.location) return;
  if (!currentSettings.apiKey) {
    setStatus('search-status', 'APIキーを設定してください。', 'error');
    return;
  }
  try {
    updateRouteInfo(index, '経路を取得中...');
    const controller = await ensureMapReady();
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

  const genre = genreSelect.value;
  currentGenre = genre;
  const radiusMeters = Number(radiusSelect.value);
  const maxCount = Number(countSelect.value);

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
    currentPosition = position;
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
    const wikipediaResults = await Promise.all(
      places.map((place) => fetchWikipediaExtract(place.displayName?.text))
    );
    const enrichedPlaces = places.map((place, index) => ({ ...place, _wikipedia: wikipediaResults[index] }));
    currentPlaces = sortPlaces(enrichedPlaces, currentSortKey, position, radiusMeters);

    const controller = await ensureMapReady();
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
        .catch((err) => console.error(err));
    }

    const relaxedNote = relaxed ? '(評価件数の少ないスポットを含みます)' : '';

    if (isLowAccuracy) {
      setStatus(
        'search-status',
        `${currentPlaces.length}件のスポットが見つかりました${relaxedNote}。ただし現在地の精度が低い可能性があります(誤差約${Math.round(
          position.accuracy / 1000
        )}km)。VPN接続中やPCの位置情報サービスがオフの場合、実際の場所と大きくずれることがあります。VPNを切断するか、位置情報サービスを確認してください。`,
        'error'
      );
    } else {
      setStatus('search-status', `${currentPlaces.length}件のスポットが見つかりました${relaxedNote}。`, 'success');
    }
  } catch (err) {
    console.error(err);
    setStatus('search-status', err.message || '検索中にエラーが発生しました。', 'error');
  } finally {
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
      rerenderResults();
    },
  });
}

initSettingsPanel({
  onSaved: (settings) => {
    currentSettings = settings;
    updateSearchButtonState();
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
