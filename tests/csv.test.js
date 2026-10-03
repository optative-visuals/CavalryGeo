const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/core/csv.js");

const OWID = "Entity,Code,Year,Population (historical)\nFrance,FRA,2000,60.9\nFrance,FRA,2020,67.6\nWorld,OWID_WRL,2020,7800\nAfrica,,2020,1300\n";
const WB = "\"Country Name\",\"Country Code\",\"Indicator Name\",\"Indicator Code\",\"1960\",\"1961\"\r\n\"France\",\"FRA\",\"Population, total\",\"SP.POP.TOTL\",\"46621669\",\"47240543\"\r\n\"Japan\",\"JPN\",\"Population, total\",\"SP.POP.TOTL\",\"93216000\",\"94055000\"\r\n";
// I3: a real World Bank API download (API_*.csv) starts with preamble rows before the
// real header, and trailing commas on those preamble rows.
const WB_API_PREAMBLE = "\"Data Source\",\"World Development Indicators\",\r\n" +
  "\"\"\r\n" +
  "\"Last Updated Date\",\"2026-07-01\",\r\n" +
  "\"\"\r\n" +
  "\"Country Name\",\"Country Code\",\"Indicator Name\",\"Indicator Code\",\"1960\",\"1961\"\r\n" +
  "\"France\",\"FRA\",\"Population, total\",\"SP.POP.TOTL\",\"46621669\",\"47240543\"\r\n" +
  "\"Japan\",\"JPN\",\"Population, total\",\"SP.POP.TOTL\",\"93216000\",\"94055000\"\r\n";

test("parse handles quotes, embedded commas/quotes/newlines, CRLF and a BOM", () => {
  const t = V.parse("﻿a,b\r\n\"x, y\",\"say \"\"hi\"\"\"\r\n\"multi\nline\",2\r\n");
  assert.deepEqual(t.header, ["a", "b"]);
  assert.deepEqual(t.rows, [["x, y", "say \"hi\""], ["multi\nline", "2"]]);
});

test("toNumber", () => {
  assert.equal(V.toNumber("67.6"), 67.6);
  assert.equal(V.toNumber("-3"), -3);
  assert.equal(V.toNumber("1e6"), 1e6);
  assert.equal(V.toNumber("1,234,567"), 1234567);
  assert.equal(V.toNumber(""), null);
  assert.equal(V.toNumber("n/a"), null);
});

test("detect: Our World in Data long layout", () => {
  const d = V.detect(V.parse(OWID));
  assert.deepEqual(d.place, { column: "Code", kind: "iso3" });
  assert.equal(d.nameColumn, "Entity");
  assert.equal(d.time.layout, "long");
  assert.equal(d.time.yearColumn, "Year");
  assert.deepEqual(d.values, ["Population (historical)"]);
});

test("detect: World Bank wide layout", () => {
  const d = V.detect(V.parse(WB));
  assert.deepEqual(d.place, { column: "Country Code", kind: "iso3" });
  assert.equal(d.time.layout, "wide");
  assert.deepEqual(d.time.yearColumns, [{ column: "1960", year: 1960 }, { column: "1961", year: 1961 }]);
  assert.equal(d.seriesName, "Population, total");
});

test("detect: names only, no time; and lat/lon", () => {
  const d1 = V.detect(V.parse("Country,GDP\nFrance,2.9\nJapan,4.2\n"));
  assert.deepEqual(d1.place, { column: "Country", kind: "name" });
  assert.equal(d1.time.layout, "none");
  assert.deepEqual(d1.values, ["GDP"]);
  const d2 = V.detect(V.parse("Name,Lat,Lng,Visitors\nParis,48.85,2.35,30\n"));
  assert.deepEqual(d2.place, { column: "Name", kind: "latlon" });
  assert.equal(d2.latColumn, "Lat"); assert.equal(d2.lonColumn, "Lng");
  assert.deepEqual(d2.values, ["Visitors"]);
});

