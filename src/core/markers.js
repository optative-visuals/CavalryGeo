// Outlines for the plugin's route travellers, pointing along +x (the way a path distribution
// turns its copies) and centred on 0, 0. Pure; the panel turns them into editable shapes.
var GeoMarkers = (function () {
  var OUTLINES = {
    plane: [[12, 0], [8, 1.5], [2, 1.5], [-3, 11], [-6, 11], [-3, 1.5], [-9, 1.5], [-11, 5], [-12, 5], [-10.5, 0],
      [-12, -5], [-11, -5], [-9, -1.5], [-3, -1.5], [-6, -11], [-3, -11], [2, -1.5], [8, -1.5]],
    arrow: [[12, 0], [-12, 9], [-6, 0], [-12, -9]]
  };
  function outline(kind) {
    var pts = OUTLINES[kind];
    if (!pts) throw new Error("Unknown marker: " + kind);
    return pts.map(function (p) { return [p[0], p[1]]; });
  }
  return { outline: outline };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoMarkers;
