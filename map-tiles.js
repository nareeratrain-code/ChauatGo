/* Shared Leaflet base map for customer and rider screens.
   OpenStreetMap standard raster: detailed streets, and Thai labels where
   the map data has a local name. The public CARTO CDN currently answers
   with an unauthorized placeholder, so it is not used. No API key. */
(function (root) {
  var ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  function ensureStyles() {
    if (document.getElementById('chauat-map-styles')) return;
    var style = document.createElement('style');
    style.id = 'chauat-map-styles';
    style.textContent = ''
      + '@keyframes cgPinPulse{0%{transform:scale(.55);opacity:.5}100%{transform:scale(1.7);opacity:0}}'
      + '#place-detail-map,#rider-job-map,#track-map,#main-map,#map-picker-map{background:#d5dee6}'
      + '.leaflet-container .leaflet-control-attribution{font-size:10px;line-height:1.35;max-width:72%;background:rgba(255,255,255,.88);color:#333}';
    document.head.appendChild(style);
  }

  function addBaseTiles(map) {
    if (!map || typeof L === 'undefined') return null;
    ensureStyles();
    return L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      /* On a retina phone Leaflet requests the next zoom and draws it
         sharper, instead of stretching a blurry 256px tile. */
      detectRetina: true,
      crossOrigin: 'anonymous'
    }).addTo(map);
  }

  function point(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    if (la === 0 && ln === 0) return null;
    return { lat: la, lng: ln };
  }

  function same(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lng - b.lng) < 0.00001;
  }

  function pin(emoji, color, pulse) {
    var pulseHtml = pulse
      ? '<div style="position:absolute;top:2px;left:2px;width:36px;height:36px;border-radius:50%;background:' + color + ';opacity:.4;animation:cgPinPulse 1.6s ease-out infinite"></div>'
      : '';
    var html = '<div style="position:relative;width:40px;height:50px">'
      + pulseHtml
      + '<div style="position:absolute;top:0;left:0;width:40px;height:40px;border-radius:50%;background:' + color + ';border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1">' + emoji + '</div>'
      + '<div style="position:absolute;left:14px;top:36px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:10px solid ' + color + '"></div>'
      + '</div>';
    return L.divIcon({
      className: '',
      html: html,
      iconSize: [40, 50],
      iconAnchor: [20, 48],
      popupAnchor: [0, -44]
    });
  }

  function fit(map, latlngs, fallbackZoom) {
    var pts = (latlngs || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
    if (!map || !pts.length) return;
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lng], fallbackZoom || 18);
      return;
    }
    try {
      map.fitBounds(L.latLngBounds(pts.map(function (p) { return [p.lat, p.lng]; })), {
        padding: [36, 36],
        maxZoom: 18
      });
    } catch (e) {}
  }

  function route(map, existing, latlngs) {
    if (existing && map) {
      try { map.removeLayer(existing); } catch (e) {}
    }
    var pts = (latlngs || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
    if (!map || pts.length < 2) return null;
    var coords = pts.map(function (p) { return [p.lat, p.lng]; });
    var group = L.layerGroup();
    L.polyline(coords, { color: '#ffffff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(group);
    L.polyline(coords, { color: '#1565C0', weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(group);
    group.addTo(map);
    return group;
  }

  root.ChauatMap = {
    addBaseTiles: addBaseTiles,
    point: point,
    same: same,
    pin: pin,
    fit: fit,
    route: route,
    COLORS: {
      shop: '#FF6B35',
      customer: '#00A651',
      rider: '#1565C0',
      user: '#2196F3',
      dest: '#E53935',
      place: '#6A1B9A'
    }
  };
})(window);
