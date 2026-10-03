// Nominatim place search: request path and response parsing.
var GeoSearch = (function () {
  function path(query) { return "/search?format=jsonv2&limit=5&accept-language=en&q=" + encodeURIComponent(query); }
  function parse(json) {
    return (json || []).map(function (r) {
      var b = r.boundingbox || [r.lat, r.lat, r.lon, r.lon];
      return { name: r.display_name, lat: Number(r.lat), lon: Number(r.lon), bbox: { south: Number(b[0]), north: Number(b[1]), west: Number(b[2]), east: Number(b[3]) } };
    });
  }
  return { path: path, parse: parse };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoSearch;
