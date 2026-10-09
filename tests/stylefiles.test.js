const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/core/styles.js");
const F = require("../src/core/stylefiles.js");

const s = G.normalise([{ name: "Ocean", colors: {}, widths: {} }])[0];

test("file names: punctuation replaced, trailing dots and spaces dropped, empty falls back", () => {
  assert.equal(F.fileName("Night Blue"), "Night Blue.json");
  assert.equal(F.fileName("Night/Day: v2?"), "Night-Day- v2-.json");
  assert.equal(F.fileName("  "), "Style.json");
  assert.equal(F.fileName("a."), "a.json");
});

test("style text round trips through fromText", () => {
  assert.deepEqual(F.fromText(F.toText(s)), s);
  assert.equal(JSON.parse(F.toText(s)).cavalryGeoStyle, 1);
});

test("fromText rejects bad JSON, missing marker and built-in names", () => {
  assert.equal(F.fromText("{"), null);
  assert.equal(F.fromText('{"name":"x"}'), null);
  assert.equal(F.fromText('{"cavalryGeoStyle":1,"name":"Dark"}'), null);
});

test("readAll keeps the first of each name and skips the rest", () => {
  const out = F.readAll([
    { path: "A/a.json", text: F.toText(s) },
    { path: "A/b.json", text: F.toText(s) },
    { path: "A/n.json", text: "{}" }
  ]);
  assert.equal(out.styles.length, 1);
  assert.equal(out.styles[0].name, "Ocean");
  assert.deepEqual(out.skipped, ["A/b.json", "A/n.json"]);
});

test("movePlan reads styles from settings, de-duplicated", () => {
  assert.deepEqual(F.movePlan({}), []);
  assert.equal(F.movePlan({ mapStyles: [s, s] }).length, 1);
});

test("RESET_KEYS lists the six reset keys in order", () => {
  assert.deepEqual(F.RESET_KEYS, ["flyEasing", "flyArc", "driftMove", "routeShape", "source", "mapStyle"]);
});

test("constants", () => {
  assert.equal(F.MARKER, "cavalryGeoStyle");
  assert.equal(F.FOLDER, "Map styles");
});

test("file names: Windows device names get a dash so they are never device files", () => {
  assert.equal(F.fileName("CON"), "CON-.json");
  assert.equal(F.fileName("lpt1 "), "lpt1-.json");
  assert.equal(F.fileName("com9."), "com9-.json");
  assert.equal(F.fileName("Console"), "Console.json");
});

test("file names: tabs and backslashes become dashes", () => {
  assert.equal(F.fileName("a\\b\tc"), "a-b-c.json");
});

test("readAll reports the path of each kept style by lowercased name", () => {
  const out = F.readAll([
    { path: "A/a.json", text: F.toText(s) },
    { path: "A/b.json", text: F.toText(s) },
    { path: "A/n.json", text: "{}" }
  ]);
  assert.deepEqual(out.paths, { ocean: "A/a.json" });
});

test("readAll skips a third file whose name differs only in case", () => {
  const upper = F.toText(G.normalise([{ name: "OCEAN", colors: {}, widths: {} }])[0]);
  const out = F.readAll([
    { path: "A/Ocean.json", text: F.toText(s) },
    { path: "A/OCEAN.json", text: upper }
  ]);
  assert.equal(out.styles.length, 1);
  assert.deepEqual(out.skipped, ["A/OCEAN.json"]);
  assert.deepEqual(out.paths, { ocean: "A/Ocean.json" });
});
