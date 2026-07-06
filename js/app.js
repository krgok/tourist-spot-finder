import { initSettingsPanel, loadSettings } from './settings.js';
import { initAuth } from './auth.js';
import { getCurrentPosition } from './geolocation.js';
import { searchNearbyTouristSpots, geocodeLocation } from './places.js';
import { setStatus, renderResults, renderFavorites, renderHistory } from './ui.js';
import { MapController } from './map.js';
import { fetchWikipediaExtract } from './wikipedia.js';
import { LOW_ACCURACY_THRESHOLD_METERS, GENRES } from './config.js';
import { addFavorite, removeFavorite, listFavorites } from './favorites.js';
import { recordSearch, listHistory, deleteHistoryEntry } from './history.js';
import { fetchRoute } from './routes.js';

let currentSettings = loadSettings();
let currentPlaces = [];
let currentPosition = null;
let mapController = null;
let mapReadyPromise = null;
let currentUser = null;
let favoritesCache = [];
let currentGenre = 'sightseeing';

const searchBtn = document.getElementById('search-btn');
const genreSelect = document.getElementById('genre-select');
const genreDescriptionEl = document.getElementById('genre-description');
const radiusSelect = document.getElementById('radius-select');
const countSelect = document.getElementById('count-select');
const locationModeRadios = document.querySelectorAll('input[name="location-mode"]');
const locationQueryInput = document.getElementById('location-query-input');

function updateSearchButtonState() {
  searchBtn.disabled = !currentSettings.apiKey;
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
  renderFavorites(favoritesCache, { onRemove: handleRemoveFavorite });
}

async function refreshHistory() {
  if (!currentUser) {
    renderHistory([], {});
    return;
  }
  const history = await listHistory();
  renderHistory(history, { onDelete: handleDeleteHistory });
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

async function handleRouteClick(index) {
  const place = currentPlaces[index];
  if (!currentPosition || !place.location) return;
  if (!currentSettings.apiKey) {
    setStatus('search-status', 'APIキーを設定してください。', 'error');
    return;
  }
  try {
    const controller = await ensureMapReady();
    const route = await fetchRoute({
      apiKey: currentSettings.apiKey,
      origin: currentPosition,
      destination: { lat: place.location.latitude, lng: place.location.longitude },
    });
    controller.renderRoute(route.encodedPolyline);
  } catch (err) {
    console.error(err);
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

async function runSearch() {
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
    if (locationMode === 'custom') {
      const query = locationQueryInput.value.trim();
      if (!query) {
        setStatus('search-status', '検索したい場所を入力してください。', 'error');
        return;
      }
      setStatus('search-status', '指定した場所を検索しています...');
      position = await geocodeLocation({ apiKey: currentSettings.apiKey, query });
    } else {
      setStatus('search-status', '現在地を取得しています...');
      position = await getCurrentPosition();
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
    currentPlaces = places.map((place, index) => ({ ...place, _wikipedia: wikipediaResults[index] }));

    const controller = await ensureMapReady();
    if (controller) {
      controller.clearResults();
      controller.clearRoute();
      controller.setCurrentLocation(position, radiusMeters, locationMode === 'custom' ? '検索地点' : '現在地');
      controller.renderPlaces(currentPlaces, {
        onMarkerClick: (index) => controller.focusPlace(index, currentPlaces[index]),
      });
    }

    rerenderResults();

    if (currentUser) {
      recordSearch({
        lat: position.lat,
        lng: position.lng,
        radiusMeters,
        maxCount,
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
  },
  onCleared: () => {
    currentSettings = { apiKey: '' };
    updateSearchButtonState();
    mapController = null;
    mapReadyPromise = null;
  },
});

updateSearchButtonState();
setupAuth();

searchBtn.addEventListener('click', runSearch);
