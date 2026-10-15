/* Geohash encoder matching geofire-common (precision 10).
   Browser: window.ChauatGeo. Node tests: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChauatGeo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

  function geohashForLocation(lat, lng, precision) {
    var hash = '';
    var hashVal = 0;
    var bits = 0;
    var even = true;
    var latRange = [-90, 90];
    var lngRange = [-180, 180];
    var limit = precision || 10;
    var latitude = Number(lat);
    var longitude = Number(lng);
    while (hash.length < limit) {
      var range = even ? lngRange : latRange;
      var value = even ? longitude : latitude;
      var mid = (range[0] + range[1]) / 2;
      if (value > mid) {
        hashVal = (hashVal << 1) + 1;
        range[0] = mid;
      } else {
        hashVal = (hashVal << 1) + 0;
        range[1] = mid;
      }
      even = !even;
      if (bits < 4) bits++;
      else {
        bits = 0;
        hash += BASE32[hashVal];
        hashVal = 0;
      }
    }
    return hash;
  }

  return { geohashForLocation: geohashForLocation };
});
