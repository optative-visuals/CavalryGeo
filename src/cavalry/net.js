// Downloads (Overpass, Nominatim, Natural Earth) and the on-disk cache. Panel-only: uses `api` and `ui`.
var GeoNet = (function () {
  var USER_AGENT = "CavalryGeo/" + (typeof GEO_VERSION !== "undefined" ? GEO_VERSION : "dev") + " (https://github.com/optative-visuals/CavalryGeo)";
  var OVERPASS = ["https://overpass-api.de", "https://overpass.kumi.systems"];
  var NOMINATIM = "https://nominatim.openstreetmap.org";
  var GITHUB_RAW = "https://raw.githubusercontent.com";
  var lastSearch = 0;
  // Some networks can't reach one of a host's DNS-returned addresses (e.g. an
  // IPv6 record). Cavalry's WebClient then times out and reports status -1
  // with no body. Retry those network-level failures a few times before
  // falling through to the next mirror; real HTTP statuses (429, 504, ...)
  // are not retried here.
  var NETWORK_ATTEMPTS = 3;

  function assetsDir() { return GeoAttrs.ASSETS_DIR(); }

  function ensureDir(dir) {
    var parts = dir.split("/"), cur = parts[0];
    for (var i = 1; i < parts.length; i++) {
      cur += "/" + parts[i];
      if (!api.filePathExists(cur)) api.makeFolder(cur);
    }
  }

  // "Clear cache" bumps a generation number so old entries are never read again.
  function generationFile() { return assetsDir() + "/cache/generation.txt"; }
  function generation() { var f = generationFile(); return api.filePathExists(f) ? (parseInt(api.readFromFile(f), 10) || 0) : 0; }
  function bumpGeneration() { ensureDir(assetsDir() + "/cache"); api.writeToFile(generationFile(), String(generation() + 1), true); }

  function tilesDir() { return assetsDir() + "/cache/tiles"; }
  function imagesDir() { return assetsDir() + "/cache/images"; }

  // Deletes every file under `entries`, then the emptied folders (Cavalry only
  // deletes empty folders, so folders go deepest-first), and reports what was freed.
  function deleteEntries(entries) {
    var isDir = function (p) { return typeof api.isDirectory === "function" ? api.isDirectory(p) : !/\.[a-z0-9]+$/i.test(p); };
    var files = entries.filter(function (p) { return !isDir(p); });
    var folders = entries.filter(isDir).sort(function (a, b) { return b.length - a.length; });
    var bytes = 0, deleted = 0;
    files.forEach(function (p) {
      var kb = typeof api.getFileSize === "function" ? Number(api.getFileSize(p)) || 0 : 0;
      try { api.deleteFilePath(p); } catch (e) { /* locked or refused: counted as not deleted */ }
      if (!api.filePathExists(p)) { deleted++; bytes += Math.round(kb * 1024); }
    });
    folders.forEach(function (p) { try { api.deleteFilePath(p); } catch (e) { /* leftover empty folder is harmless */ } });
    return { files: deleted, bytes: bytes, complete: deleted === files.length };
  }

  // Deletes every cached file except imagery tiles and images (built imagery footage
  // points at those files - see clearTiles) and background downloads' bookkeeping
  // (cache/downloads: a running curl still writes there), then the emptied folders, and
  // reports what was freed. If deleting isn't possible, falls back to bumping the generation so old
  // entries are simply never read again.
  function clearCache() {
    var dir = assetsDir() + "/cache";
    if (!api.filePathExists(dir)) return { files: 0, bytes: 0, fallback: false };
    if (typeof api.listDirectoryRecursive !== "function" || typeof api.deleteFilePath !== "function") {
      bumpGeneration();
      return { files: 0, bytes: 0, fallback: true };
    }
    var keep = [tilesDir(), imagesDir(), dir + "/downloads"];
    var entries = api.listDirectoryRecursive(dir).filter(function (p) {
      return !keep.some(function (k) { return p === k || p.indexOf(k + "/") === 0; });
    });
    var r = deleteEntries(entries);
    if (!r.complete) {
      bumpGeneration();
      return { files: r.files, bytes: r.bytes, fallback: true };
    }
    return { files: r.files, bytes: r.bytes, fallback: false };
  }

  // Deletes every downloaded imagery tile and large image (and the emptied folders under
  // them), leaving the rest of the cache alone. Imagery already built from the deleted
  // files will show missing images until it's rebuilt.
  function clearTiles() {
    if (typeof api.listDirectoryRecursive !== "function" || typeof api.deleteFilePath !== "function") {
      return { files: 0, bytes: 0, fallback: true };
    }
    var files = 0, bytes = 0, complete = true;
    [tilesDir(), imagesDir()].forEach(function (dir) {
      if (!api.filePathExists(dir)) return;
      var r = deleteEntries(api.listDirectoryRecursive(dir));
      files += r.files; bytes += r.bytes; complete = complete && r.complete;
    });
    return { files: files, bytes: bytes, fallback: !complete };
  }

  function cached(key, produce) {
    var dir = assetsDir() + "/cache/g" + generation(), file = dir + "/" + GeoUtil.hash(key) + ".json";
    if (api.filePathExists(file)) {
      try { return JSON.parse(api.readFromFile(file)); } catch (e) { /* corrupt cache file: ignore and re-produce below */ }
    }
    var value = produce();
    ensureDir(dir);
    api.writeToFile(file, JSON.stringify(value), true);
    return value;
  }

  function get(base, path) {
    var result;
    for (var attempt = 0; attempt < NETWORK_ATTEMPTS; attempt++) {
      var c = new api.WebClient(base);
      c.addHeader("User-Agent", USER_AGENT);
      c.get(path);
      var status = c.status();
      result = { status: status, body: status === 200 ? c.body() : "", headers: typeof c.getHeaders === "function" ? (c.getHeaders() || {}) : {} };
      if (status !== -1) return result;
    }
    return result;
  }

  var MAX_REDIRECTS = 3;
  var SHARE_MSG = "Couldn't read that link as CSV — for Google Sheets, set sharing to 'Anyone with the link'.";

  function headerValue(headers, name) {
    for (var k in headers) if (k.toLowerCase() === name) return headers[k];
    return null;
  }

  function getFollowingRedirects(base, path) {
    for (var hop = 0; hop <= MAX_REDIRECTS; hop++) {
      var r = get(base, path);
      if (r.status < 300 || r.status > 308) return r;
      var loc = headerValue(r.headers, "location");
      if (!loc) return r;
      if (loc.charAt(0) === "/") { path = loc; continue; }
      var m = /^(https?:\/\/[^\/?#]+)(.*)$/.exec(loc);
      if (!m) return r;
      base = m[1]; path = m[2] || "/";
    }
    throw new Error("That link sent too many redirects.");
  }

  function fetchCsv(url) {
    var loc = GeoDataset.csvLocation(url);
    var r;
    try {
      r = getFollowingRedirects(loc.base, loc.path);
    } catch (e) {
      // Google's sign-in chain for a private sheet can run past the redirect cap; give
      // the sharing tip instead of the generic "too many redirects" for any other link.
      if (/docs\.google\.com/i.test(loc.base) && /too many redirects/i.test(e.message)) throw new Error(SHARE_MSG);
      throw e;
    }
    if (r.status === 401 || r.status === 403) throw new Error(SHARE_MSG);
    if (r.status !== 200) throw new Error("Couldn't download that link (status " + r.status + ").");
    if (/^\s*</.test(r.body)) throw new Error(SHARE_MSG);
    return r.body;
  }

  // Looks up place names (1 request/second, as Nominatim asks), caching each answer.
  function geocodePlaces(names) {
    var out = {};
    (names || []).forEach(function (name) {
      var hit = cached("geocode|" + name, function () {
        while (Date.now() - lastSearch < 1100) { if (typeof api.processEvents === "function") api.processEvents(); }
        lastSearch = Date.now();
        var r = get(NOMINATIM, GeoSearch.path(name));
        if (r.status !== 200) throw new Error("Place lookup failed for \"" + name + "\" (status " + r.status + "). Try again."); // never cache a failure
        var results = GeoSearch.parse(JSON.parse(r.body));
        return results.length ? { lon: results[0].lon, lat: results[0].lat } : { none: true };
      });
      if (hit && !hit.none) out[name] = [hit.lon, hit.lat];
    });
    return out;
  }

  // Overpass timeouts and out-of-memory conditions are often reported as HTTP 200
  // with a "remark" field describing the error and empty/partial elements. Treat
  // that like a failed status: try the next mirror, and never cache it.
  function overpassJson(query) {
    var last = 0, overloaded = false;
    for (var i = 0; i < OVERPASS.length; i++) {
      var r = get(OVERPASS[i], "/api/interpreter?data=" + encodeURIComponent(query));
      if (r.status === 200) {
        var json = JSON.parse(r.body);
        if (json && json.remark && /error/i.test(json.remark)) { overloaded = true; last = r.status; continue; }
        return json;
      }
      last = r.status;
    }
    if (overloaded) {
      throw new Error("OpenStreetMap's servers were overloaded and could not finish this query. Try a smaller area, or use Main features only.");
    }
    throw new Error("OpenStreetMap servers are busy or unreachable (status " + last + "). Try again in a minute, or use a smaller area.");
  }

  // bboxes: one box, or several (a view split at the date line). Each box is one
  // Overpass request; their elements are merged so parse() drops duplicates.
  function osmLayer(category, bboxes, mode) {
    var boxes = Array.isArray(bboxes) ? bboxes : [bboxes];
    var queries = boxes.map(function (b) { return GeoOSM.buildQuery(category, b, mode); });
    return cached("osm|" + mode + "|" + queries.join("|"), function () {
      var elements = [];
      queries.forEach(function (q) { elements = elements.concat(overpassJson(q).elements || []); });
      return GeoCodec.encodeLayer(GeoOSM.parse(category, { elements: elements }, mode));
    });
  }

  function neLayer(category, scale) {
    if (scale !== "10m") {
      var f = assetsDir() + "/ne/" + scale + "/" + category + ".json";
      if (!api.filePathExists(f)) throw new Error("Bundled data missing (" + f + "). Reinstall Cavalry Geo.");
      return JSON.parse(api.readFromFile(f));
    }
    return cached("ne2|10m|" + category, function () {
      var r = get(GITHUB_RAW, GeoNE.sourcePath(category, "10m"));
      if (r.status !== 200) throw new Error("Could not download high-detail " + category + " (status " + r.status + ").");
      return GeoCodec.encodeLayer(GeoNE.fromGeoJSON(category, JSON.parse(r.body)));
    });
  }

  function search(q) {
    var now = Date.now();
    if (now - lastSearch < 1000) throw new Error("Please wait a second between searches.");
    lastSearch = now;
    var r = get(NOMINATIM, GeoSearch.path(q));
    if (r.status !== 200) throw new Error("Search failed (status " + r.status + ").");
    return GeoSearch.parse(JSON.parse(r.body));
  }

  // ---- Imagery tiles and panel settings --------------------------------------
  function tileBase(cacheKey, z, x, y) { return assetsDir() + "/cache/tiles/" + cacheKey + "/" + z + "/" + x + "/" + y; }
  function imageBase(cacheKey, r) { return imagesDir() + "/" + cacheKey + "/" + r.z + "/" + r.x0 + "_" + r.y0 + "_" + r.x1 + "_" + r.y1; }
  function cachedTile(base) {
    var exts = ["jpg", "png"];
    for (var i = 0; i < exts.length; i++) if (api.filePathExists(base + "." + exts[i])) return base + "." + exts[i];
    return null;
  }
  // A tile that answered 404/204 (no imagery there) is marked with a sidecar file so
  // it isn't downloaded again on every plan; it stays neither missing nor cached.
  function markEmptyTile(base) { ensureDir(base.slice(0, base.lastIndexOf("/"))); api.writeToFile(base + ".empty", "1", true); }
  function isEmptyTile(base) { return api.filePathExists(base + ".empty"); }
  // Downloads one tile next to `base`, choosing .jpg/.png from the Content-Type (or the
  // URL when there is none). Network failures (-1) are retried; HTTP errors are returned.
  function downloadTile(url, base) {
    var loc = GeoSources.splitUrl(url);
    for (var attempt = 0; attempt < NETWORK_ATTEMPTS; attempt++) {
      var c = new api.WebClient(loc.base);
      c.addHeader("User-Agent", USER_AGENT);
      c.get(loc.path);
      var status = c.status();
      if (status === -1) continue;
      if (status !== 200) return { status: status };
      var headers = typeof c.getHeaders === "function" ? (c.getHeaders() || {}) : {};
      var ct = headerValue(headers, "content-type");
      var ext = ct ? GeoSources.extForContentType(ct) : GeoSources.extForUrl(url);
      if (!ext) return { status: 200, unsupported: ct || "unknown" };
      ensureDir(base.slice(0, base.lastIndexOf("/")));
      c.writeBodyToBinaryFile(base + "." + ext);
      return { status: 200, path: base + "." + ext };
    }
    return { status: -1 };
  }

  function settingsFile() { return assetsDir() + "/settings.json"; }
  function plainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function readSettingsRaw() {
    var f = settingsFile();
    if (!api.filePathExists(f)) return null;
    try { return String(api.readFromFile(f)); } catch (e) { return null; }
  }
  function parseSettings(raw) {
    try { var v = JSON.parse(raw); return plainObject(v) ? v : null; } catch (e) { return null; }
  }
  function loadSettings() {
    var raw = readSettingsRaw();
    return (raw === null ? null : parseSettings(raw)) || {};
  }
  function saveSettings(obj) { ensureDir(assetsDir()); api.writeToFile(settingsFile(), JSON.stringify(obj, null, 2), true); }
  // Merges patch's keys into settings.json, keeping every other key.
  function updateSettings(patch) {
    var raw = readSettingsRaw(), s = raw === null ? {} : parseSettings(raw);
    if (!s) {
      // The file is there but unreadable: keep a copy before it is replaced.
      s = {};
      if (raw !== null && raw !== "") { try { ensureDir(assetsDir()); api.writeToFile(settingsFile() + ".bak", raw, true); } catch (e) { /* the copy is a courtesy */ } }
    }
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    saveSettings(s);
    return s;
  }

  return {
    search: search, osmLayer: osmLayer, neLayer: neLayer, clearCache: clearCache, clearTiles: clearTiles, fetchCsv: fetchCsv, geocodePlaces: geocodePlaces,
    tileBase: tileBase, imageBase: imageBase, USER_AGENT: USER_AGENT, ensureDir: ensureDir, cachedTile: cachedTile, downloadTile: downloadTile, markEmptyTile: markEmptyTile, isEmptyTile: isEmptyTile,
    loadSettings: loadSettings, saveSettings: saveSettings, updateSettings: updateSettings
  };
})();
