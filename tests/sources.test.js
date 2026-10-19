const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core/sources.js");

const src = (id) => S.byId(id);

test("list has the five sources in dropdown order", () => {
  assert.deepEqual(S.list().map((s) => s.id), ["eox", "nasa", "maptiler", "mapbox", "custom"]);
  assert.throws(() => S.byId("nope"), /Unknown imagery source/);
});

test("no-key source URLs (WMTS uses y before x)", () => {
  assert.equal(S.tileUrl(src("eox"), {}, 3, 4, 2), "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/3/2/4.jpg");
  assert.equal(S.tileUrl(src("nasa"), {}, 3, 4, 2), "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/3/2/4.jpeg");
});

test("MapTiler and Mapbox URLs use @2x and the key", () => {
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "satellite" }, 3, 4, 2), "https://api.maptiler.com/maps/satellite/256/3/4/2@2x.jpg?key=K1");
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "streets-v2" }, 3, 4, 2), "https://api.maptiler.com/maps/streets-v2/256/3/4/2@2x.jpg?key=K1");
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1" }, 0, 0, 0), "https://api.maptiler.com/maps/satellite/256/0/0/0@2x.jpg?key=K1");
  assert.equal(S.tileUrl(src("mapbox"), { key: "T1", style: "mapbox/satellite-v9" }, 3, 4, 2), "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/3/4/2@2x?access_token=T1");
  assert.equal(src("maptiler").imagePx, 512);
  assert.equal(src("eox").imagePx, 256);
});

test("missing keys, bad styles and bad links explain themselves", () => {
  assert.throws(() => S.tileUrl(src("maptiler"), {}, 0, 0, 0), /^Error: Needs a MapTiler key: set it in \u2699 Settings\.$/);
  assert.throws(() => S.tileUrl(src("mapbox"), {}, 0, 0, 0), /^Error: Needs a Mapbox token: set it in \u2699 Settings\.$/);
  assert.throws(() => S.tileUrl(src("mapbox"), { key: "T", style: "satellite" }, 0, 0, 0), /mapbox\/satellite-v9/);
  assert.throws(() => S.tileUrl(src("custom"), {}, 0, 0, 0), /^Error: Needs a custom tile link: set it in \u2699 Settings\.$/);
  assert.throws(() => S.tileUrl(src("custom"), { template: "https://x/{z}/{x}.png" }, 0, 0, 0), /^Error: The custom tile link must start with https:\/\/ and contain \{z\}, \{x\} and \{y\}: fix it in \u2699 Settings\.$/);
  assert.equal(S.tileUrl(src("custom"), { template: " https://t.example/{z}/{x}/{y}.png " }, 5, 6, 7), "https://t.example/5/6/7.png");
});

test("missingSetting: a keyed or linked source names what to set in Settings, otherwise null", () => {
  const SET = (what) => "Needs " + what + ": set it in \u2699 Settings.";
  assert.equal(S.missingSetting(src("maptiler"), {}), SET("a MapTiler key"));
  assert.equal(S.missingSetting(src("maptiler")), SET("a MapTiler key"), "no opts at all");
  assert.equal(S.missingSetting(src("maptiler"), { key: "K1" }), null);
  assert.equal(S.missingSetting(src("mapbox"), {}), SET("a Mapbox token"));
  assert.equal(S.missingSetting(src("mapbox"), { key: "T" }), null);
  assert.equal(S.missingSetting(src("custom"), {}), SET("a custom tile link"));
  assert.equal(S.missingSetting(src("custom"), { template: "" }), SET("a custom tile link"), "empty link is missing");
  assert.equal(S.missingSetting(src("custom"), { template: "https://x/{z}/{x}.png" }), "The custom tile link must start with https:// and contain {z}, {x} and {y}: fix it in \u2699 Settings.", "malformed link");
  assert.equal(S.missingSetting(src("custom"), { template: " https://t.example/{z}/{x}/{y}.png " }), null);
  assert.equal(S.missingSetting(src("eox"), {}), null);
  assert.equal(S.missingSetting(src("nasa"), {}), null);
});

