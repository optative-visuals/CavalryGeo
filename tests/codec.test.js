const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core/codec.js");

test("encodeRing: absolute first point, then deltas", () => {
  assert.deepEqual(C.encodeRing([[2.35, 48.85], [2.351, 48.851]]), [2350000, 48850000, 1000, 1000]);
});

test("decodeRing reverses encodeRing within quantisation", () => {
  const ring = [[2.3456789, 48.8566], [-0.1276, 51.5072], [139.6917, 35.6895]];
  C.decodeRing(C.encodeRing(ring)).forEach((p, i) => {
    assert.ok(Math.abs(p[0] - ring[i][0]) <= 1e-6);
    assert.ok(Math.abs(p[1] - ring[i][1]) <= 1e-6);
  });
});

test("encodeLayer sorts by rank descending, ties keep input order", () => {
  const enc = C.encodeLayer({ kind: "polygon", features: [
    { name: "small", rank: 1, rings: [[[0, 0]]] },
    { name: "big", rank: 9, rings: [[[0, 0]]] },
    { name: "small2", rank: 1, rings: [[[0, 0]]] }
  ] });
  assert.equal(enc.v, 1);
  assert.equal(enc.kind, "polygon");
  assert.deepEqual(enc.f.map((r) => r[0]), ["big", "small", "small2"]);
});

test("decodeLayer round trip keeps names and ring count", () => {
  const enc = C.encodeLayer({ kind: "line", features: [{ name: "A", rank: 1, rings: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }] });
  const dec = C.decodeLayer(enc);
  assert.equal(dec.kind, "line");
  assert.equal(dec.features[0].name, "A");
  assert.equal(dec.features[0].rings.length, 2);
});

test("subset keeps the chosen features in the given order", () => {
  const enc = C.encodeLayer({ kind: "line", features: [
    { name: "a", rank: 3, rings: [] }, { name: "b", rank: 2, rings: [] }, { name: "c", rank: 1, rings: [] }
  ] });
  assert.deepEqual(C.subset(enc, [2, 0]).f.map((r) => r[0]), ["c", "a"]);
});

test("findByName groups same-named parts, case-insensitive, skips unnamed", () => {
  const enc = C.encodeLayer({ kind: "line", features: [
    { name: "Rue de Rivoli", rank: 5, rings: [] },
    { name: "", rank: 4, rings: [] },
    { name: "Rue de Rivoli", rank: 3, rings: [] },
    { name: "Quai du Louvre", rank: 2, rings: [] }
  ] });
  assert.deepEqual(C.findByName(enc, "rivoli"), [{ name: "Rue de Rivoli", indices: [0, 2] }]);
  assert.deepEqual(C.findByName(enc, "").map((g) => g.name), ["Rue de Rivoli", "Quai du Louvre"]);
});

test("encodeLayer keeps per-feature props aligned with the sorted features", () => {
  const enc = C.encodeLayer({ kind: "polygon", features: [
    { name: "small", rank: 1, rings: [], props: { iso3: "AAA" } },
    { name: "big", rank: 9, rings: [], props: { iso3: "BBB" } }
  ] });
  assert.deepEqual(enc.p, [{ iso3: "BBB" }, { iso3: "AAA" }]);
  assert.deepEqual(C.subset(enc, [1]).p, [{ iso3: "AAA" }]);
  assert.equal(C.decodeLayer(enc).features[0].props.iso3, "BBB");
});

test("layers without props stay unchanged", () => {
  const enc = C.encodeLayer({ kind: "line", features: [{ name: "a", rank: 1, rings: [] }] });
  assert.equal("p" in enc, false);
  assert.equal("props" in C.decodeLayer(enc).features[0], false);
});
