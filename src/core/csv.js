// CSV parsing and detection of place / value / time columns for data maps. Pure.
var GeoCsv = (function () {
  var CODE_HEADERS = ["code", "iso", "iso3", "iso_code", "iso3166", "country code", "country_code"];
  var NAME_HEADERS = ["entity", "country", "country name", "country_name", "name", "location"];
  var LAT_HEADERS = ["lat", "latitude"], LON_HEADERS = ["lon", "lng", "long", "longitude"];

  function parse(text) {
    var s = String(text || ""), rows = [], row = [], field = "", q = false, i = 0;
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    while (i < s.length) {
      var c = s.charAt(i);
      if (q) {
        if (c === "\"") {
          if (s.charAt(i + 1) === "\"") { field += "\""; i += 2; continue; }
          q = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === "\"") { q = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    // Blank rows (every cell empty, however many trailing commas) are dropped anywhere.
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
    // Real downloads (e.g. World Bank API_*.csv) can start with preamble rows above the
    // real header. Among the first 10 non-empty rows, the header is the first one whose
    // non-empty cell count is at least half of the max non-empty count in that window -
    // preamble rows are narrower (fewer populated cells) than the real header/data rows.
    function nonEmptyCount(r) { var n = 0; for (var i = 0; i < r.length; i++) if (String(r[i]).trim() !== "") n++; return n; }
    var headerIdx = 0;
    if (rows.length) {
      var firstRows = rows.slice(0, Math.min(10, rows.length));
      var maxCount = 0;
      firstRows.forEach(function (r) { maxCount = Math.max(maxCount, nonEmptyCount(r)); });
      for (var hi = 0; hi < firstRows.length; hi++) {
        if (nonEmptyCount(firstRows[hi]) >= maxCount / 2) { headerIdx = hi; break; }
      }
    }
    return { header: rows.length ? rows[headerIdx].map(function (h) { return h.trim(); }) : [], rows: rows.slice(headerIdx + 1) };
  }

  function toNumber(s) {
    var t = String(s == null ? "" : s).trim();
    if (!t) return null;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
    var n = Number(t);
    return isFinite(n) ? n : null;
  }

  function colIndex(table, column) { return table.header.indexOf(column); }
  function values(table, column) {
    var i = colIndex(table, column), out = [];
    table.rows.forEach(function (r) { var v = String(r[i] == null ? "" : r[i]).trim(); if (v) out.push(v); });
    return out;
  }
  function mostly(vals, test) {
    if (!vals.length) return false;
    var n = 0; vals.forEach(function (v) { if (test(v)) n++; });
    return n / vals.length >= 0.8;
  }
  // Plain "2000" or World Bank DataBank's "2000 [YR2000]"; year is always the leading 4 digits.
  function yearOfHeader(h) {
    var m = /^(\d{4})( \[YR\d{4}\])?$/.exec(h);
    if (!m) return null;
    var y = +m[1];
    return y >= 1800 && y <= 2100 ? y : null;
  }
  function isYearHeader(h) { return yearOfHeader(h) !== null; }
  function findHeader(table, names) {
    for (var i = 0; i < table.header.length; i++) if (names.indexOf(table.header[i].toLowerCase()) >= 0) return table.header[i];
    return null;
  }

  function placeKindOf(table, column) {
    var vals = values(table, column);
    if (mostly(vals, function (v) { return /^([A-Za-z]{3}|OWID_[A-Z]+)$/.test(v); })) return "iso3"; // OWID_WRL, OWID_KOS…
    if (mostly(vals, function (v) { return /^[A-Za-z]{2}$/.test(v); })) return "iso2";
    return "name";
  }

  function detect(table) {
    var place = null, nameColumn = findHeader(table, NAME_HEADERS);
    table.header.forEach(function (h) {
      if (place || CODE_HEADERS.indexOf(h.toLowerCase()) < 0) return;
      var kind = placeKindOf(table, h);
      if (kind !== "name") place = { column: h, kind: kind };
    });
    var latColumn = findHeader(table, LAT_HEADERS), lonColumn = findHeader(table, LON_HEADERS);
    if (!place && latColumn && lonColumn) place = { column: nameColumn || latColumn, kind: "latlon" };
    if (!place && nameColumn) place = { column: nameColumn, kind: "name" };

    var time = { layout: "none", yearColumn: null, yearColumns: [] };
    var yearCol = findHeader(table, ["year"]);
    if (!yearCol) {
      var dateCol = findHeader(table, ["date"]);
      if (dateCol && mostly(values(table, dateCol), function (v) { return /^\d{4}/.test(v); })) yearCol = dateCol;
    }
    var yearColumns = table.header.filter(isYearHeader).map(function (h) { return { column: h, year: yearOfHeader(h) }; });
    if (yearCol) time = { layout: "long", yearColumn: yearCol, yearColumns: [] };
    else if (yearColumns.length >= 2) time = { layout: "wide", yearColumn: null, yearColumns: yearColumns };

    var skip = [place && place.column, nameColumn, latColumn, lonColumn, time.yearColumn];
    var vals = table.header.filter(function (h) {
      if (skip.indexOf(h) >= 0 || isYearHeader(h)) return false;
      return mostly(values(table, h), function (v) { return toNumber(v) !== null; });
    });
    var seriesName = "Value";
    var ind = findHeader(table, ["indicator name", "series name"]);
    if (time.layout === "wide" && ind && table.rows.length) seriesName = table.rows[0][colIndex(table, ind)] || "Value";
    return { place: place, nameColumn: nameColumn, latColumn: latColumn, lonColumn: lonColumn, time: time, values: vals, seriesName: seriesName };
  }

  function buildSeries(table, choice) {
    var byKey = {}, order = [], minY = Infinity, maxY = -Infinity;
    var pi = colIndex(table, choice.placeColumn), ni = choice.nameColumn ? colIndex(table, choice.nameColumn) : -1;
    var lai = choice.latColumn ? colIndex(table, choice.latColumn) : -1, loi = choice.lonColumn ? colIndex(table, choice.lonColumn) : -1;
    var vi = choice.valueColumn ? colIndex(table, choice.valueColumn) : -1, yi = choice.yearColumn ? colIndex(table, choice.yearColumn) : -1;
    function place(r) {
      var raw = String(r[pi] == null ? "" : r[pi]).trim();
      var key = choice.placeKind === "iso3" || choice.placeKind === "iso2" ? raw.toUpperCase() : raw;
      var label = ni >= 0 && r[ni] ? String(r[ni]).trim() : raw;
      var id = key + "|" + label;
      if (!byKey[id]) {
        byKey[id] = { key: key, label: label, lat: lai >= 0 ? toNumber(r[lai]) : null, lon: loi >= 0 ? toNumber(r[loi]) : null, values: {} };
        order.push(id);
      }
      return byKey[id];
    }
    function put(p, year, v) {
      if (v === null) return;
      p.values[year] = v;
      if (choice.layout !== "none") { minY = Math.min(minY, year); maxY = Math.max(maxY, year); }
    }
    function parseYear(v) {
      var m = /^\s*(-?\d+)/.exec(String(v == null ? "" : v));
      return m ? parseInt(m[1], 10) : NaN;
    }
    table.rows.forEach(function (r) {
      var p = place(r);
      if (choice.layout === "long") put(p, parseYear(r[yi]), toNumber(r[vi]));
      else if (choice.layout === "wide") (choice.yearColumns || []).forEach(function (yc) { put(p, yc.year, toNumber(r[colIndex(table, yc.column)])); });
      else put(p, 0, toNumber(r[vi]));
    });
    var places = order.map(function (id) {
      var p = byKey[id];
      var series = Object.keys(p.values).map(function (y) { return [Number(y), p.values[y]]; }).sort(function (a, b) { return a[0] - b[0]; });
      return { key: p.key, label: p.label, lat: p.lat, lon: p.lon, series: series };
    });
    return { places: places, years: choice.layout === "none" || minY === Infinity ? null : [minY, maxY] };
  }

  return { parse: parse, toNumber: toNumber, detect: detect, placeKindOf: placeKindOf, buildSeries: buildSeries };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoCsv;