test("cache keys, labels and meta never contain keys or links", () => {
  assert.equal(S.cacheKey(src("eox"), {}), "eox");
  assert.equal(S.cacheKey(src("maptiler"), { key: "K", style: "satellite" }), "maptiler-satellite");
  assert.equal(S.cacheKey(src("mapbox"), { key: "T", style: "mapbox/satellite-v9" }), "mapbox-mapbox_satellite-v9");
  const c1 = S.cacheKey(src("custom"), { template: "https://a/{z}/{x}/{y}.png" }), c2 = S.cacheKey(src("custom"), { template: "https://b/{z}/{x}/{y}.png" });
  assert.match(c1, /^custom-[0-9a-f]+$/);
  assert.notEqual(c1, c2);
  const m = JSON.stringify(S.meta(src("mapbox"), { key: "SECRET", style: "mapbox/dark-v11", template: "https://k/{z}" }));
  assert.equal(m.includes("SECRET"), false);
  assert.equal(m.includes("https"), false);
  assert.deepEqual(S.meta(src("mapbox"), { style: "mapbox/dark-v11" }), { source: "mapbox", style: "mapbox/dark-v11" });
  assert.equal(S.label(src("maptiler"), { style: "satellite" }), "MapTiler satellite");
  assert.equal(S.label(src("eox"), {}), "EOX Sentinel-2");
  assert.equal(S.attribution(src("custom"), { customAttribution: "© Me" }), "© Me");
  assert.match(S.attribution(src("eox"), {}), /EOX IT Services GmbH/);
  assert.equal(S.providerName(src("mapbox")), "Mapbox");
});

test("image types from Content-Type or URL", () => {
  assert.equal(S.extForContentType("image/jpeg"), "jpg");
  assert.equal(S.extForContentType("image/png; charset=binary"), "png");
  assert.equal(S.extForContentType("image/webp"), "webp");
  assert.equal(S.extForContentType("image/webp; charset=binary"), "webp");
  assert.equal(S.extForUrl("https://api.maptiler.com/tiles/hillshade/1/2/3.webp?key=K"), "webp");
  assert.equal(S.extForUrl("https://a/1/2/3.jpeg?x=1"), "jpg");
  assert.equal(S.extForUrl("https://a/1/2/3.png"), "png");
  assert.equal(S.extForUrl("https://a/1/2/3@2x?k=1"), null);
  assert.deepEqual(S.splitUrl("https://api.maptiler.com/maps/x/1.png?key=K"), { base: "https://api.maptiler.com", path: "/maps/x/1.png?key=K" });
});

test("MapTiler picker: standard maps by name, in order, each with its id", () => {
  const e = S.suggestions(src("maptiler")).slice(0, 15);
  assert.deepEqual(e.map((x) => x.name), ["Satellite", "Satellite Hybrid", "Streets", "Outdoor", "Topo", "Base", "Dataviz", "Landscape", "Winter",
    "Ocean", "Backdrop", "Aquarelle", "Toner", "OpenStreetMap", "JP GSI Standard"]);
  assert.deepEqual(e.map((x) => x.id), ["satellite", "hybrid", "streets-v4", "outdoor-v4", "topo-v4", "base-v4", "dataviz-v4", "landscape-v4", "winter-v4",
    "ocean", "backdrop", "aquarelle", "toner-v2", "openstreetmap", "jp-gsi-standard"]);
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "toner-v2" }, 1, 1, 0), "https://api.maptiler.com/maps/toner-v2/256/1/1/0@2x.jpg?key=K1");
});

test("Mapbox picker: styles by name, each with its id; sources without suggestions have none", () => {
  assert.deepEqual(S.suggestions(src("mapbox"))[0], { name: "Satellite", id: "mapbox/satellite-v9" });
  assert.equal(S.suggestions(src("mapbox")).length, 6);
  assert.deepEqual(S.suggestions(src("eox")), []);
  assert.deepEqual(S.suggestions(src("custom")), []);
});

