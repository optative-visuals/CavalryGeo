const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../src/core/dataset.js");
const V = require("../src/core/csv.js");
const C = require("../src/core/codec.js");

const countries = C.encodeLayer({ kind: "polygon", features: [
  { name: "France", rank: 5, rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]], props: { iso3: "FRA", iso2: "FR", names: ["France"], label: [2.5, 46.7] } },
  { name: "Japan", rank: 4, rings: [[[130, 30], [140, 30], [140, 40], [130, 30]]], props: { iso3: "JPN", iso2: "JP", names: ["Japan"], label: null } },
  { name: "Brazil", rank: 3, rings: [[[-60, -10], [-50, -10], [-50, 0], [-60, -10]]], props: { iso3: "BRA", iso2: "BR", names: ["Brazil"], label: [-53, -10] } }
] });
const CSV = "Entity,Code,Year,Population\nFrance,FRA,2000,60.9\nFrance,FRA,2020,67.6\nJapan,JPN,2000,126.8\nJapan,JPN,2020,125.8\nWorld,OWID_WRL,2020,7800\n";

test("csvLocation: Google Sheet links become the CSV export, others pass through", () => {
  assert.deepEqual(D.csvLocation("https://docs.google.com/spreadsheets/d/1ExampleSheetId_abcdefghijklmnopqrstuvwx/edit?gid=123456789#gid=123456789"),
    { base: "https://docs.google.com", path: "/spreadsheets/d/1ExampleSheetId_abcdefghijklmnopqrstuvwx/export?format=csv&gid=123456789" });
  assert.deepEqual(D.csvLocation("https://docs.google.com/spreadsheets/d/abc_DEF-1/edit"), { base: "https://docs.google.com", path: "/spreadsheets/d/abc_DEF-1/export?format=csv&gid=0" });
  assert.deepEqual(D.csvLocation("https://ourworldindata.org/grapher/population.csv?v=1"), { base: "https://ourworldindata.org", path: "/grapher/population.csv?v=1" });
  assert.throws(() => D.csvLocation("population.csv"), /Paste a Google Sheet or CSV link/);
});

test("prepare: regions aligned with countries, points at label points, unmatched reported", () => {
  const table = V.parse(CSV);
  const choice = D.defaultChoice(V.detect(table));
  assert.equal(choice.valueColumn, "Population");
  const p = D.prepare(table, choice, countries);
  assert.deepEqual(p.regions.series[0], [[2000, 60.9], [2020, 67.6]]);
  assert.deepEqual(p.regions.series[1], [[2000, 126.8], [2020, 125.8]]);
  assert.equal(p.regions.series[2], null);
  assert.deepEqual(p.unmatched, ["World"]);
  assert.equal(p.matched, 2);
  assert.deepEqual(p.years, [2000, 2020]);
  assert.deepEqual(p.regions.range, { min: 60.9, max: 126.8, maxAbs: 126.8 });
  assert.equal(p.title, "Population");
  assert.deepEqual(p.points.pts[0], [2.5, 46.7, "France"]);
  assert.equal(p.points.pts[1][2], "Japan");
  assert.ok(Math.abs(p.points.pts[1][0] - 135) < 1e-6, "no label point: average of the first ring's points (closing point included)");
});

// M1: Natural Earth splits Somaliland (SOL) from Somalia (SOM) and Northern Cyprus
// (CYN) from Cyprus (CYP). A region with no data of its own should inherit its parent's
// series for colouring only - it must not become "matched" or gain extra points.
test("prepare: Somaliland/Northern Cyprus inherit Somalia/Cyprus's series for colour only (M1)", () => {
  const withSplits = C.encodeLayer({ kind: "polygon", features: [
    { name: "Somalia", rank: 5, rings: [[[40, 5], [45, 5], [45, 10], [40, 5]]], props: { iso3: "SOM", iso2: "SO", names: ["Somalia"], label: [42, 7] } },
    { name: "Somaliland", rank: 4, rings: [[[44, 9], [49, 9], [49, 11], [44, 9]]], props: { iso3: "SOL", iso2: "XX", names: ["Somaliland"], label: [46, 10] } },
    { name: "Cyprus", rank: 3, rings: [[[32, 34], [34, 34], [34, 36], [32, 34]]], props: { iso3: "CYP", iso2: "CY", names: ["Cyprus"], label: [33, 35] } },
    { name: "N. Cyprus", rank: 2, rings: [[[33, 35], [34, 35], [34, 36], [33, 35]]], props: { iso3: "CYN", iso2: "XX", names: ["N. Cyprus"], label: [33.5, 35.5] } }
  ] });
  const csv = "Entity,Code,Year,Population\nSomalia,SOM,2020,16.0\nCyprus,CYP,2020,1.2\n";
  const table = V.parse(csv);
  const choice = D.defaultChoice(V.detect(table));
  const p = D.prepare(table, choice, withSplits);
  assert.deepEqual(p.regions.series[1], p.regions.series[0], "Somaliland gets Somalia's series");
  assert.deepEqual(p.regions.series[3], p.regions.series[2], "N. Cyprus gets Cyprus's series");
  assert.equal(p.matched, 2, "the inherited regions must not count as matched");
  assert.deepEqual(p.unmatched, []);
  assert.equal(p.points.pts.length, 2, "no extra points added for the inherited regions");
});

test("prepare: Somaliland/Northern Cyprus stay uncoloured when Somalia/Cyprus themselves have no data (M1)", () => {
  const withSplits = C.encodeLayer({ kind: "polygon", features: [
    { name: "Somalia", rank: 2, rings: [[[40, 5], [45, 5], [45, 10], [40, 5]]], props: { iso3: "SOM", iso2: "SO", names: ["Somalia"], label: [42, 7] } },
    { name: "Somaliland", rank: 1, rings: [[[44, 9], [49, 9], [49, 11], [44, 9]]], props: { iso3: "SOL", iso2: "XX", names: ["Somaliland"], label: [46, 10] } }
  ] });
  const table = V.parse("Entity,Code,Year,Population\nJapan,JPN,2020,125.8\n");
  const choice = D.defaultChoice(V.detect(table));
  const p = D.prepare(table, choice, withSplits);
  assert.equal(p.regions.series[0], null);
  assert.equal(p.regions.series[1], null);
});

test("prepare: lat/lon rows become points; geocoded names too", () => {
  const t1 = V.parse("Name,Lat,Lon,Visitors\nParis,48.85,2.35,30\n");
  const p1 = D.prepare(t1, D.defaultChoice(V.detect(t1)), countries);
  assert.deepEqual(p1.points.pts, [[2.35, 48.85, "Paris"]]);
  assert.equal(p1.matched, 1);
  const t2 = V.parse("Location,Visitors\nParis,30\nFrance,5\n");
  const p2 = D.prepare(t2, D.defaultChoice(V.detect(t2)), countries, { "Paris": [2.35, 48.85] });
  assert.deepEqual(p2.unmatched, []);
  assert.equal(p2.points.pts.length, 2);
});
