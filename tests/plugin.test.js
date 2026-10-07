const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ROOT, copyPlugin } = require("../tools/buildlib.js");
const { packageFiles, installText } = require("../tools/package.js");

const dir = path.join(ROOT, "plugin", "CavalryGeo_plugin");
const defs = JSON.parse(fs.readFileSync(path.join(dir, "definitions.json"), "utf8"))[0];
const strs = JSON.parse(fs.readFileSync(path.join(dir, "strings.json"), "utf8"))[0];
const sksl = fs.readFileSync(path.join(dir, "reproject.sksl"), "utf8");
const OWN = { camLat: "double", camLon: "double", camZoom: "double", camRotation: "double", camProjection: "double", viewScale: "double", viewOffset: "double2" };

test("definitions.json describes the reproject filter", () => {
  assert.equal(defs.author, "cavalryGeo");
  assert.equal(defs.type, "reproject");
  assert.equal(defs.superType, "thirdPartyFilter");
  assert.ok(fs.existsSync(path.join(dir, defs.skslFile)));
  for (const k of Object.keys(OWN)) assert.equal(defs.attributes[k].type, OWN[k], k);
  assert.equal(defs.attributes.allowViewportClipping.default, false);
  assert.equal(defs.attributes.samplingQuality.default, 1);
  assert.deepEqual(defs.triggers.out, Object.keys(OWN));
});

test("the shader uniforms and the own attributes match one to one", () => {
  const found = {};
  for (const m of sksl.matchAll(/uniform\s+(float2|float)\s+(\w+)\s*;/g)) found[m[2]] = m[1] === "float" ? "double" : "double2";
  assert.deepEqual(found, OWN);
});

test("strings.json names the layer and every own attribute", () => {
  assert.equal(strs.type, "layerStrings");
  assert.equal(strs.value.author, "cavalryGeo");
  assert.equal(strs.value.layerType, "reproject");
  for (const k of Object.keys(OWN)) assert.ok(strs.value.attributes[k] && strs.value.attributes[k][0], k);
});

test("copyPlugin copies the three files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geo-plugin-"));
  try {
    copyPlugin(tmp);
    assert.deepEqual(fs.readdirSync(path.join(tmp, "CavalryGeo_plugin")).sort(), ["definitions.json", "reproject.sksl", "strings.json"]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("the release zip carries the plugin and the install text mentions it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geo-dist-"));
  try {
    fs.writeFileSync(path.join(tmp, "CavalryGeo.js"), "x");
    fs.mkdirSync(path.join(tmp, "CavalryGeo_assets"));
    fs.writeFileSync(path.join(tmp, "CavalryGeo_assets", "a.txt"), "a");
    copyPlugin(tmp);
    const names = packageFiles(tmp, "9.9.9").map((f) => f.name);
    for (const n of ["definitions.json", "strings.json", "reproject.sksl"]) assert.ok(names.includes("CavalryGeo_plugin/" + n), n);
    assert.ok(names.includes("INSTALL.txt") && names.includes("CavalryGeo.js"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.match(installText("9.9.9"), /CavalryGeo_plugin/);
});
