// Nominatim place search: request path and response parsing.
var GeoSearch = (function () {
  function path(query) { return "/search?format=jsonv2&limit=5&accept-language=en&q=" + encodeURIComponent(query); }
  function parse(json) {
    return (json || []).map(function (r) {
      var b = r.boundingbox || [r.lat, r.lat, r.lon, r.lon];
      return { name: r.display_name, lat: Number(r.lat), lon: Number(r.lon), bbox: { south: Number(b[0]), north: Number(b[1]), west: Number(b[2]), east: Number(b[3]) } };
    });
  }
  // Nominatim's reverse lookup (what is at this spot), detail following the map zoom (3–18).
  function reversePath(lat, lon, zoom) {
    var z = Math.max(3, Math.min(18, Math.round(Number(zoom) || 0)));
    return "/reverse?format=jsonv2&accept-language=en&lat=" + Number(lat).toFixed(6) + "&lon=" + Number(lon).toFixed(6) + "&zoom=" + z;
  }
  // The place's own name, else the first part of its address; null when nothing was found.
  function reverseName(json) {
    if (!json || typeof json !== "object" || json.error) return null;
    var name = typeof json.name === "string" ? json.name.trim() : "";
    if (name) return name;
    var first = typeof json.display_name === "string" ? json.display_name.split(",")[0].trim() : "";
    return first || null;
  }
  return { path: path, parse: parse, reversePath: reversePath, reverseName: reverseName };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoSearch;
