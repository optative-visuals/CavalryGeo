// Map style files: each saved style is one JSON file in the "Map styles" folder, so a style can be
// shared, backed up or moved between machines. Pure: the panel does the reading, writing and
// folder work; this module only turns styles into file text and back, and plans what a move keeps.
if (typeof GeoStyles === "undefined" && typeof require !== "undefined") { var GeoStyles = require("./styles.js"); }
var GeoStyleFiles = (function () {
  var MARKER = "cavalryGeoStyle", FOLDER = "Map styles";
  // The settings a reset clears, in the order the panel lists them.
  var RESET_KEYS = ["flyEasing", "flyArc", "driftMove", "routeShape", "source", "mapStyle"];

  // A safe file name for a style: characters Windows and macOS refuse become "-", and a Windows
  // device name (CON, COM1...) gets a dash so it is never taken for a device.
  function fileName(name) {
    var base = String(name == null ? "" : name).trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").replace(/[. ]+$/, "");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base += "-";
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
  // paths maps each kept style's lowercased name to its file, so a save or delete finds the file.
  function readAll(entries) {
    var styles = [], skipped = [], paths = {}, seen = {};
    (entries || []).forEach(function (e) {
      var s = fromText(e.text), k = s ? s.name.toLowerCase() : null;
      if (!s || seen[k]) { skipped.push(e.path); return; }
      seen[k] = true;
      paths[k] = e.path;
      styles.push(s);
    });
    return { styles: styles, skipped: skipped, paths: paths };
  }

  // The styles a move carries over from a settings object, normalised and de-duplicated.
  function movePlan(settings) {
    return GeoStyles.normalise(settings ? settings.mapStyles : []);
  }

  return { MARKER: MARKER, FOLDER: FOLDER, RESET_KEYS: RESET_KEYS, fileName: fileName, toText: toText, fromText: fromText, readAll: readAll, movePlan: movePlan };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoStyleFiles;
