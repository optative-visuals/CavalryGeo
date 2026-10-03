const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../src/core/osm.js");

const bbox = { south: 48.85, west: 2.34, north: 48.856, east: 2.352 };
const g = (pts) => pts.map(([lon, lat]) => ({ lon, lat }));
const square = (x, y, s) => g([[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]);

test("buildQuery: bbox order is south,west,north,east and output uses geometry", () => {
  const q = O.buildQuery("buildings", bbox, "all");
  assert.ok(q.startsWith("[out:json]"));
  assert.ok(q.includes('way["building"](48.850000,2.340000,48.856000,2.352000);'));
  assert.ok(q.endsWith("out geom;"));
});

test("buildQuery: main mode narrows roads and railways", () => {
  assert.ok(O.buildQuery("roads", bbox, "main").includes("motorway|trunk|primary|secondary|tertiary"));
  assert.ok(!O.buildQuery("roads", bbox, "all").includes("motorway"));
  assert.ok(O.buildQuery("railways", bbox, "main").includes('way["railway"="rail"]'));
});

test("buildQuery: unknown category throws", () => {
  assert.throws(() => O.buildQuery("volcanoes", bbox, "all"), /Unknown street category/);
});

test("parse buildings: closed ways kept, open ways dropped, relations joined, ranked by area", () => {
  const json = { elements: [
    { type: "way", id: 1, tags: { building: "yes", name: "Small" }, geometry: square(0, 0, 0.001) },
    { type: "way", id: 2, tags: { building: "yes" }, geometry: g([[0, 0], [1, 0], [1, 1]]) },
    { type: "relation", id: 3, tags: { building: "yes", name: "Big" }, members: [
      { type: "way", role: "outer", geometry: g([[0, 0], [0.01, 0], [0.01, 0.01]]) },
      { type: "way", role: "outer", geometry: g([[0.01, 0.01], [0, 0.01], [0, 0]]) }
    ] },
    { type: "way", id: 1, tags: { building: "yes", name: "Small" }, geometry: square(0, 0, 0.001) }
  ] };
  const layer = O.parse("buildings", json, "all");
  assert.equal(layer.kind, "polygon");
  assert.equal(layer.features.length, 2);
  const big = layer.features.find((f) => f.name === "Big");
  const small = layer.features.find((f) => f.name === "Small");
  assert.ok(big.rank > small.rank);
  assert.equal(big.rings.length, 1);
});

test("parse buildings main mode keeps the biggest 30%", () => {
  const elements = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ type: "way", id: i, tags: { building: "yes", name: "b" + i }, geometry: square(0, 0, i * 0.0001) }));
  const layer = O.parse("buildings", { elements }, "main");
  assert.deepEqual(layer.features.map((f) => f.name), ["b10", "b9", "b8"]);
});

test("parse buildings: ring orientation is normalised regardless of source winding (outer CCW, inner CW)", () => {
  const G = require("../src/core/geometry.js");
  // A way (single outer ring) given clockwise must come out counter-clockwise.
  const cwSquare = square(0, 0, 0.001).slice().reverse();
  const wayJson = { elements: [{ type: "way", id: 1, tags: { building: "yes", name: "Way" }, geometry: cwSquare }] };
  const wayLayer = O.parse("buildings", wayJson, "all");
  const wayRing = wayLayer.features[0].rings[0];
  assert.ok(G.signedArea(wayRing) > 0, "way ring should be CCW");

  // A relation: outer given CW must become CCW, inner given CCW must become CW.
  const outerCw = g([[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]); // CW in lon/lat
  const innerCcw = g([[0.002, 0.002], [0.006, 0.002], [0.006, 0.006], [0.002, 0.006], [0.002, 0.002]]); // CCW
  const relJson = { elements: [{ type: "relation", id: 2, tags: { building: "yes", name: "Rel" }, members: [
    { type: "way", role: "outer", geometry: outerCw },
    { type: "way", role: "inner", geometry: innerCcw }
  ] }] };
  const relLayer = O.parse("buildings", relJson, "all");
  const rings = relLayer.features[0].rings;
  assert.equal(rings.length, 2);
  assert.ok(G.signedArea(rings[0]) > 0, "outer ring should end up CCW");
  assert.ok(G.signedArea(rings[1]) < 0, "inner ring (hole) should end up CW");
});

test("parse roads: lines ranked by class, links just below their class", () => {
  const line = g([[0, 0], [0.001, 0]]);
  const json = { elements: [
    { type: "way", id: 1, tags: { highway: "footway" }, geometry: line },
    { type: "way", id: 2, tags: { highway: "primary", name: "Main St" }, geometry: line },
    { type: "way", id: 3, tags: { highway: "primary_link" }, geometry: line },
    { type: "way", id: 4, tags: { highway: "residential" }, geometry: line }
  ] };
  const layer = O.parse("roads", json, "all");
  assert.equal(layer.kind, "line");
  const rank = (id) => layer.features[[1, 2, 3, 4].indexOf(id)].rank;
  assert.ok(rank(2) > rank(3) && rank(3) > rank(4) && rank(4) > rank(1));
});
