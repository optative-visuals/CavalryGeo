const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/core/markers.js");

["plane", "arrow"].forEach((kind) => {
  test(kind + " outline points along +x, centred and about 24 px long", () => {
    const pts = M.outline(kind);
    assert.ok(pts.length >= 3);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const nose = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
    assert.equal(nose[1], 0, "the nose is on the x axis");
    assert.ok(Math.max(...xs) - Math.min(...xs) >= 20 && Math.max(...xs) - Math.min(...xs) <= 26);
    assert.ok(Math.abs(Math.max(...ys) + Math.min(...ys)) < 1e-9, "symmetric about the x axis");
    assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2) <= 1, "centred on x");
  });
});

test("unknown kinds are refused", () => {
  assert.throws(() => M.outline("dot"), /Unknown marker/);
});
