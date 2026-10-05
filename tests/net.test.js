// GeoNet retry logic for network-level failures (status -1), reproduced by a
// network that can reach a host's IPv4 address but not its IPv6 one: Cavalry's
// WebClient times out and reports status -1 with an empty body, and the next
// attempt often succeeds. Loads the real src/core/util.js and src/cavalry/net.js
// (and src/core/search.js for the search test) into a vm context with a fake
// `api` whose WebClient returns scripted statuses per construction.
const test = require("node:test");
const assert = require("node:assert/strict");
// Structural (non-strict) deepEqual: needed only where the actual value was built
// inside a vm sandbox (a different realm), since assert/strict's deepEqual is
// aliased to deepStrictEqual, which treats cross-realm Array/Object prototypes
// as unequal even when the structure and values match.
const assertStructural = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
// vm-realm objects fail assert/strict's deepEqual (deepStrictEqual) against
// test-realm literals even when structurally identical; round-tripping through
// JSON strips the foreign realm's Object/Array prototypes.
function plainObj(x) { return JSON.parse(JSON.stringify(x)); }

// A fake api.WebClient that returns the next status off a shared queue each
// time it is constructed (one construction per GeoNet.get attempt). Statuses
// past the end of the queue come back as -1 (network failure).
function makeFakeApi(statusQueue) {
  const files = Object.create(null);
  const state = { constructed: 0 };

  function WebClient(base) {
    state.constructed++;
    this._base = base;
    this._status = statusQueue.length ? statusQueue.shift() : -1;
  }
  WebClient.prototype.addHeader = function () {};
  WebClient.prototype.get = function (p) { this._path = p; };
  WebClient.prototype.status = function () { return this._status; };
  WebClient.prototype.body = function () { return this._status === 200 ? "[]" : ""; };

  return {
    WebClient: WebClient,
    filePathExists: function (p) { return Object.prototype.hasOwnProperty.call(files, p); },
    readFromFile: function (p) { return files[p]; },
    writeToFile: function (p, content) { files[p] = content; },
    makeFolder: function (p) { files[p] = files[p] === undefined ? "<dir>" : files[p]; },
    _state: state
  };
}

// Builds a fresh GeoNet in an isolated vm context so lastSearch throttling and
// the in-memory file store don't leak between tests.
function buildGeoNet(statusQueue, extraGlobals) {
  const fakeApi = makeFakeApi(statusQueue);
  const sandbox = Object.assign({
    api: fakeApi,
    GeoAttrs: { ASSETS_DIR: function () { return "C:/fake/CavalryGeo_assets"; } },
    // Minimal stand-ins for the OSM pipeline: the retry logic under test
    // lives entirely in GeoNet.get/overpassJson, not in query building or
    // feature parsing, so these just need to not throw.
    GeoOSM: { buildQuery: function () { return "Q"; }, parse: function () { return { kind: "point", features: [] }; } },
    GeoCodec: { encodeLayer: function (x) { return x; } },
    console: console
  }, extraGlobals || {});
  const context = vm.createContext(sandbox);
  vm.runInContext(read("src/core/util.js"), context, { filename: "util.js" });
  if (extraGlobals && extraGlobals.__loadSearch) {
    vm.runInContext(read("src/core/search.js"), context, { filename: "search.js" });
  }
  vm.runInContext(read("src/cavalry/net.js"), context, { filename: "net.js" });
  return { GeoNet: context.GeoNet, api: fakeApi };
}

test("search: -1 then 200 succeeds, retrying with a fresh client", () => {
  const { GeoNet, api } = buildGeoNet([-1, 200], { __loadSearch: true });
  const results = GeoNet.search("Notre-Dame, Paris");
  assert.equal(results.length, 0);
  assert.equal(api._state.constructed, 2);
});

test("osmLayer: three -1 on the first mirror exhausts retries, then mirror 2 succeeds on the first try", () => {
  const { GeoNet, api } = buildGeoNet([-1, -1, -1, 200]);
  const enc = GeoNet.osmLayer("roads", { west: 0, east: 1, south: 0, north: 1 }, "all");
  assert.ok(enc);
  assert.equal(api._state.constructed, 4);
});

