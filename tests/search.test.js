const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core/search.js");

test("path encodes the query and asks for 5 JSON results", () => {
  assert.equal(S.path("Notre-Dame, Paris"), "/search?format=jsonv2&limit=5&accept-language=en&q=Notre-Dame%2C%20Paris");
});

test("parse maps Nominatim's [minLat, maxLat, minLon, maxLon] bounding box", () => {
  const res = S.parse([{ display_name: "Paris, France", lat: "48.85", lon: "2.35", boundingbox: ["48.81", "48.90", "2.22", "2.47"] }]);
  assert.deepEqual(res, [{ name: "Paris, France", lat: 48.85, lon: 2.35, bbox: { south: 48.81, north: 48.9, west: 2.22, east: 2.47 } }]);
});
