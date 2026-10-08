const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ROOT, copyPlugin } = require("../tools/buildlib.js");
const { packageFiles, installText } = require("../tools/package.js");

const GeoNight = require("../src/core/night.js");
const dir = path.join(ROOT, "plugin", "CavalryGeo_plugin");
const defsAll = JSON.parse(fs.readFileSync(path.join(dir, "definitions.json"), "utf8"));
const strsAll = JSON.parse(fs.readFileSync(path.join(dir, "strings.json"), "utf8"));
// The shader without its comments, so a commented-out uniform isn't counted.
const codeOf = (sksl) => sksl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
const CAMERA = { camLat: "double", camLon: "double", camZoom: "double", camRotation: "double", camProjection: "double" };
const FILTERS = [
  {
    type: "reproject", niceName: "Cavalry Geo Reproject", sksl: "reproject.sksl",
    own: { ...CAMERA, viewScale: "double", viewOffset: "double2" },
  },
  {
    type: "night", niceName: "Cavalry Geo Night", sksl: "night.sksl",
    own: { ...CAMERA, dayOfYear: "double", utcTime: "double", nightOpacity: "double", twilight: "double", lights: "double" },
    defaults: { dayOfYear: 1, utcTime: 12, nightOpacity: 55, twilight: 1, lights: 0 },
    ranges: { camZoom: [0, 22], camProjection: [0, 2], twilight: [0, 1], nightOpacity: [0, 100], lights: [0, 100], dayOfYear: [1, 365], utcTime: [0, 24] },
  },
];

for (const f of FILTERS) {
  const defs = defsAll.find((o) => o.type === f.type);
  const strs = strsAll.find((o) => o.value && o.value.layerType === f.type);
  const sksl = fs.readFileSync(path.join(dir, f.sksl), "utf8");
  const OWN = f.own;

  test(`${f.type}: definitions.json describes the filter`, () => {
    assert.ok(defs, "definition object");
    assert.equal(defs.author, "cavalryGeo");
    assert.equal(defs.superType, "thirdPartyFilter");
    assert.equal(defs.skslFile, f.sksl);
    assert.ok(fs.existsSync(path.join(dir, defs.skslFile)));
    for (const k of Object.keys(OWN)) assert.equal(defs.attributes[k].type, OWN[k], k);
    assert.equal(defs.attributes.allowViewportClipping.default, false);
    assert.equal(defs.attributes.samplingQuality.default, 1);
    assert.deepEqual(defs.triggers.out, Object.keys(OWN));
    assert.deepEqual(defs.UI.attributeOrder, Object.keys(OWN));
  });

  test(`${f.type}: defaults and ranges`, () => {
    for (const [k, v] of Object.entries(f.defaults || {})) assert.equal(defs.attributes[k].default, v, k + " default");
    for (const [k, [min, max]] of Object.entries(f.ranges || {})) {
      assert.equal(defs.attributes[k].min, min, k + " min");
      assert.equal(defs.attributes[k].max, max, k + " max");
    }
  });

  test(`${f.type}: the shader uniforms and the own attributes match one to one`, () => {
    const found = {};
    for (const m of codeOf(sksl).matchAll(/uniform\s+(float2|float)\s+(\w+)\s*;/g)) found[m[2]] = m[1] === "float" ? "double" : "double2";
    assert.deepEqual(found, OWN);
  });

  test(`${f.type}: strings.json names the layer and every own attribute`, () => {
    assert.ok(strs, "strings object");
    assert.equal(strs.type, "layerStrings");
    assert.equal(strs.value.author, "cavalryGeo");
    assert.equal(strs.value.layerType, f.type);
    assert.equal(strs.value.niceName, f.niceName);
    for (const k of Object.keys(OWN)) assert.ok(strs.value.attributes[k] && strs.value.attributes[k][0], k);
  });
}

test("night.sksl's constants match the GeoNight mirror", () => {
  const sksl = codeOf(fs.readFileSync(path.join(dir, "night.sksl"), "utf8"));
  const constOf = (name) => Number(sksl.match(new RegExp("const\\s+float\\s+" + name + "\\s*=\\s*([\\d.]+)\\s*;"))[1]);
  assert.equal(constOf("TAU"), GeoNight.TAU);
  assert.equal(constOf("BAND"), GeoNight.BAND);
});

test("copyPlugin copies the plugin folder", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geo-plugin-"));
  try {
    copyPlugin(tmp);
    assert.deepEqual(fs.readdirSync(path.join(tmp, "CavalryGeo_plugin")).sort(), ["definitions.json", "night.sksl", "reproject.sksl", "strings.json"]);
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
    for (const n of ["definitions.json", "strings.json", "reproject.sksl", "night.sksl"]) assert.ok(names.includes("CavalryGeo_plugin/" + n), n);
    assert.ok(names.includes("INSTALL.txt") && names.includes("CavalryGeo.js"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.match(installText("9.9.9"), /CavalryGeo_plugin/);
  assert.match(installText("9.9.9"), /Day & night/);
});
