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
  assert.throws(() => S.tileUrl(src("maptiler"), {}, 0, 0, 0), /Paste your MapTiler key first/);
  assert.throws(() => S.tileUrl(src("mapbox"), {}, 0, 0, 0), /Paste your Mapbox access token first/);
  assert.throws(() => S.tileUrl(src("mapbox"), { key: "T", style: "satellite" }, 0, 0, 0), /mapbox\/satellite-v9/);
  assert.throws(() => S.tileUrl(src("custom"), { template: "https://x/{z}/{x}.png" }, 0, 0, 0), /\{z\}, \{x\} and \{y\}/);
  assert.equal(S.tileUrl(src("custom"), { template: " https://t.example/{z}/{x}/{y}.png " }, 5, 6, 7), "https://t.example/5/6/7.png");
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
  assert.equal(S.extForContentType("image/webp"), null);
  assert.equal(S.extForUrl("https://a/1/2/3.jpeg?x=1"), "jpg");
  assert.equal(S.extForUrl("https://a/1/2/3.png"), "png");
  assert.equal(S.extForUrl("https://a/1/2/3@2x?k=1"), null);
  assert.deepEqual(S.splitUrl("https://api.maptiler.com/maps/x/1.png?key=K"), { base: "https://api.maptiler.com", path: "/maps/x/1.png?key=K" });
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

test("isSatellite: EOX, NASA, MapTiler satellite/hybrid, Mapbox *satellite*; never custom or street styles", () => {
  const yes = [{ source: "eox" }, { source: "nasa" }, { source: "maptiler", style: "satellite" }, { source: "maptiler", style: "hybrid" },
    { source: "mapbox", style: "mapbox/satellite-v9" }, { source: "mapbox", style: "mapbox/satellite-streets-v12" }];
  const no = [{ source: "custom" }, { source: "maptiler", style: "streets-v2" }, { source: "mapbox", style: "mapbox/streets-v12" },
    { source: "nasa-night" }, null, undefined, {}];
  yes.forEach((m) => assert.equal(S.isSatellite(m), true, JSON.stringify(m)));
  no.forEach((m) => assert.equal(S.isSatellite(m), false, JSON.stringify(m)));
});
