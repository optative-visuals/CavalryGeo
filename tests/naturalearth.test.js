const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../src/core/naturalearth.js");

const box = (x, y, s) => [[x, y, 0], [x + s, y, 0], [x + s, y + s, 0], [x, y + s, 0], [x, y, 0]];

test("sourcePath", () => {
  assert.equal(N.sourcePath("countries", "50m"), "/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson");
  assert.equal(N.sourcePath("cities", "10m"), "/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson");
});

test("countries: polygons and multipolygons, ranked by area, 3D coords trimmed", () => {
  const gj = { type: "FeatureCollection", features: [
    { properties: { NAME: "Small" }, geometry: { type: "Polygon", coordinates: [box(0, 0, 1)] } },
    { properties: { NAME: "Big" }, geometry: { type: "MultiPolygon", coordinates: [[box(0, 0, 5)], [box(10, 10, 1)]] } }
  ] };
  const layer = N.fromGeoJSON("countries", gj);
  assert.equal(layer.kind, "polygon");
  const big = layer.features.find((f) => f.name === "Big");
  assert.equal(big.rings.length, 2);
  assert.deepEqual(big.rings[0][0], [0, 0]);
  assert.ok(big.rank > layer.features.find((f) => f.name === "Small").rank);
});

test("countries: polygon ring orientation is normalised (outer CCW, holes CW) regardless of source winding", () => {
  const G = require("../src/core/geometry.js");
  const outerCcw = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]]; // CCW
  const holeCcw = [[0.2, 0.2, 0], [0.4, 0.2, 0], [0.4, 0.4, 0], [0.2, 0.4, 0], [0.2, 0.2, 0]]; // also CCW (wrong for a hole)
  const gj = { features: [
    { properties: { NAME: "WithHole" }, geometry: { type: "Polygon", coordinates: [outerCcw, holeCcw] } }
  ] };
  const layer = N.fromGeoJSON("countries", gj);
  const rings = layer.features[0].rings;
  assert.equal(rings.length, 2);
  assert.ok(G.signedArea(rings[0]) > 0, "outer ring should be CCW");
  assert.ok(G.signedArea(rings[1]) < 0, "hole ring should be CW");
});

test("cities: points ranked by population, lowercase property names work", () => {
  const gj = { features: [
    { properties: { name: "Village", pop_max: 100 }, geometry: { type: "Point", coordinates: [1, 2] } },
    { properties: { NAME: "Metropolis", POP_MAX: 9000000 }, geometry: { type: "Point", coordinates: [3, 4] } }
  ] };
  const layer = N.fromGeoJSON("cities", gj);
  assert.equal(layer.kind, "point");
  assert.deepEqual(layer.features[0].rings, [[[1, 2]]]);
  assert.ok(layer.features[1].rank > layer.features[0].rank);
});

test("rivers: lower scalerank is more important", () => {
  const line = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
  const layer = N.fromGeoJSON("rivers", { features: [
    { properties: { name: "Minor", scalerank: 9 }, geometry: line },
    { properties: { name: "Major", scalerank: 1 }, geometry: line }
  ] });
  assert.equal(layer.kind, "line");
  assert.ok(layer.features[1].rank > layer.features[0].rank);
});

test("features without geometry are skipped; unknown category throws", () => {
  assert.equal(N.fromGeoJSON("lakes", { features: [{ properties: {}, geometry: null }] }).features.length, 0);
  assert.throws(() => N.fromGeoJSON("volcanoes", { features: [] }), /Unknown world category/);
});

test("countries carry codes (with -99 fallbacks), names and a label point", () => {
  const poly = { type: "Polygon", coordinates: [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]] };
  const gj = { features: [
    { properties: { NAME: "France", NAME_LONG: "France", ADMIN: "France", ISO_A3: "-99", ISO_A3_EH: "FRA", ADM0_A3: "FRA", ISO_A2: "-99", ISO_A2_EH: "FR", LABEL_X: 2.55, LABEL_Y: 46.7 }, geometry: poly },
    { properties: { NAME: "Kosovo", ISO_A3: "-99", ISO_A3_EH: "-99", ADM0_A3: "KOS", ISO_A2: "-99", ISO_A2_EH: "XK" }, geometry: poly }
  ] };
  const layer = N.fromGeoJSON("countries", gj);
  assert.deepEqual(layer.features[0].props, { iso3: "FRA", iso2: "FR", names: ["France"], label: [2.55, 46.7] });
  assert.deepEqual(layer.features[1].props, { iso3: "KOS", iso2: "XK", names: ["Kosovo"], label: null });
});

test("non-country layers have no props", () => {
  const layer = N.fromGeoJSON("lakes", { features: [{ properties: { name: "L" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] });
  assert.equal(layer.features[0].props, undefined);
});
