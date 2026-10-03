// OpenStreetMap (Overpass API) queries and parsing into ranked features.
if (typeof GeoGeometry === "undefined" && typeof require !== "undefined") { var GeoGeometry = require("./geometry.js"); }
var GeoOSM = (function () {
  var ROAD = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, residential: 4, unclassified: 3.5, living_street: 3, service: 2 };
  var RAIL = { rail: 4, light_rail: 3, subway: 3, narrow_gauge: 2, monorail: 2, tram: 2 };
  var PARK_LANDUSE = '"landuse"~"^(grass|forest|meadow|recreation_ground)$"';

  function roadClass(h) {
    if (!h) return 1;
    var base = h.replace(/_link$/, ""), v = ROAD[base];
    if (v === undefined) return 1;
    return h !== base ? v - 0.5 : v;
  }
  function classAndLength(cls, rings) { return cls + Math.min(GeoGeometry.totalLengthKm(rings), 999) / 1000; }
  function byArea(tags, rings) { return GeoGeometry.totalAreaKm2(rings); }

  var CATEGORIES = {
    buildings: { kind: "polygon", mainKeep: 0.3, rank: byArea,
      select: { all: ['way["building"]', 'relation["building"]["type"="multipolygon"]'] } },
    roads: { kind: "line", rank: function (t, r) { return classAndLength(roadClass(t.highway), r); },
      select: { all: ['way["highway"]'], main: ['way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]'] } },
    water: { kind: "polygon", rank: byArea,
      select: { all: ['way["natural"="water"]', 'relation["natural"="water"]', 'way["waterway"="riverbank"]'] } },
    parks: { kind: "polygon", rank: byArea,
      select: { all: ['way["leisure"="park"]', 'relation["leisure"="park"]', "way[" + PARK_LANDUSE + "]", "relation[" + PARK_LANDUSE + "]", 'way["natural"="wood"]', 'relation["natural"="wood"]'] } },
    railways: { kind: "line", rank: function (t, r) { return classAndLength(RAIL[t.railway] || 1, r); },
      select: { all: ['way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge|monorail)$"]'], main: ['way["railway"="rail"]'] } }
  };

  function bboxString(b) {
    return "(" + [b.south, b.west, b.north, b.east].map(function (v) { return v.toFixed(6); }).join(",") + ")";
  }

  function buildQuery(category, bbox, mode) {
    var cat = CATEGORIES[category];
    if (!cat) throw new Error("Unknown street category: " + category);
    var sels = (mode === "main" && cat.select.main) || cat.select.all, bb = bboxString(bbox);
    return "[out:json][timeout:90];(" + sels.map(function (s) { return s + bb + ";"; }).join("") + ");out geom;";
  }

  function toRing(geometry) { return geometry.map(function (p) { return [p.lon, p.lat]; }); }

  function parse(category, json, mode) {
    var cat = CATEGORIES[category], features = [], seen = {};
    (json.elements || []).forEach(function (el) {
      var key = el.type + ":" + el.id;
      if (seen[key]) return;
      seen[key] = true;
      var tags = el.tags || {}, rings;
      if (el.type === "way" && el.geometry) {
        var ring = toRing(el.geometry);
        if (ring.length < 2) return;
        if (cat.kind === "polygon" && (!GeoGeometry.isClosed(ring) || ring.length < 4)) return;
        rings = cat.kind === "polygon" ? [GeoGeometry.orientRing(ring, true)] : [ring];
      } else if (el.type === "relation" && el.members && cat.kind === "polygon") {
        var outer = [], inner = [];
        el.members.forEach(function (m) { if (m.type === "way" && m.geometry) (m.role === "inner" ? inner : outer).push(toRing(m.geometry)); });
        var outerRings = GeoGeometry.joinRings(outer).map(function (r) { return GeoGeometry.orientRing(r, true); });
        var innerRings = GeoGeometry.joinRings(inner).map(function (r) { return GeoGeometry.orientRing(r, false); });
        rings = outerRings.concat(innerRings);
        if (!rings.length) return;
      } else {
        return;
      }
      features.push({ name: tags.name || "", rank: cat.rank(tags, rings), rings: rings });
    });
    if (mode === "main" && cat.mainKeep) {
      features.sort(function (a, b) { return b.rank - a.rank; });
      features = features.slice(0, Math.ceil(features.length * cat.mainKeep));
    }
    return { kind: cat.kind, features: features };
  }

  return { CATEGORIES: CATEGORIES, buildQuery: buildQuery, parse: parse };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoOSM;