test("buildSeries: long layout, sorted, last duplicate wins, labels from the name column", () => {
  const table = V.parse(OWID + "France,FRA,2020,68.0\n");
  const s = V.buildSeries(table, { placeColumn: "Code", placeKind: "iso3", nameColumn: "Entity", valueColumn: "Population (historical)", layout: "long", yearColumn: "Year" });
  const fr = s.places.find((p) => p.key === "FRA");
  assert.equal(fr.label, "France");
  assert.deepEqual(fr.series, [[2000, 60.9], [2020, 68.0]]);
  assert.deepEqual(s.years, [2000, 2020]);
  assert.ok(s.places.find((p) => p.label === "Africa" && p.key === ""));
});

test("buildSeries: wide layout and no-time layout", () => {
  const w = V.buildSeries(V.parse(WB), { placeColumn: "Country Code", placeKind: "iso3", nameColumn: "Country Name", layout: "wide", yearColumns: [{ column: "1960", year: 1960 }, { column: "1961", year: 1961 }] });
  assert.deepEqual(w.places[1].series, [[1960, 93216000], [1961, 94055000]]);
  assert.deepEqual(w.years, [1960, 1961]);
  const n = V.buildSeries(V.parse("Country,GDP\nFrance,2.9\n"), { placeColumn: "Country", placeKind: "name", valueColumn: "GDP", layout: "none" });
  assert.deepEqual(n.places[0].series, [[0, 2.9]]);
  assert.equal(n.years, null);
});

test("placeKindOf guesses from the values", () => {
  const t = V.parse(OWID);
  assert.equal(V.placeKindOf(t, "Code"), "iso3");
  assert.equal(V.placeKindOf(t, "Entity"), "name");
});

// I3: real World Bank downloads have preamble rows before the header; parse must skip
// them (and any blank rows) and land on the real header, matching the clean fixture.
test("parse skips a World Bank preamble and detects the same table as the clean fixture (I3)", () => {
  const withPreamble = V.parse(WB_API_PREAMBLE);
  const clean = V.parse(WB);
  assert.deepEqual(withPreamble.header, clean.header);
  assert.deepEqual(withPreamble.rows, clean.rows);
  const d = V.detect(withPreamble);
  assert.deepEqual(d.place, { column: "Country Code", kind: "iso3" });
  assert.equal(d.time.layout, "wide");
  const choice = { placeColumn: "Country Code", placeKind: "iso3", nameColumn: "Country Name", layout: "wide", yearColumns: d.time.yearColumns };
  assert.deepEqual(V.buildSeries(withPreamble, choice), V.buildSeries(clean, choice));
});

test("parse: a normal file with no preamble is unaffected (I3 regression guard)", () => {
  const t = V.parse(OWID);
  assert.deepEqual(t.header, ["Entity", "Code", "Year", "Population (historical)"]);
  assert.equal(t.rows.length, 4);
});

// M2: long-layout year parsing used to slice the first 4 characters, breaking negative
// years (-10000 -> -100). Parse with the leading integer instead.
test("buildSeries: long layout year parsing handles negative years and still reads dates (M2)", () => {
  const table = V.parse("Entity,Code,Year,Population\nFrance,FRA,-10000,1\nFrance,FRA,2020-05-01,2\n");
  const s = V.buildSeries(table, { placeColumn: "Code", placeKind: "iso3", nameColumn: "Entity", valueColumn: "Population", layout: "long", yearColumn: "Year" });
  const fr = s.places.find((p) => p.key === "FRA");
  assert.deepEqual(fr.series, [[-10000, 1], [2020, 2]]);
});

// M3: World Bank DataBank downloads use headers like "2000 [YR2000]" for year columns.
test("detect and buildSeries treat 'YYYY [YRYYYY]' headers as year columns (M3)", () => {
  const csv = "Country Name,Country Code,2000 [YR2000],2001 [YR2001]\nFrance,FRA,60.9,61.5\n";
  const table = V.parse(csv);
  const d = V.detect(table);
  assert.equal(d.time.layout, "wide");
  assert.deepEqual(d.time.yearColumns, [{ column: "2000 [YR2000]", year: 2000 }, { column: "2001 [YR2001]", year: 2001 }]);
  const s = V.buildSeries(table, { placeColumn: "Country Code", placeKind: "iso3", nameColumn: "Country Name", layout: "wide", yearColumns: d.time.yearColumns });
  assert.deepEqual(s.places[0].series, [[2000, 60.9], [2001, 61.5]]);
});
