// Cavalry attribute ids and value formats, confirmed by running probe scripts in
// Cavalry Pro; see docs/cavalry-api-notes.md for the evidence behind each one.
// Fill and stroke are switched with api.setFill / api.setStroke (not attributes).
var GeoAttrs = {
  MAP_LAYER_TYPE: "javaScriptShape",          // spike + P3
  MAP_EXPR_ATTR: "generator.expression",      // spike
  MAP_ARRAY_ATTR: "generator.array",          // spike + P3
  CAMERA_LAYER_TYPE: "javaScript",            // P2.create
  CAMERA_EXPR_ATTR: "expression",             // P2.exprAttr
  CAMERA_ARRAY_ATTR: "array",                 // P2.CAMERA_ARRAY_ATTR
  CAMERA_BODY: "0;",                          // camera is a JavaScript Utility
  FILL_COLOR_ATTR: "material.materialColor",  // P4
  COLOR_VALUE: function (hex) { return hex; },// P4.setColorHex: hex accepted
  STROKE_COLOR_ATTR: "stroke.strokeColor",    // probe 2 Q2 (after api.setStroke)
  STROKE_WIDTH_ATTR: "stroke.width",          // probe 2 Q2 (after api.setStroke)
  COMP_RESOLUTION_ATTR: "resolution",         // P5: {x, y}
  readResolution: function (v) { return Array.isArray(v) ? { width: v[0], height: v[1] } : { width: v.x, height: v.y }; },
  TEXT_LAYER_TYPE: "textShape",               // probe 2 P7
  TEXT_ATTR: "text",                          // probe 2 P7
  LABEL_MODE: "driver",                       // probe 2 P8
  DRIVER_OUTPUT_ATTR: "id",                   // probe 2 P8 (first combination tried)
  DRIVER_RETURN: "array",                     // probe 2 P8 (first combination tried)
  STROKE_CAP_ATTR: "stroke.capStyle",         // check 6 (null if caps can't be set)
  ROUND_CAP_VALUE: 1,                         // check 6: value that gives round caps
  TRIM_REVERSED: false,                       // check 6: true if Trim runs from the path's last point
  COLOR_INPUT_TYPE: "color",                  // check 9: colour inputs read as {r,g,b,a}
  FILL_ALPHA_ATTR: "opacity",                 // check 9: fill opacity 0-100 (null if none found)
  WEBCLIENT_FOLLOWS_REDIRECTS: false,         // check 9: Google's CSV export answers 307
  ROTATION_SIGN: 1,                           // check 11 (2026-10-02): confirmed - rotation.z direction vs map rotation (+1 same, -1 opposite)
  COMP_FRAME_RANGE_ATTR: "frameRange",        // check 11 (2026-10-02): confirmed - composition frame range attribute ({x: start, y: end})
  ELLIPSE_SCALE: 1,                           // probe 2 P6: addEllipse(x, y, 5, 5) is 10 wide
  // ui.scriptLocation is undefined in Cavalry scripts, so data lives at a fixed path.
  ASSETS_DIR: function () { return String(api.getAppDataFolder()).replace(/\\/g, "/") + "/Scripts/CavalryGeo_assets"; }
};
if (typeof module !== "undefined" && module.exports) module.exports = GeoAttrs;