test("EOX and NASA use large WMS images; the others don't", () => {
  const S = require("../src/core/sources.js");
  assert.equal(S.usesImages(S.byId("eox")), true);
  assert.equal(S.usesImages(S.byId("nasa")), true);
  ["maptiler", "mapbox", "custom"].forEach((id) => assert.equal(S.usesImages(S.byId(id)), false));
  assert.deepEqual(S.byId("eox").wms, { url: "https://tiles.maps.eox.at/wms", layer: "s2cloudless-2024_3857", format: "image/jpeg" });
  assert.deepEqual(S.byId("nasa").wms, { url: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", layer: "BlueMarble_NextGeneration", format: "image/jpeg" });
});

test("imageUrl asks for the rect's exact Web Mercator box at 256 px per tile", () => {
  const S = require("../src/core/sources.js");
  assert.equal(S.imageUrl(S.byId("eox"), { z: 1, x0: 1, y0: 0, x1: 1, y1: 0 }),
    "https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&layers=s2cloudless-2024_3857&styles=&srs=EPSG:3857" +
    "&bbox=0.000,0.000,20037508.343,20037508.343&width=256&height=256&format=image/jpeg");
  assert.match(S.imageUrl(S.byId("nasa"), { z: 4, x0: 8, y0: 5, x1: 11, y1: 7 }), /&width=1024&height=768&format=image\/jpeg$/);
  assert.throws(() => S.imageUrl(S.byId("maptiler"), { z: 1, x0: 0, y0: 0, x1: 0, y1: 0 }), /doesn't serve large images/);
});

test("nasa-night: hidden from the picker, Black Marble 2016 as JPEG, zoom 8", () => {
  const n = S.night();
  assert.equal(n.id, "nasa-night");
  assert.equal(S.byId("nasa-night"), n);
  assert.ok(!S.list().some((s) => s.id === "nasa-night"));
  assert.equal(n.maxZoom, 8);
  assert.equal(S.cacheKey(n, {}), "nasa-night");
  const url = S.imageUrl(n, { z: 3, x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.match(url, /layers=VIIRS_Black_Marble&/);
  assert.match(url, /&time=2016-01-01/);
  assert.match(url, /format=image\/jpeg/);
  assert.equal(S.tileUrl(n, {}, 5, 16, 10), "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/5/10/16.png");
  assert.ok(!/time=/.test(S.imageUrl(S.byId("nasa"), { z: 3, x0: 0, y0: 0, x1: 1, y1: 1 })));
});

test("MapTiler tilesets follow the maps in the picker, named with the Tileset prefix", () => {
  const e = S.suggestions(src("maptiler"));
  assert.equal(e.length, 20);
  assert.deepEqual(e.slice(15), [
    { name: "Tileset \u00b7 Hillshade", id: "tiles/hillshade" },
    { name: "Tileset \u00b7 Hand-drawn hillshade", id: "tiles/hand-drawn-hillshade" },
    { name: "Tileset \u00b7 Land gradient", id: "tiles/land-gradient" },
    { name: "Tileset \u00b7 Land gradient dark", id: "tiles/land-gradient-dark" },
    { name: "Tileset \u00b7 Satellite at night", id: "tiles/satellite-night" }]);
});

test("tileUrl for a tileset: tiles/<id>/<z>/<x>/<y>.webp with the key, no @2x", () => {
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "tiles/hillshade" }, 3, 4, 2), "https://api.maptiler.com/tiles/hillshade/3/4/2.webp?key=K1");
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "tiles/hand-drawn-hillshade" }, 3, 4, 2), "https://api.maptiler.com/tiles/hand-drawn-hillshade/3/4/2.webp?key=K1");
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "tiles/satellite-night" }, 0, 0, 0), "https://api.maptiler.com/tiles/satellite-night/0/0/0.webp?key=K1");
  assert.equal(S.tileUrl(src("maptiler"), { key: "K1", style: "tiles/unknown-set" }, 1, 1, 1), "https://api.maptiler.com/tiles/unknown-set/1/1/1.webp?key=K1");
  assert.throws(() => S.tileUrl(src("maptiler"), { style: "tiles/hillshade" }, 0, 0, 0), /Needs a MapTiler key/);
});

test("tilesets: max zoom from the table, the rest of MapTiler at 20; tiles are 256 px", () => {
  const mt = src("maptiler");
  assert.equal(S.maxZoom(mt, { style: "tiles/hillshade" }), 12);
  assert.equal(S.maxZoom(mt, { style: "tiles/hand-drawn-hillshade" }), 9);
  assert.equal(S.maxZoom(mt, { style: "tiles/land-gradient" }), 4);
  assert.equal(S.maxZoom(mt, { style: "tiles/land-gradient-dark" }), 4);
  assert.equal(S.maxZoom(mt, { style: "tiles/satellite-night" }), 6);
  assert.equal(S.maxZoom(mt, { style: "tiles/unknown-set" }), 20);
  assert.equal(S.maxZoom(mt, { style: "satellite" }), 20);
  assert.equal(S.maxZoom(src("eox"), {}), 15);
  assert.equal(S.maxZoom(src("nasa"), {}), 8);
  assert.equal(S.imagePx(mt, { style: "tiles/hillshade" }), 512);
  assert.equal(S.imagePx(mt, { style: "satellite" }), 512);
  assert.equal(S.imagePx(mt, { style: "streets-v4" }), 512);
  assert.equal(S.imagePx(src("eox"), {}), 256);
  assert.equal(S.imagePx(src("mapbox"), { style: "mapbox/satellite-v9" }), 512);
  assert.equal(S.isTileset(mt, { style: "tiles/hillshade" }), true);
  assert.equal(S.isTileset(mt, { style: "hybrid" }), false);
  assert.equal(S.isTileset(src("mapbox"), { style: "tiles/hillshade" }), false);
});

