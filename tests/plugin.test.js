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
    assert.equal(defs.UI.icon, "cavalryGeo.png");
    assert.ok(fs.existsSync(path.join(dir, defs.UI.icon)));
    assert.ok(fs.existsSync(path.join(dir, defs.UI.icon.replace(/\.png$/, "@2x.png"))));
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

// The projection constants the shaders repeat from the JavaScript. Some JS constants are not exported, so they
// are read from the source text: the value after "NAME =" (an expression such as Math.sqrt(3) / 2 is evaluated).
const GeoProjection = require("../src/core/projection.js");
function jsConst(file, name) {
  const src = fs.readFileSync(path.join(ROOT, "src", "core", file), "utf8");
  const m = new RegExp("\\b" + name + "\\s*=\\s*([^,;]+)").exec(src);
  assert.ok(m, name + " in " + file);
  return Number(new Function("return (" + m[1] + ");")());
}
function shaderConst(text, name) {
  const m = new RegExp("const\\s+float\\s+" + name + "\\s*=\\s*([-\\d.]+)\\s*;").exec(text);
  assert.ok(m, name + " in the shader");
  return Number(m[1]);
}
const SHADER_CODE = {
  reproject: codeOf(fs.readFileSync(path.join(dir, "reproject.sksl"), "utf8")),
  night: codeOf(fs.readFileSync(path.join(dir, "night.sksl"), "utf8")),
};
// The JavaScript value for each shared constant. PI and D2R are written differently in JS (Math.PI, Math.PI / 180), so
// they are compared within a tolerance instead of exactly.
const SHARED = {
  PI: { js: Math.PI, tolerance: 1e-12 },
  D2R: { js: Math.PI / 180, tolerance: 1e-12 },
  MAX_LAT: { js: GeoProjection.MAX_LAT },
  MAX_ZOOM: { js: GeoProjection.MAX_ZOOM },
  A1: { js: jsConst("projection.js", "A1") },
  A2: { js: jsConst("projection.js", "A2") },
  A3: { js: jsConst("projection.js", "A3") },
  A4: { js: jsConst("projection.js", "A4") },
  EM: { js: jsConst("night.js", "EM") },
  SIN_MAX: { js: jsConst("reproject.js", "SIN_MAX") },
};
for (const [shader, names] of [
  ["reproject", ["PI", "D2R", "MAX_LAT", "A1", "A2", "A3", "A4", "EM", "SIN_MAX"]],
  ["night", ["PI", "D2R", "MAX_LAT", "MAX_ZOOM", "A1", "A2", "A3", "A4", "EM"]],
]) {
  test(`${shader}.sksl: the shared projection constants equal the JavaScript values`, () => {
    for (const name of names) {
      const want = SHARED[name], got = shaderConst(SHADER_CODE[shader], name);
      if (want.tolerance) assert.ok(Math.abs(got - want.js) <= want.tolerance * Math.abs(want.js), `${name}: shader ${got}, JS ${want.js}`);
      else assert.equal(got, want.js, name);
    }
  });
}

test("night.sksl's subsolar-point formula uses the same coefficients as sun.js", () => {
  const sunJs = fs.readFileSync(path.join(ROOT, "src", "core", "sun.js"), "utf8");
  // The numbers of each statement in order, with their signs: "- 0.399912" is -0.399912, "2.0" and "2" are both 2.
  const numbers = (stmt) => (stmt.match(/[+-]?\s*\d+(?:\.\d+)?/g) || []).map((s) => Number(s.replace(/\s+/g, "")));
  for (const name of ["decl", "eot"]) {
    const js = new RegExp("var " + name + " = ([\\s\\S]*?);").exec(sunJs);
    const sh = new RegExp("float " + name + " = ([\\s\\S]*?);").exec(SHADER_CODE.night);
    assert.ok(js && sh, name + " in both");
    assert.ok(numbers(sh[1]).length >= 6, name + " has its coefficients");
    assert.deepEqual(numbers(sh[1]), numbers(js[1]), name + " coefficients");
  }
});

test("copyPlugin copies the plugin folder", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geo-plugin-"));
  try {
    copyPlugin(tmp);
    assert.deepEqual(fs.readdirSync(path.join(tmp, "CavalryGeo_plugin")).sort(), ["cavalryGeo.png", "cavalryGeo@2x.png", "definitions.json", "night.sksl", "reproject.sksl", "strings.json"]);
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
    for (const n of ["definitions.json", "strings.json", "reproject.sksl", "night.sksl", "cavalryGeo.png", "cavalryGeo@2x.png"]) assert.ok(names.includes("CavalryGeo_plugin/" + n), n);
    assert.ok(names.includes("INSTALL.txt") && names.includes("CavalryGeo.js"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.match(installText("9.9.9"), /CavalryGeo_plugin/);
  assert.match(installText("9.9.9"), /Day & night/);
});
