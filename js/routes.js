import { postGoogleApi, postProxy } from './http.js?v=20260708-4';
import { isValidLatLng } from './validate.js?v=20260708-4';
import { TRAVEL_MODES } from './config.js?v=20260708-4';

const ROUTES_FIELD_MASK = [
  'routes.polyline.encodedPolyline',
  'routes.distanceMeters',
  'routes.duration',
].join(',');

export async function fetchRoute({ apiKey, origin, destination, travelMode = 'WALK', proxy = null, fetchImpl }) {
  if (!isValidLatLng(origin?.lat, origin?.lng) || !isValidLatLng(destination?.lat, destination?.lng)) {
    throw new Error('出発地または目的地の位置が正しくありません。');
  }
  if (!TRAVEL_MODES[travelMode]) {
    throw new Error('移動手段が正しくありません。');
  }

  const data = proxy
    ? await postProxy({
        url: proxy.url,
        getToken: proxy.getToken,
        payload: { op: 'computeRoutes', origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng }, travelMode },
        fetchImpl,
      })
    : await postGoogleApi({
        url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
        apiKey,
        fieldMask: ROUTES_FIELD_MASK,
        body: {
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          travelMode,
        },
        apiLabel: 'Routes API',
        fetchImpl,
      });
  return parseRouteResponse(data);
}

// Routes API のレスポンスを、画面で使う形に整形する(通信を含まない純粋関数)。
export function parseRouteResponse(data) {
  const route = data?.routes?.[0];
  if (!route?.polyline?.encodedPolyline) {
    throw new Error('経路が見つかりませんでした。');
  }

  return {
    encodedPolyline: route.polyline.encodedPolyline,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.duration ? Number(String(route.duration).replace('s', '')) : null,
  };
}
