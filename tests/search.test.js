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

test("reversePath asks Nominatim's reverse lookup at a clamped zoom", () => {
  assert.equal(S.reversePath(48.8566, 2.3522, 12), "/reverse?format=jsonv2&accept-language=en&lat=48.856600&lon=2.352200&zoom=12");
  assert.match(S.reversePath(0, 0, 30), /zoom=18$/);
  assert.match(S.reversePath(0, 0, 0.4), /zoom=3$/);
});

test("reverseName prefers the place's own name, then the first part of the address", () => {
  assert.equal(S.reverseName({ name: "Gare du Nord", display_name: "Gare du Nord, Paris, France" }), "Gare du Nord");
  assert.equal(S.reverseName({ name: "", display_name: "12, Rue X, Paris" }), "12");
  assert.equal(S.reverseName({ error: "Unable to geocode" }), null);
  assert.equal(S.reverseName(null), null);
});
