import { initSettingsPanel, loadSettings } from './settings.js';
import { initAuth } from './auth.js';
import { getCurrentPosition } from './geolocation.js';
import { searchNearbyTouristSpots } from './places.js';
import { setStatus, renderResults } from './ui.js';
import { MapController } from './map.js';
import { fetchWikipediaExtract } from './wikipedia.js';
import { LOW_ACCURACY_THRESHOLD_METERS } from './config.js';

let currentSettings = loadSettings();
let currentPlaces = [];
let mapController = null;
let mapReadyPromise = null;

const searchBtn = document.getElementById('search-btn');
const radiusSelect = document.getElementById('radius-select');
const countSelect = document.getElementById('count-select');

function updateSearchButtonState() {
  searchBtn.disabled = !currentSettings.apiKey;
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

async function runSearch() {
  if (!currentSettings.apiKey) {
    setStatus('search-status', 'APIキーを設定してください。', 'error');
    return;
  }

  const radiusMeters = Number(radiusSelect.value);
  const maxCount = Number(countSelect.value);

  searchBtn.disabled = true;
  setStatus('search-status', '現在地を取得しています...');

  try {
    const position = await getCurrentPosition();
    const isLowAccuracy = position.accuracy != null && position.accuracy > LOW_ACCURACY_THRESHOLD_METERS;

    setStatus('search-status', '観光地を検索しています...');
    const places = await searchNearbyTouristSpots({
      apiKey: currentSettings.apiKey,
      lat: position.lat,
      lng: position.lng,
      radiusMeters,
      maxCount,
    });

    setStatus('search-status', '各観光地の情報を補完しています...');
    const wikipediaResults = await Promise.all(
      places.map((place) => fetchWikipediaExtract(place.displayName?.text))
    );
    currentPlaces = places.map((place, index) => ({ ...place, _wikipedia: wikipediaResults[index] }));

    const controller = await ensureMapReady();
    if (controller) {
      controller.clearResults();
      controller.setCurrentLocation(position, radiusMeters);
      controller.renderPlaces(currentPlaces, {
        onMarkerClick: (index) => controller.focusPlace(index, currentPlaces[index]),
      });
    }

    renderResults(currentPlaces, currentSettings.apiKey, {
      onCardClick: (index) => controller?.focusPlace(index, currentPlaces[index]),
    });

    if (isLowAccuracy) {
      setStatus(
        'search-status',
        `${currentPlaces.length}件の観光地が見つかりました。ただし現在地の精度が低い可能性があります(誤差約${Math.round(
          position.accuracy / 1000
        )}km)。VPN接続中やPCの位置情報サービスがオフの場合、実際の場所と大きくずれることがあります。VPNを切断するか、位置情報サービスを確認してください。`,
        'error'
      );
    } else {
      setStatus('search-status', `${currentPlaces.length}件の観光地が見つかりました。`, 'success');
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
    clientId: currentSettings.clientId,
    onLogin: () => {},
    onLogout: () => {},
  });
}

initSettingsPanel({
  onSaved: (settings) => {
    currentSettings = settings;
    updateSearchButtonState();
    mapController = null;
    mapReadyPromise = null;
    setupAuth();
  },
  onCleared: () => {
    currentSettings = { apiKey: '', clientId: '' };
    updateSearchButtonState();
    mapController = null;
    mapReadyPromise = null;
    setupAuth();
  },
});

updateSearchButtonState();
setupAuth();

searchBtn.addEventListener('click', runSearch);