test("a tileset with no name after tiles/ throws a clear message instead of asking for a 404", () => {
  const mt = src("maptiler");
  const hint = /^Error: Type a tileset name after tiles\/, e\.g\. tiles\/hillshade\.$/;
  assert.throws(() => S.tileUrl(mt, { key: "K1", style: "tiles/" }, 0, 0, 0), hint);
  assert.throws(() => S.tileUrl(mt, { key: "K1", style: "tiles/ " }, 0, 0, 0), hint);
  assert.throws(() => S.tileUrl(mt, { key: "K1", style: "  Tiles/  " }, 0, 0, 0), hint);
  assert.equal(/</.test("Type a tileset name after tiles/, e.g. tiles/hillshade."), false);
});

test("the tiles/ prefix is case-insensitive and trimmed: Tiles/hillshade is the hillshade tileset", () => {
  const mt = src("maptiler");
  assert.equal(S.tileUrl(mt, { key: "K1", style: "Tiles/hillshade" }, 3, 4, 2), "https://api.maptiler.com/tiles/hillshade/3/4/2.webp?key=K1");
  assert.equal(S.tileUrl(mt, { key: "K1", style: "  TILES/hillshade  " }, 3, 4, 2), "https://api.maptiler.com/tiles/hillshade/3/4/2.webp?key=K1");
  assert.equal(S.maxZoom(mt, { style: "Tiles/hillshade" }), 12);
  assert.equal(S.imagePx(mt, { style: "Tiles/hillshade" }), 512);
  assert.equal(S.isTileset(mt, { style: "Tiles/hillshade" }), true);
  assert.equal(S.label(mt, { style: "Tiles/hillshade" }), "MapTiler Hillshade");
});

test("tileset cache keys are filesystem-safe; labels use the friendly name when known", () => {
  assert.equal(S.cacheKey(src("maptiler"), { key: "K", style: "tiles/hillshade" }), "maptiler-tiles_hillshade");
  assert.match(S.cacheKey(src("maptiler"), { key: "K", style: "tiles/land-gradient-dark" }), /^[A-Za-z0-9._-]+$/);
  assert.equal(S.label(src("maptiler"), { style: "tiles/hillshade" }), "MapTiler Hillshade");
  assert.equal(S.label(src("maptiler"), { style: "tiles/satellite-night" }), "MapTiler Satellite at night");
  assert.equal(S.label(src("maptiler"), { style: "tiles/unknown-set" }), "MapTiler tiles/unknown-set");
});

test("isSatellite: EOX, NASA, MapTiler satellite/hybrid, Mapbox *satellite*; never custom or street styles", () => {
  const yes = [{ source: "eox" }, { source: "nasa" }, { source: "maptiler", style: "satellite" }, { source: "maptiler", style: "hybrid" },
    { source: "maptiler", style: "satellite-v4" }, { source: "maptiler", style: "hybrid-v4" },
    { source: "mapbox", style: "mapbox/satellite-v9" }, { source: "mapbox", style: "mapbox/satellite-streets-v12" }];
  const no = [{ source: "custom" }, { source: "maptiler", style: "streets-v2" }, { source: "mapbox", style: "mapbox/streets-v12" },
    { source: "nasa-night" }, null, undefined, {}, { source: "maptiler", style: "tiles/satellite-night" }, { source: "maptiler", style: "tiles/hillshade" }];
  yes.forEach((m) => assert.equal(S.isSatellite(m), true, JSON.stringify(m)));
  no.forEach((m) => assert.equal(S.isSatellite(m), false, JSON.stringify(m)));
});
