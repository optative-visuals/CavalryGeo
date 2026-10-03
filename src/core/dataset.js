// Turns a parsed table into data-layer payloads: region series aligned with the countries
// layer, point series, value range and a match report. Pure.
if (typeof GeoCsv === "undefined" && typeof require !== "undefined") { var GeoCsv = require("./csv.js"); }
if (typeof GeoMatch === "undefined" && typeof require !== "undefined") { var GeoMatch = require("./match.js"); }
if (typeof GeoCodec === "undefined" && typeof require !== "undefined") { var GeoCodec = require("./codec.js"); }
var GeoDataset = (function () {
  function csvLocation(url) {
    var u = String(url || "").trim();
    var g = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(u);
    if (g) {
      var gid = /[#&?]gid=(\d+)/.exec(u);
      return { base: "https://docs.google.com", path: "/spreadsheets/d/" + g[1] + "/export?format=csv&gid=" + (gid ? gid[1] : "0") };
    }
    var m = /^(https?:\/\/[^\/?#]+)(.*)$/.exec(u);
    if (!m) throw new Error("Paste a Google Sheet or CSV link (starting with https://).");
    return { base: m[1], path: m[2] || "/" };
  }

  function defaultChoice(d) {
    return {
      placeColumn: d.place ? d.place.column : null, placeKind: d.place ? d.place.kind : "name",
      nameColumn: d.nameColumn, latColumn: d.latColumn, lonColumn: d.lonColumn,
      valueColumn: d.time.layout === "wide" ? null : (d.values[0] || null),
      layout: d.time.layout, yearColumn: d.time.yearColumn, yearColumns: d.time.yearColumns,
      seriesName: d.seriesName
    };
  }

  function ringAverage(enc, i) {
    var ring = GeoCodec.decodeRing(enc.f[i][1] || []), x = 0, y = 0;
    ring.forEach(function (p) { x += p[0]; y += p[1]; });
    return ring.length ? [x / ring.length, y / ring.length] : [0, 0];
  }

  function prepare(table, choice, countries, geocoded) {
    if (!choice.placeColumn) throw new Error("Couldn't find a country or place column — pick one in the Place dropdown.");
    var built = GeoCsv.buildSeries(table, choice);
    var idx = GeoMatch.buildIndex(countries.p);
    var regionSeries = countries.f.map(function () { return null; });
    var pts = [], ptSeries = [], unmatched = [], matched = 0;
    var min = Infinity, max = -Infinity, maxAbs = 0;
    function track(series) { series.forEach(function (yv) { min = Math.min(min, yv[1]); max = Math.max(max, yv[1]); maxAbs = Math.max(maxAbs, Math.abs(yv[1])); }); }
    built.places.forEach(function (p) {
      if (!p.series.length) return;
      if (choice.placeKind === "latlon") {
        if (p.lat === null || p.lon === null) { unmatched.push(p.label); return; }
        pts.push([p.lon, p.lat, p.label]); ptSeries.push(p.series); track(p.series); matched++; return;
      }
      var f = GeoMatch.findCountry(idx, p.key, choice.placeKind, p.label);
      if (f >= 0) {
        regionSeries[f] = p.series;
        var pr = countries.p[f], at = pr && pr.label ? pr.label : ringAverage(countries, f);
        pts.push([at[0], at[1], countries.f[f][0] || p.label]); ptSeries.push(p.series); track(p.series); matched++; return;
      }
      if (geocoded && geocoded[p.label]) {
        pts.push([geocoded[p.label][0], geocoded[p.label][1], p.label]); ptSeries.push(p.series); track(p.series); matched++; return;
      }
      unmatched.push(p.label);
    });
    // Natural Earth splits Somaliland (SOL) from Somalia (SOM) and Northern Cyprus (CYN)
    // from Cyprus (CYP). If the split region has no series of its own, colour it the
    // same as its parent - region colour only: not counted as matched, no extra points.
    var SPLIT_FALLBACK_ISO3 = { SOL: "SOM", CYN: "CYP" };
    (countries.p || []).forEach(function (pr, i) {
      if (!pr || regionSeries[i] !== null) return;
      var parentIso3 = SPLIT_FALLBACK_ISO3[pr.iso3];
      if (!parentIso3) return;
      for (var j = 0; j < countries.p.length; j++) {
        var other = countries.p[j];
        if (other && other.iso3 === parentIso3 && regionSeries[j] !== null) { regionSeries[i] = regionSeries[j]; break; }
      }
    });
    var range = matched ? { min: min, max: max, maxAbs: maxAbs } : { min: 0, max: 0, maxAbs: 0 };
    var title = choice.layout === "wide" ? (choice.seriesName || "Value") : (choice.valueColumn || "Value");
    return {
      regions: { geo: countries, series: regionSeries, range: range, years: built.years, title: title },
      points: { pts: pts, series: ptSeries, range: range, years: built.years, title: title },
      matched: matched, unmatched: unmatched, years: built.years, title: title
    };
  }

  return { csvLocation: csvLocation, defaultChoice: defaultChoice, prepare: prepare };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoDataset;
