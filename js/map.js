let mapsLoadPromise = null;

function loadMapsLibrary(apiKey) {
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }
    /* eslint-disable */
    (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
      b = b[c] || (b[c] = {});
      var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams,
        u = () => h || (h = new Promise(async (f, n) => {
          await (a = m.createElement("script"));
          e.set("libraries", [...r] + "");
          for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => h = n(Error(p + " could not load."));
          a.nonce = m.querySelector("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
      d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
    })({ key: apiKey, v: "weekly" });
    /* eslint-enable */
    resolve();
  });

  return mapsLoadPromise;
}

export class MapController {
  constructor() {
    this.map = null;
    this.markers = [];
    this.circle = null;
    this.currentLocationMarker = null;
    this.infoWindow = null;
    this.AdvancedMarkerElement = null;
    this.PinElement = null;
    this.routePolyline = null;
  }

  async init(apiKey) {
    await loadMapsLibrary(apiKey);
    const { Map, InfoWindow } = await google.maps.importLibrary('maps');
    const markerLib = await google.maps.importLibrary('marker');
    this.AdvancedMarkerElement = markerLib.AdvancedMarkerElement;
    this.PinElement = markerLib.PinElement;
    await google.maps.importLibrary('geometry');

    this.map = new Map(document.getElementById('map'), {
      center: { lat: 35.6812, lng: 139.7671 },
      zoom: 14,
      mapId: 'DEMO_MAP_ID',
    });
    this.infoWindow = new InfoWindow();
  }

  clearMarkers() {
    this.markers.forEach((m) => (m.map = null));
    this.markers = [];
  }

  clearResults() {
    this.clearMarkers();
    if (this.circle) {
      this.circle.setMap(null);
      this.circle = null;
    }
  }

  setCurrentLocation({ lat, lng }, radiusMeters, title = '現在地') {
    if (this.currentLocationMarker) {
      this.currentLocationMarker.map = null;
    }
    const pin = new this.PinElement({
      background: '#1a73e8',
      borderColor: '#0d47a1',
      glyphColor: '#fff',
    });
    this.currentLocationMarker = new this.AdvancedMarkerElement({
      map: this.map,
      position: { lat, lng },
      content: pin.element,
      title,
    });

    this.circle = new google.maps.Circle({
      map: this.map,
      center: { lat, lng },
      radius: radiusMeters,
      fillColor: '#1a73e8',
      fillOpacity: 0.08,
      strokeColor: '#1a73e8',
      strokeOpacity: 0.4,
      strokeWeight: 1,
    });

    this.map.setCenter({ lat, lng });
  }

  renderPlaces(places, { onMarkerClick } = {}) {
    const bounds = new google.maps.LatLngBounds();
    if (this.currentLocationMarker) {
      bounds.extend(this.currentLocationMarker.position);
    }

    places.forEach((place, index) => {
      if (!place.location) return;
      const position = { lat: place.location.latitude, lng: place.location.longitude };
      const pin = new this.PinElement({ glyph: String(index + 1) });
      const marker = new this.AdvancedMarkerElement({
        map: this.map,
        position,
        content: pin.element,
        title: place.displayName?.text || '',
      });
      marker.addListener('gmp-click', () => onMarkerClick?.(index));
      this.markers.push(marker);
      bounds.extend(position);
    });

    if (!bounds.isEmpty()) {
      this.map.fitBounds(bounds);
    }
  }

  clearRoute() {
    if (this.routePolyline) {
      this.routePolyline.setMap(null);
      this.routePolyline = null;
    }
  }

  renderRoute(encodedPolyline) {
    this.clearRoute();
    const path = google.maps.geometry.encoding.decodePath(encodedPolyline);
    this.routePolyline = new google.maps.Polyline({
      map: this.map,
      path,
      strokeColor: '#0d47a1',
      strokeOpacity: 0.8,
      strokeWeight: 4,
    });
    const bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));
    this.map.fitBounds(bounds);
  }

  // マーカー番号クリック時に使う。結果一覧の該当カードへの自動スクロールで
  // 詳細は既に表示されるため、地図上に名前の吹き出しは出さない(密集地では
  // 隣のマーカーと吹き出しが重なって見づらくなるため)。
  panToMarker(index) {
    const marker = this.markers[index];
    if (!marker) return;
    this.map.panTo(marker.position);
  }

  focusPlace(index, place) {
    const marker = this.markers[index];
    if (!marker) return;
    this.map.panTo(marker.position);
    this.infoWindow.setContent(`<strong>${place.displayName?.text || ''}</strong>`);
    this.infoWindow.open({ map: this.map, anchor: marker });
  }
}
