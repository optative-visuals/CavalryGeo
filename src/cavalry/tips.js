// Every hover tooltip in one table, so the wording is edited in one place. Keys are stable ids like
// "map.refreshControls"; GeoStyle.tip puts the text on a widget. Plain sentences, no markup, and
// never a less-than sign (Cavalry may read tooltips as rich text).
var GeoTips = (function () {
  var TEXTS = {
    "map.refreshControls": "Re-reads the map's controls from the scene, so the panel matches the layers you have now.",
    "map.search": "Type a place name, then press Search to find it on the map.",
    "layers.clearCache": "Deletes the downloaded OpenStreetMap files kept on this computer, so the next build downloads them again."
  };
  function text(key) {
    if (!Object.prototype.hasOwnProperty.call(TEXTS, key)) throw new Error("No tooltip for " + key);
    return TEXTS[key];
  }
  function keys() { return Object.keys(TEXTS); }
  return { text: text, keys: keys };
})();
