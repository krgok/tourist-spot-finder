const ROUTES_FIELD_MASK = [
  'routes.polyline.encodedPolyline',
  'routes.distanceMeters',
  'routes.duration',
].join(',');

export async function fetchRoute({ apiKey, origin, destination, travelMode = 'WALK' }) {
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': ROUTES_FIELD_MASK,
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body?.error?.message || `経路の取得に失敗しました (HTTP ${response.status})`;
    if (response.status === 403) {
      throw new Error('APIキーが無効か、Routes API が有効化されていません: ' + message);
    }
    throw new Error(message);
  }

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route?.polyline?.encodedPolyline) {
    throw new Error('経路が見つかりませんでした。');
  }

  return {
    encodedPolyline: route.polyline.encodedPolyline,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.duration ? Number(route.duration.replace('s', '')) : null,
  };
}
