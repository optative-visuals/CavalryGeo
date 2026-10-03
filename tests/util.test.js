const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/core/util.js");

test("hash is deterministic, 16 hex chars, and differs for different input", () => {
  assert.match(U.hash("abc"), /^[0-9a-f]{16}$/);
  assert.equal(U.hash("abc"), U.hash("abc"));
  assert.notEqual(U.hash("abc"), U.hash("abd"));
});

test("checkArea: thresholds per mode", () => {
  const tiny = { west: 2.34, east: 2.352, south: 48.85, north: 48.856 }; // ~0.6 km2
  const city = { west: 2.2, east: 2.5, south: 48.8, north: 48.9 };       // ~245 km2
  assert.equal(U.checkArea(tiny, "all").needsConfirm, false);
  assert.equal(U.checkArea(city, "all").needsConfirm, true);
  assert.equal(U.checkArea(city, "main").needsConfirm, false);
  assert.ok(U.checkArea(city, "all").areaKm2 > 200);
  assert.equal(U.checkArea(city, "all").refuse, false);
  assert.equal(U.checkArea(city, "main").refuse, false);
});

test("checkArea: refuses absurdly large areas regardless of mode", () => {
  assert.equal(U.LIMITS.AREA_REFUSE_KM2, 10000);
  const world = { west: -180, east: 180, south: -60, north: 75 }; // world view, way over 10000 km2
  const r = U.checkArea(world, "all");
  assert.ok(r.areaKm2 > U.LIMITS.AREA_REFUSE_KM2);
  assert.equal(r.refuse, true);
  assert.equal(U.checkArea(world, "main").refuse, true);
});

test("formatBytes", () => {
  assert.equal(U.formatBytes(12345), "12 KB");
  assert.equal(U.formatBytes(5400000), "5.4 MB");
});

test("formatBytes rolls over to MB instead of showing 1000 KB", () => {
  assert.equal(U.formatBytes(999999), "1.0 MB");
  assert.equal(U.formatBytes(999499), "999 KB");
});

test("checkArea adds up the areas of several boxes", () => {
  const box = { west: 2.34, east: 2.352, south: 48.85, north: 48.856 };
  assert.ok(Math.abs(U.checkArea([box, box], "all").areaKm2 - 2 * U.checkArea(box, "all").areaKm2) < 1e-9);
});
