// Natural Earth GeoJSON → ranked features.
if (typeof GeoGeometry === "undefined" && typeof require !== "undefined") { var GeoGeometry = require("./geometry.js"); }
var GeoNE = (function () {
  var CATEGORIES = {
    countries: { file: "admin_0_countries", kind: "polygon" },
    states: { file: "admin_1_states_provinces", kind: "polygon" },
    coastlines: { file: "coastline", kind: "line" },
    lakes: { file: "lakes", kind: "polygon" },
    rivers: { file: "rivers_lake_centerlines", kind: "line" },
    cities: { file: "populated_places", kind: "point" }
  };
  var SCALES = ["110m", "50m", "10m"];

  function sourcePath(category, scale) {
    return "/nvkelso/natural-earth-vector/master/geojson/ne_" + scale + "_" + CATEGORIES[category].file + ".geojson";
  }

  function prop(p, names) {
    for (var i = 0; i < names.length; i++) if (p[names[i]] !== undefined && p[names[i]] !== null) return p[names[i]];
    return undefined;
  }
  function xy(c) { return [c[0], c[1]]; }
  function ringsOf(list) { return list.map(function (r) { return r.map(xy); }); }

  // First ring of a GeoJSON polygon is its outer ring, the rest are holes.
  // Normalise winding so fills are correct under both non-zero and even-odd rules.
  function normalizePolygonRings(rings) {
    return rings.map(function (r, i) { return GeoGeometry.orientRing(r, i === 0); });
  }

  function geometryRings(g) {
    if (!g) return [];
    switch (g.type) {
      case "Polygon": return normalizePolygonRings(ringsOf(g.coordinates));
      case "MultiPolygon": return [].concat.apply([], g.coordinates.map(function (poly) { return normalizePolygonRings(ringsOf(poly)); }));
      case "LineString": return [g.coordinates.map(xy)];
      case "MultiLineString": return ringsOf(g.coordinates);
      case "Point": return [[xy(g.coordinates)]];
      case "MultiPoint": return g.coordinates.map(function (c) { return [xy(c)]; });
      default: return [];
    }
  }

  // Codes, names and label point used to match data rows to countries (data maps).
  function countryProps(p) {
    function code(keys, len) {
      for (var i = 0; i < keys.length; i++) {
        var v = p[keys[i]];
        if (typeof v === "string" && v.length === len && v !== "-99" && /^[A-Z]+$/.test(v)) return v;
      }
      return "";
    }
    var names = [];
    ["NAME", "NAME_LONG", "ADMIN", "NAME_EN", "FORMAL_EN"].forEach(function (k) {
      var v = p[k];
      if (typeof v === "string" && v && names.indexOf(v) < 0) names.push(v);
    });
    var hasLabel = p.LABEL_X != null && p.LABEL_Y != null && isFinite(Number(p.LABEL_X)) && isFinite(Number(p.LABEL_Y));
    return { iso3: code(["ISO_A3_EH", "ISO_A3", "ADM0_A3"], 3), iso2: code(["ISO_A2_EH", "ISO_A2"], 2), names: names, label: hasLabel ? [Number(p.LABEL_X), Number(p.LABEL_Y)] : null };
  }

  function rank(category, p, rings) {
    if (category === "cities") return Number(prop(p, ["POP_MAX", "pop_max"])) || 0;
    if (category === "rivers") return 20 - (Number(prop(p, ["scalerank", "SCALERANK"])) || 10) + GeoGeometry.totalLengthKm(rings) / 1e6;
    if (category === "coastlines") return GeoGeometry.totalLengthKm(rings);
    return GeoGeometry.totalAreaKm2(rings);
  }

  function fromGeoJSON(category, geojson) {
    var cat = CATEGORIES[category];
    if (!cat) throw new Error("Unknown world category: " + category);
    var features = [];
    (geojson.features || []).forEach(function (f) {
      var rings = geometryRings(f.geometry);
      if (!rings.length) return;
      var p = f.properties || {};
      var feature = { name: String(prop(p, ["NAME", "name", "NAME_EN", "name_en"]) || ""), rank: rank(category, p, rings), rings: rings };
      if (category === "countries") feature.props = countryProps(p);
      features.push(feature);
    });
    return { kind: cat.kind, features: features };
  }

  return { CATEGORIES: CATEGORIES, SCALES: SCALES, sourcePath: sourcePath, fromGeoJSON: fromGeoJSON };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoNE;
