// Raster tile sources for the Imagery tab: URLs, cache keys, labels and credits. Pure.
if (typeof GeoUtil === "undefined" && typeof require !== "undefined") { var GeoUtil = require("./util.js"); }
if (typeof GeoBlocks === "undefined" && typeof require !== "undefined") { var GeoBlocks = require("./blocks.js"); }
var GeoSources = (function () {
  var LIST = [
    { id: "eox", name: "EOX Sentinel-2", label: "EOX Sentinel-2 satellite (non-commercial)", key: null, minZoom: 0, maxZoom: 15, imagePx: 256,
      wms: { url: "https://tiles.maps.eox.at/wms", layer: "s2cloudless-2024_3857", format: "image/jpeg" },
      template: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
      attribution: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)",
      licence: "Free for non-commercial use; commercial use needs an EOX licence." },
    { id: "nasa", name: "NASA Blue Marble", label: "NASA Blue Marble (whole Earth)", key: null, minZoom: 0, maxZoom: 8, imagePx: 256,
      wms: { url: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", layer: "BlueMarble_NextGeneration", format: "image/jpeg" },
      template: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
      attribution: "NASA Blue Marble: Next Generation (NASA Earth Observatory)",
      licence: "Public domain (NASA)." },
    { id: "maptiler", name: "MapTiler", label: "MapTiler (your key)", key: "maptiler", minZoom: 0, maxZoom: 20, imagePx: 512,
      defaultStyle: "satellite",
      suggestions: ["satellite", "hybrid", "streets-v2", "outdoor-v2", "topo-v2", "dataviz", "dataviz-dark", "dataviz-light", "landscape"],
      attribution: "© MapTiler © OpenStreetMap contributors",
      licence: "MapTiler's free plan is non-commercial. Map ID: pick a suggestion or type any MapTiler map ID." },
    { id: "mapbox", name: "Mapbox", label: "Mapbox (your key)", key: "mapbox", minZoom: 0, maxZoom: 22, imagePx: 512,
      defaultStyle: "mapbox/satellite-v9",
      suggestions: ["mapbox/satellite-v9", "mapbox/satellite-streets-v12", "mapbox/streets-v12", "mapbox/outdoors-v12", "mapbox/light-v11", "mapbox/dark-v11"],
      attribution: "© Mapbox © OpenStreetMap contributors",
      licence: "Check Mapbox's terms for video use. Style: pick a suggestion or type user/style from Mapbox Studio." },
    { id: "custom", name: "Custom tiles", label: "Custom tile link", key: null, minZoom: 0, maxZoom: 19, imagePx: 256,
      attribution: "",
      licence: "Only use tiles you have permission to use." }
  ];

  // Night lights (Day & night over satellite imagery): not offered in the Imagery picker.
  var NIGHT = { id: "nasa-night", name: "NASA Black Marble", label: "NASA Black Marble 2016 (night lights)", key: null, minZoom: 0, maxZoom: 8, imagePx: 256,
    wms: { url: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", layer: "VIIRS_Black_Marble", format: "image/jpeg", time: "2016-01-01" },
    template: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
    attribution: "NASA Black Marble 2016 (NASA Earth Observatory / Suomi NPP VIIRS)",
    licence: "Public domain (NASA)." };

  function list() { return LIST; }
  function night() { return NIGHT; }
  function byId(id) {
    if (id === NIGHT.id) return NIGHT;
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    throw new Error("Unknown imagery source: " + id);
  }
  function fill(template, z, x, y) { return template.replace(/\{z\}/g, z).replace(/\{x\}/g, x).replace(/\{y\}/g, y); }
  function style(src, opts) { return String((opts && opts.style) || "").trim() || src.defaultStyle || ""; }
  // A custom link must start with https:// and contain {z}, {x} and {y}.
  function validTemplate(t) {
    return /^https?:\/\//.test(t) && t.indexOf("{z}") >= 0 && t.indexOf("{x}") >= 0 && t.indexOf("{y}") >= 0;
  }
  function customTemplate(opts) {
    var t = String((opts && opts.template) || "").trim();
    if (!validTemplate(t)) throw new Error("Needs a custom tile link: set it in \u2699 Settings.");
    return t;
  }
  // What a source still needs from Settings before it can be used, or null when nothing is missing.
  function missingSetting(src, opts) {
    opts = opts || {};
    if (src.id === "maptiler" && !opts.key) return "Needs a MapTiler key: set it in \u2699 Settings.";
    if (src.id === "mapbox" && !opts.key) return "Needs a Mapbox token: set it in \u2699 Settings.";
    if (src.id === "custom" && !validTemplate(String(opts.template || "").trim())) return "Needs a custom tile link: set it in \u2699 Settings.";
    return null;
  }

  function tileUrl(src, opts, z, x, y) {
    opts = opts || {};
    if (src.id === "maptiler") {
      if (!opts.key) throw new Error(missingSetting(src, opts));
      var map = style(src, opts);
      return "https://api.maptiler.com/maps/" + encodeURIComponent(map) + "/256/" + z + "/" + x + "/" + y + "@2x.jpg?key=" + encodeURIComponent(opts.key);
    }
    if (src.id === "mapbox") {
      if (!opts.key) throw new Error(missingSetting(src, opts));
      var st = style(src, opts);
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(st)) throw new Error("Mapbox styles look like mapbox/satellite-v9.");
      return "https://api.mapbox.com/styles/v1/" + st + "/tiles/256/" + z + "/" + x + "/" + y + "@2x?access_token=" + encodeURIComponent(opts.key);
    }
    if (src.id === "custom") return fill(customTemplate(opts), z, x, y);
    return fill(src.template, z, x, y);
  }

  function splitUrl(url) {
    var m = /^(https?:\/\/[^\/?#]+)(.*)$/.exec(String(url));
    if (!m) throw new Error("Not a web link: " + url);
    return { base: m[1], path: m[2] || "/" };
  }
  function safe(s) { return String(s).replace(/[^A-Za-z0-9._-]/g, "_"); }
  function cacheKey(src, opts) {
    if (src.id === "maptiler" || src.id === "mapbox") return src.id + "-" + safe(style(src, opts));
    if (src.id === "custom") return "custom-" + GeoUtil.hash(customTemplate(opts));
    return src.id;
  }
  function label(src, opts) {
    if (src.id === "maptiler" || src.id === "mapbox") return src.name + " " + style(src, opts);
    return src.name;
  }
  function meta(src, opts) {
    var m = { source: src.id };
    if (src.id === "maptiler" || src.id === "mapbox") m.style = style(src, opts);
    return m;
  }
  function attribution(src, opts) { return src.id === "custom" ? String((opts && opts.customAttribution) || "") : src.attribution; }
  function providerName(src) { return src.id === "custom" ? "The tile server" : src.name.split(" ")[0]; }
  function extForContentType(ct) {
    var t = String(ct || "").toLowerCase();
    if (/image\/jpe?g/.test(t)) return "jpg";
    if (/image\/png/.test(t)) return "png";
    return null;
  }
  function extForUrl(url) {
    var m = /\.(jpe?g|png)(\?|#|$)/i.exec(String(url));
    return m ? (m[1].toLowerCase() === "png" ? "png" : "jpg") : null;
  }

  // EOX and NASA serve WMS, so a whole block of tiles comes as one image (GeoBlocks).
  function usesImages(src) { return !!src.wms; }
  function imageUrl(src, rect) {
    if (!src.wms) throw new Error(src.name + " doesn't serve large images.");
    var b = GeoBlocks.rectMercator(rect), px = GeoBlocks.rectPixels(rect);
    return src.wms.url + "?service=WMS&request=GetMap&version=1.1.1&layers=" + src.wms.layer + "&styles=&srs=EPSG:3857" +
      "&bbox=" + [b.minx, b.miny, b.maxx, b.maxy].map(function (v) { return v.toFixed(3); }).join(",") +
      "&width=" + px[0] + "&height=" + px[1] + "&format=" + src.wms.format + (src.wms.time ? "&time=" + src.wms.time : "");
  }

  // Satellite imagery (not street maps, not custom links): night lights are shown over these.
  function isSatellite(m) {
    if (!m || typeof m !== "object") return false;
    if (m.source === "eox" || m.source === "nasa") return true;
    if (m.source === "maptiler") return m.style === "satellite" || m.style === "hybrid";
    if (m.source === "mapbox") return String(m.style || "").indexOf("satellite") >= 0;
    return false;
  }

  return { list: list, night: night, isSatellite: isSatellite, byId: byId, tileUrl: tileUrl, missingSetting: missingSetting, splitUrl: splitUrl, cacheKey: cacheKey, label: label, meta: meta,
    attribution: attribution, providerName: providerName, extForContentType: extForContentType, extForUrl: extForUrl,
    usesImages: usesImages, imageUrl: imageUrl };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoSources;