test("osmLayer: a real HTTP status (429) on mirror 1 is not retried, moves straight to mirror 2", () => {
  const { GeoNet, api } = buildGeoNet([429, 200]);
  const enc = GeoNet.osmLayer("roads", { west: 0, east: 1, south: 0, north: 1 }, "all");
  assert.ok(enc);
  assert.equal(api._state.constructed, 2);
});

test("osmLayer: both mirrors exhausted (-1 throughout) throws an error mentioning the status", () => {
  const { GeoNet, api } = buildGeoNet([-1, -1, -1, -1, -1, -1]);
  assert.throws(() => GeoNet.osmLayer("roads", { west: 0, east: 1, south: 0, north: 1 }, "all"), /status -1/);
  assert.equal(api._state.constructed, 6);
});

// F1: Overpass can return HTTP 200 with a "remark" field describing a server-side
// error (timeout, out-of-memory) and empty/partial elements. That must not be
// treated as success: try the next mirror, and if all mirrors report a remark
// error, throw a friendly message instead of caching the bad response.
function makeRemarkApi(bodies) {
  const files = Object.create(null);
  const state = { constructed: 0 };
  function WebClient(base) {
    state.constructed++;
    this._body = bodies.length ? bodies.shift() : JSON.stringify({ elements: [] });
  }
  WebClient.prototype.addHeader = function () {};
  WebClient.prototype.get = function () {};
  WebClient.prototype.status = function () { return 200; };
  WebClient.prototype.body = function () { return this._body; };
  return {
    WebClient: WebClient,
    filePathExists: function (p) { return Object.prototype.hasOwnProperty.call(files, p); },
    readFromFile: function (p) { return files[p]; },
    writeToFile: function (p, content) { files[p] = content; },
    makeFolder: function (p) { files[p] = files[p] === undefined ? "<dir>" : files[p]; },
    _state: state, _files: files
  };
}

