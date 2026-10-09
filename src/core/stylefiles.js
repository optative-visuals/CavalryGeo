// Map style files: each saved style is one JSON file in the "Map styles" folder, so a style can be
// shared, backed up or moved between machines. Pure: the panel does the reading, writing and
// folder work; this module only turns styles into file text and back, and plans what a move keeps.
if (typeof GeoStyles === "undefined" && typeof require !== "undefined") { var GeoStyles = require("./styles.js"); }
var GeoStyleFiles = (function () {
  var MARKER = "cavalryGeoStyle", FOLDER = "Map styles";
  // The settings a reset clears, in the order the panel lists them.
  var RESET_KEYS = ["flyEasing", "flyArc", "driftMove", "routeShape", "source", "mapStyle"];

  // A safe file name for a style: characters Windows and macOS refuse become "-".
  function fileName(name) {
    var base = String(name == null ? "" : name).trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").replace(/[. ]+$/, "");
    return (base || "Style") + ".json";
  }

  function toText(style) {
    return JSON.stringify({ cavalryGeoStyle: 1, name: style.name, colors: style.colors, widths: style.widths }, null, 2);
  }

  // Null unless the text is a style file (marker and name present) that is not a built-in.
  function fromText(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    if (!obj || typeof obj !== "object" || obj[MARKER] !== 1) return null;
    if (typeof obj.name !== "string" || !obj.name.trim()) return null;
    return GeoStyles.normalise([obj])[0] || null;
  }

  // entries: [{ path, text }] in folder order. The first of each name wins; the rest are skipped.
  function readAll(entries) {
    var styles = [], skipped = [], seen = {};
    (entries || []).forEach(function (e) {
      var s = fromText(e.text), k = s ? s.name.toLowerCase() : null;
      if (!s || seen[k]) { skipped.push(e.path); return; }
      seen[k] = true;
      styles.push(s);
    });
    return { styles: styles, skipped: skipped };
  }

  // The styles a move carries over from a settings object, normalised and de-duplicated.
  function movePlan(settings) {
    return GeoStyles.normalise(settings ? settings.mapStyles : []);
  }

  return { MARKER: MARKER, FOLDER: FOLDER, RESET_KEYS: RESET_KEYS, fileName: fileName, toText: toText, fromText: fromText, readAll: readAll, movePlan: movePlan };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoStyleFiles;