function buildGeoNetWithApi(fakeApi) {
  const sandbox = {
    api: fakeApi,
    GeoAttrs: { ASSETS_DIR: function () { return "C:/fake/CavalryGeo_assets"; } },
    GeoOSM: { buildQuery: function () { return "Q"; }, parse: function (cat, json) { return { kind: "point", features: json.elements || [] }; } },
    GeoCodec: { encodeLayer: function (x) { return x; } },
    console: console
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(read("src/core/util.js"), context, { filename: "util.js" });
  vm.runInContext(read("src/cavalry/net.js"), context, { filename: "net.js" });
  return { GeoNet: context.GeoNet, api: fakeApi };
}

test("osmLayer: a 200 response with a remark error is not treated as success; next mirror is tried", () => {
  const remarkBody = JSON.stringify({ remark: "runtime error: Query timed out.", elements: [] });
  const goodBody = JSON.stringify({ elements: [{ type: "way", id: 1 }] });
  const { GeoNet, api } = buildGeoNetWithApi(makeRemarkApi([remarkBody, goodBody]));
  const enc = GeoNet.osmLayer("roads", { west: 0, east: 1, south: 0, north: 1 }, "all");
  assert.ok(enc);
  assert.equal(api._state.constructed, 2);
});

test("osmLayer: a remark error on every mirror throws a friendly overload message and caches nothing", () => {
  const remarkBody = JSON.stringify({ remark: "runtime error: Query timed out.", elements: [] });
  const { GeoNet, api } = buildGeoNetWithApi(makeRemarkApi([remarkBody, remarkBody]));
  assert.throws(
    () => GeoNet.osmLayer("roads", { west: 0, east: 1, south: 0, north: 1 }, "all"),
    /overload|busy|smaller area|main features/i
  );
  assert.equal(Object.keys(api._files).length, 0, "nothing should be written to the cache on failure");
});

// F10: a corrupt cache file (e.g. truncated by a crash) must not break that cache
// key forever - it should be ignored and re-produced (then overwritten with valid JSON).
test("cached: corrupt JSON in an existing cache file is ignored and re-produced", () => {
  const goodBody = JSON.stringify({ elements: [{ type: "way", id: 1 }] });
  const fakeApi = makeRemarkApi([goodBody]);
  const { GeoNet, api } = buildGeoNetWithApi(fakeApi);
  const bbox = { west: 0, east: 1, south: 0, north: 1 };
  // Pre-populate the cache file for this exact key with corrupt JSON, mimicking a
  // crash mid-write. We must know the file path net.js will use, so we call once
  // first with valid data to discover it, then corrupt it and clear the state.
  GeoNet.osmLayer("buildings", bbox, "all");
  const path = Object.keys(api._files).find((p) => p.endsWith(".json"));
  assert.ok(path, "expected a cache file to have been written");
  api._files[path] = "{not valid json!!";
  fakeApi._state.constructed = 0;
  const enc = GeoNet.osmLayer("buildings", bbox, "all");
  assert.ok(enc);
  assert.equal(fakeApi._state.constructed, 1, "corrupt cache should be ignored and re-fetched, not crash");
  assert.doesNotThrow(() => JSON.parse(api._files[path]), "the cache file should be overwritten with valid JSON");
});

test("osmLayer merges several boxes into one layer without duplicates", () => {
  const way = (id, lon) => ({ type: "way", id, tags: { highway: "primary", name: "R" + id }, geometry: [{ lon, lat: 0 }, { lon: lon + 0.001, lat: 0 }] });
  const fakeApi = makeRemarkApi([
    JSON.stringify({ elements: [way(1, 179.99), way(2, 179.995)] }),
    JSON.stringify({ elements: [way(2, 179.995), way(3, -179.99)] })
  ]);
  const context = vm.createContext({ api: fakeApi, GeoAttrs: { ASSETS_DIR: () => "C:/fake/CavalryGeo_assets" }, console });
  for (const f of ["src/core/geometry.js", "src/core/codec.js", "src/core/osm.js", "src/core/util.js", "src/cavalry/net.js"]) {
    vm.runInContext(read(f), context, { filename: f });
  }
  const enc = context.GeoNet.osmLayer("roads", [
    { south: -0.01, west: 179.98, north: 0.01, east: 180 },
    { south: -0.01, west: -180, north: 0.01, east: -179.98 }
  ], "all");
  assert.equal(enc.f.length, 3);
  assert.equal(fakeApi._state.constructed, 2);
});

// Cache clean-up: deletes every cached file (deepest first), then the emptied folders,
// and reports the space freed. Cavalry's getFileSize reports kilobytes.
function makeFsApi(paths) {
  const files = Object.assign(Object.create(null), paths);
  const isDir = (p) => files[p] === "<dir>";
  return {
    filePathExists: (p) => p in files,
    readFromFile: (p) => files[p],
    writeToFile: (p, c) => { files[p] = c; },
    makeFolder: (p) => { if (!(p in files)) files[p] = "<dir>"; },
    isDirectory: isDir,
    listDirectoryRecursive: (dir) => Object.keys(files).filter((p) => p.startsWith(dir + "/")),
    getFileSize: (p) => (isDir(p) ? 0 : files[p].length / 1024),
    deleteFilePath: (p) => {
      if (isDir(p) && Object.keys(files).some((q) => q.startsWith(p + "/"))) return; // non-empty folder: refused
      delete files[p];
    },
    _files: files
  };
}

test("clearCache deletes cached files and folders and reports the space freed", () => {
  const C = "C:/fake/CavalryGeo_assets/cache";
  const fakeApi = makeFsApi({
    [C]: "<dir>", [C + "/generation.txt"]: "1",
    [C + "/g0"]: "<dir>", [C + "/g0/a.json"]: "x".repeat(2048),
    [C + "/g1"]: "<dir>", [C + "/g1/b.json"]: "y".repeat(1024)
  });
  const { GeoNet } = buildGeoNetWithApi(fakeApi);
  const result = GeoNet.clearCache();
  assert.equal(result.files, 3);
  assert.equal(result.bytes, 2048 + 1024 + 1);
  assert.equal(result.fallback, false);
  assert.deepEqual(Object.keys(fakeApi._files).filter((p) => p.startsWith(C + "/")), []);
});

test("clearCache falls back to ignoring old entries when deletion isn't possible", () => {
  const C = "C:/fake/CavalryGeo_assets/cache";
  const fakeApi = makeFsApi({ [C]: "<dir>", [C + "/generation.txt"]: "3", [C + "/g3"]: "<dir>", [C + "/g3/a.json"]: "{}" });
  fakeApi.deleteFilePath = () => {}; // deletion silently does nothing
  const { GeoNet } = buildGeoNetWithApi(fakeApi);
  const result = GeoNet.clearCache();
  assert.equal(result.fallback, true);
  assert.equal(fakeApi._files[C + "/generation.txt"], "4");
});

test("clearCache degrades to the fallback when deleteFilePath throws", () => {
  const C = "C:/fake/CavalryGeo_assets/cache";
  const fakeApi = makeFsApi({ [C]: "<dir>", [C + "/generation.txt"]: "0", [C + "/g0"]: "<dir>", [C + "/g0/a.json"]: "{}" });
  fakeApi.deleteFilePath = () => { throw new Error("locked"); };
  const { GeoNet } = buildGeoNetWithApi(fakeApi);
  const result = GeoNet.clearCache();
  assert.equal(result.fallback, true);
  assert.equal(fakeApi._files[C + "/generation.txt"], "1");
});

// F6: built imagery footage points at cache/tiles files - Clear download cache must
// leave them alone, and a separate Clear imagery tiles must remove only them.
test("clearCache leaves the tiles cache untouched; clearTiles removes only the tiles cache", () => {
  const C = "C:/fake/CavalryGeo_assets/cache";
  const fakeApi = makeFsApi({
    [C]: "<dir>",
    [C + "/g0"]: "<dir>", [C + "/g0/a.json"]: "x".repeat(1024),
    [C + "/tiles"]: "<dir>", [C + "/tiles/eox"]: "<dir>", [C + "/tiles/eox/4"]: "<dir>",
    [C + "/tiles/eox/4/1"]: "<dir>", [C + "/tiles/eox/4/1/2.jpg"]: "y".repeat(2048)
  });
  const { GeoNet } = buildGeoNetWithApi(fakeApi);

  const result = GeoNet.clearCache();
  assert.equal(result.files, 1, "only the non-tiles cache file is counted");
  assert.equal(result.bytes, 1024);
  assert.equal(result.fallback, false);
  assert.ok(fakeApi._files[C + "/tiles/eox/4/1/2.jpg"], "tile file must survive clearCache");
  assert.equal(fakeApi._files[C + "/g0/a.json"], undefined, "non-tile cache file cleared");
  assert.equal(fakeApi._files[C + "/g0"], undefined, "emptied non-tile folder removed");
  assert.ok(fakeApi._files[C + "/tiles"], "tiles folder untouched by clearCache");

  const r2 = GeoNet.clearTiles();
  assert.equal(r2.files, 1);
  assert.equal(r2.bytes, 2048);
  assert.equal(r2.fallback, false);
  assert.equal(fakeApi._files[C + "/tiles/eox/4/1/2.jpg"], undefined, "tile file removed by clearTiles");
  assert.deepEqual(Object.keys(fakeApi._files).filter((p) => p.startsWith(C + "/tiles/")), [], "every folder under tiles emptied");
});

test("clearTiles reports no work when there is no tiles cache yet", () => {
  const { GeoNet } = buildGeoNetWithApi(makeFsApi({}));
  assert.deepEqual(plainObj(GeoNet.clearTiles()), { files: 0, bytes: 0, fallback: false });
});

function makeScriptedApi(responses) {
  const calls = [];
  const written = [];
  function WebClient(base) { this.base = base; }
  WebClient.prototype.addHeader = function () {};
  WebClient.prototype.get = function (p) { calls.push(this.base + p); this.r = responses.shift() || { status: -1 }; };
  WebClient.prototype.status = function () { return this.r.status; };
  WebClient.prototype.body = function () { return this.r.body || ""; };
  WebClient.prototype.getHeaders = function () { return this.r.headers || {}; };
  WebClient.prototype.writeBodyToBinaryFile = function (p) { files[p] = "<binary>"; written.push(p); };
  const files = Object.create(null);
  return {
    WebClient, calls, filePathExists: (p) => p in files, readFromFile: (p) => files[p], writeToFile: (p, c) => { files[p] = c; }, makeFolder: () => {},
    _written: written, _files: files
  };
}
function loadNetWith(fakeApi) {
  const context = vm.createContext({ api: fakeApi, GeoAttrs: { ASSETS_DIR: () => "C:/fake/CavalryGeo_assets", WEBCLIENT_FOLLOWS_REDIRECTS: false }, console });
  for (const f of ["src/core/util.js", "src/core/sources.js", "src/core/search.js", "src/core/csv.js", "src/core/match.js", "src/core/codec.js", "src/core/dataset.js", "src/cavalry/net.js"]) vm.runInContext(read(f), context, { filename: f });
  return context.GeoNet;
}

test("fetchCsv converts a Google Sheet link and follows a 307 redirect", () => {
  const fakeApi = makeScriptedApi([
    { status: 307, headers: { Location: "https://doc-04.googleusercontent.com/export/abc?format=csv" } },
    { status: 200, body: "Entity,Code\nFrance,FRA\n" }
  ]);
  const text = loadNetWith(fakeApi).fetchCsv("https://docs.google.com/spreadsheets/d/ID1/edit#gid=5");
  assert.equal(text, "Entity,Code\nFrance,FRA\n");
  assert.deepEqual(fakeApi.calls, ["https://docs.google.com/spreadsheets/d/ID1/export?format=csv&gid=5", "https://doc-04.googleusercontent.com/export/abc?format=csv"]);
});

test("fetchCsv explains sharing when it gets a sign-in page or 401/403", () => {
  const share = /Anyone with the link/;
  assert.throws(() => loadNetWith(makeScriptedApi([{ status: 200, body: "<!DOCTYPE html><html>Sign in" }])).fetchCsv("https://docs.google.com/spreadsheets/d/X/edit"), share);
  assert.throws(() => loadNetWith(makeScriptedApi([{ status: 403 }])).fetchCsv("https://docs.google.com/spreadsheets/d/X/edit"), share);
  assert.throws(() => loadNetWith(makeScriptedApi([{ status: 404 }])).fetchCsv("https://example.com/a.csv"), /status 404/);
});

test("fetchCsv gives up after 3 redirects", () => {
  const hop = { status: 302, headers: { location: "https://example.com/next" } };
  assert.throws(() => loadNetWith(makeScriptedApi([hop, hop, hop, hop, hop])).fetchCsv("https://example.com/a.csv"), /too many redirects/i);
});

// M6: a private Google Sheet's sign-in redirect chain can be longer than 3 hops, which
// used to surface as the generic "too many redirects" error instead of the sharing tip.
test("fetchCsv rethrows the sharing message when a docs.google.com link redirects too many times", () => {
  const hop = { status: 302, headers: { location: "https://accounts.google.com/signin/next" } };
  assert.throws(
    () => loadNetWith(makeScriptedApi([hop, hop, hop, hop, hop])).fetchCsv("https://docs.google.com/spreadsheets/d/X/edit"),
    /Anyone with the link/
  );
});

test("fetchCsv still reports 'too many redirects' for a non-Google link", () => {
  const hop = { status: 302, headers: { location: "https://example.com/next" } };
  assert.throws(
    () => loadNetWith(makeScriptedApi([hop, hop, hop, hop, hop])).fetchCsv("https://example.com/a.csv"),
    (e) => /too many redirects/i.test(e.message) && !/Anyone with the link/.test(e.message)
  );
});

test("geocodePlaces looks names up once and caches them", () => {
  const found = { status: 200, body: JSON.stringify([{ display_name: "Paris, France", lat: "48.85", lon: "2.35", boundingbox: ["48", "49", "2", "3"] }]) };
  const fakeApi = makeScriptedApi([found, { status: 200, body: "[]" }]);
  const net = loadNetWith(fakeApi);
  const out = net.geocodePlaces(["Paris", "Nowhere"]);
  assertStructural.deepEqual(out, { Paris: [2.35, 48.85] });
  assertStructural.deepEqual(net.geocodePlaces(["Paris"]), { Paris: [2.35, 48.85] });
  assert.equal(fakeApi.calls.length, 2, "second call served from cache");
  const down = loadNetWith(makeScriptedApi([{ status: 503 }]));
  assert.throws(() => down.geocodePlaces(["Lyon"]), /Place lookup failed/);
});

test("downloadTile saves with the extension from Content-Type and retries network failures", () => {
  const fakeApi = makeScriptedApi([{ status: -1 }, { status: 200, headers: { "Content-Type": "image/jpeg" } }]);
  const net = loadNetWith(fakeApi);
  const base = net.tileBase("eox", 3, 4, 2);
  assert.equal(base, "C:/fake/CavalryGeo_assets/cache/tiles/eox/3/4/2");
  assert.equal(net.cachedTile(base), null);
  const r = net.downloadTile("https://tiles.maps.eox.at/wmts/g/3/2/4.jpg", base);
  assert.equal(r.status, 200);
  assert.equal(r.path, base + ".jpg");
  assert.deepEqual(fakeApi._written, [base + ".jpg"]);
  assert.equal(net.cachedTile(base), base + ".jpg");
  assert.equal(fakeApi.calls.length, 2);
});

test("downloadTile reports missing, rejected and unsupported tiles without saving", () => {
  const net = loadNetWith(makeScriptedApi([{ status: 404 }, { status: 403 }, { status: 200, headers: { "content-type": "image/webp" } }, { status: 200 }]));
  assert.deepEqual(plainObj(net.downloadTile("https://a.example/1/2/3.png", "C:/t/a")), { status: 404 });
  assert.deepEqual(plainObj(net.downloadTile("https://a.example/1/2/3.png", "C:/t/b")), { status: 403 });
  assert.deepEqual(plainObj(net.downloadTile("https://a.example/1/2/3", "C:/t/c")), { status: 200, unsupported: "image/webp" });
  assert.equal(net.downloadTile("https://a.example/1/2/3.png", "C:/t/d").path, "C:/t/d.png", "no Content-Type: extension from the URL");
});

// F10: a 404/204 tile (no imagery at that level/place) must not be re-downloaded on
// every plan - mark it with a sidecar file and treat it as neither missing nor cached.
test("markEmptyTile/isEmptyTile round-trip", () => {
  const fakeApi = makeScriptedApi([]);
  const net = loadNetWith(fakeApi);
  const base = net.tileBase("eox", 3, 4, 2);
  assert.equal(net.isEmptyTile(base), false);
  net.markEmptyTile(base);
  assert.equal(net.isEmptyTile(base), true);
  assert.equal(net.cachedTile(base), null, "an empty marker is not a cached tile file");
});

test("settings round-trip and tolerate a broken file", () => {
  const fakeApi = makeScriptedApi([]);
  const net = loadNetWith(fakeApi);
  assert.deepEqual(plainObj(net.loadSettings()), {});
  net.saveSettings({ source: "maptiler", maptilerKey: "K" });
  assert.deepEqual(plainObj(net.loadSettings()), { source: "maptiler", maptilerKey: "K" });
  fakeApi.writeToFile("C:/fake/CavalryGeo_assets/settings.json", "{broken");
  assert.deepEqual(plainObj(net.loadSettings()), {});
});

test("reverse: a failed or empty lookup gives null and never throws", () => {
  assert.equal(buildGeoNet([500], { __loadSearch: true }).GeoNet.reverse(48.85, 2.35, 12), null);
  assert.equal(buildGeoNet([200], { __loadSearch: true }).GeoNet.reverse(48.85, 2.35, 12), null, "body [] has no name");
  assert.equal(buildGeoNet([-1, -1, -1, -1, -1], { __loadSearch: true }).GeoNet.reverse(48.85, 2.35, 12), null, "network failures");
});

test("reverse: one network failure is one attempt, then no network for the next minute", () => {
  const { GeoNet, api } = buildGeoNet([-1, 200, 200], { __loadSearch: true });
  assert.equal(GeoNet.reverse(48.85, 2.35, 12), null);
  assert.equal(api._state.constructed, 1, "no retries");
  assert.equal(GeoNet.reverse(48.86, 2.36, 12), null);
  assert.equal(api._state.constructed, 1, "backed off: the network isn't contacted");
});

test("reverse: an HTTP error does not back off", () => {
  const { GeoNet, api } = buildGeoNet([500, 500], { __loadSearch: true });
  assert.equal(GeoNet.reverse(48.85, 2.35, 12), null);
  assert.equal(GeoNet.reverse(48.86, 2.36, 12), null);
  assert.equal(api._state.constructed, 2, "the second lookup contacted the network");
});
