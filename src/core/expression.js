// Builds and reads the JavaScript expressions stored on Cavalry Geo layers.
// Inputs are read by their renamed name first, then by Cavalry's nN index name.
var GeoExpression = (function () {
  var CAMERA_INPUTS = [["centerLat", 0], ["centerLon", 0], ["zoom", 2], ["rotation", 0], ["projection", 0]];
  var MAP_INPUTS = [["camLat", 0], ["camLon", 0], ["camZoom", 2], ["camRotation", 0], ["camProjection", 0], ["detail", 100], ["pointRadius", 4]];
  var ROUTE_INPUTS = MAP_INPUTS.concat([["lift", 30]]);
  var LABEL_INPUTS = [["camLat", 0], ["camLon", 0], ["camZoom", 2], ["camRotation", 0], ["camProjection", 0], ["labelLon", 0], ["labelLat", 0]];
  var COLOR_DEFAULTS = [["low", "#f2e8cf", "color"], ["high", "#bc4749", "color"], ["useMiddle", 0], ["middle", "#ffffff", "color"], ["middleValue", 0], ["min", 0], ["max", 0]];
  var REGION_INPUTS = MAP_INPUTS.concat([["year", 0]], COLOR_DEFAULTS, [["noData", "#dddddd", "color"]]);
  var BUBBLE_INPUTS = MAP_INPUTS.concat([["year", 0], ["maxRadius", 40]]);
  var VALUE_LABEL_INPUTS = MAP_INPUTS.concat([["year", 0], ["textSize", 16], ["format", 0], ["decimals", 1]]);
  // Numbers first: a new script layer's slot 0 already exists as a number input.
  var LEGEND_INPUTS = ["min", "max", "useMiddle", "middleValue", "low", "high", "middle"].map(function (n) {
    return COLOR_DEFAULTS.filter(function (inp) { return inp[0] === n; })[0];
  });
  var BUBBLE_LEGEND_INPUTS = [["maxRadius", 40]];
  var IMAGERY_INPUTS = MAP_INPUTS.slice(0, 5);
  // Route helpers (new-style routes): a stop's end point = its holder + the dragged circle; a
  // leg's handle from both stops' holder + circle positions and the curve settings; a leg fades
  // with whichever of its stops is hidden.
  var END_POINT_INPUTS = [["holderX", 0], ["holderY", 0], ["stopX", 0], ["stopY", 0]];
  var HANDLE_INPUTS = [["aHolderX", 0], ["aHolderY", 0], ["aStopX", 0], ["aStopY", 0], ["bHolderX", 0], ["bHolderY", 0], ["bStopX", 0], ["bStopY", 0],
    ["arc", 30], ["lean", 0], ["flip", 0], ["hand", 0], ["handX", 0], ["handY", 0]];
  var FADE_INPUTS = [["fromOpacity", 100], ["toOpacity", 100]];
  function inputIndex(inputs, name) {
    for (var i = 0; i < inputs.length; i++) if (inputs[i][0] === name) return i;
    return -1;
  }
  var RETURN_FORMS = { array: "[_p[0], _p[1]];", object: "({x: _p[0], y: _p[1]});", point: "new cavalry.Point(_p[0], _p[1]);" };
  var CAM = "{lat: _i0, lon: _i1, zoom: _i2, rotation: _i3, projection: _i4}";
  var DATA_OPEN = "/*GEO_DATA*/var GEO_DATA = ", DATA_CLOSE = ";/*GEO_DATA_END*/";

  function writeTag(tag, obj) {
    return "/*" + tag + " " + JSON.stringify(obj).replace(/\*\//g, "*\\/") + " " + tag + "*/";
  }

  function readTag(expr, tag) {
    var open = "/*" + tag + " ", close = " " + tag + "*/";
    var a = expr.indexOf(open);
    if (a < 0) return null;
    var b = expr.indexOf(close, a);
    if (b < 0) return null;
    try { return JSON.parse(expr.slice(a + open.length, b)); } catch (e) { return null; }
  }

  function inputPrelude(inputs) {
    return inputs.map(function (inp, i) {
      return "var _i" + i + " = (typeof " + inp[0] + " !== \"undefined\") ? " + inp[0] +
        " : ((typeof n" + i + " !== \"undefined\") ? n" + i + " : " + JSON.stringify(inp[1]) + ");";
    }).join("\n") + "\n";
  }

  function layerExpression(inputs, runtimeSrc, enc, meta, optsSrc) {
    return writeTag("GEO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(inputs) +
      DATA_OPEN + JSON.stringify(enc) + DATA_CLOSE + "\n" +
      "GeoRuntime.buildPath(GEO_DATA, " + CAM + ", _i5, " + optsSrc + ", cavalry.Path);\n";
  }

  function customExpression(inputs, runtimeSrc, data, meta, callSrc) {
    return writeTag("GEO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(inputs) +
      DATA_OPEN + JSON.stringify(data) + DATA_CLOSE + "\n" + callSrc + "\n";
  }
  function regionsExpression(src, data, meta) {
    return customExpression(REGION_INPUTS, src, data, meta, "GeoData.choropleth(GEO_DATA, " + CAM + ", {year: _i7, low: _i8, high: _i9, useMiddle: _i10, middle: _i11, middleValue: _i12, min: _i13, max: _i14, noData: _i15}, cavalry);");
  }
  function bubblesExpression(src, data, meta, opts) {
    var es = Number(opts && opts.ellipseScale != null ? opts.ellipseScale : 1);
    return customExpression(BUBBLE_INPUTS, src, data, meta, "GeoData.bubbles(GEO_DATA, " + CAM + ", {year: _i7, maxRadius: _i8, ellipseScale: " + es + "}, cavalry.Path);");
  }
  function valueLabelsExpression(src, data, meta) {
    return customExpression(VALUE_LABEL_INPUTS, src, data, meta, "GeoData.valueLabels(GEO_DATA, " + CAM + ", {year: _i7, textSize: _i8, format: _i9, decimals: _i10}, cavalry);");
  }
  function legendExpression(src, data, meta) {
    return customExpression(LEGEND_INPUTS, src, data, meta, "GeoData.legend(GEO_DATA, {min: _i0, max: _i1, useMiddle: _i2, middleValue: _i3, low: _i4, high: _i5, middle: _i6}, cavalry);");
  }
  function bubbleLegendExpression(src, data, meta) {
    return customExpression(BUBBLE_LEGEND_INPUTS, src, data, meta, "GeoData.bubbleLegend(GEO_DATA, {maxRadius: _i0}, cavalry);");
  }
  function replaceData(expr, data) {
    var a = expr.indexOf(DATA_OPEN), b = expr.indexOf(DATA_CLOSE, a);
    if (a < 0 || b < 0) throw new Error("That layer has no stored data to replace.");
    return expr.slice(0, a + DATA_OPEN.length) + JSON.stringify(data) + expr.slice(b);
  }

  function mapLayerExpression(runtimeSrc, enc, meta, opts) {
    var ellipseScale = Number(opts && opts.ellipseScale != null ? opts.ellipseScale : 1);
    return layerExpression(MAP_INPUTS, runtimeSrc, enc, meta, "{pointRadius: _i6, ellipseScale: " + ellipseScale + "}");
  }

  function routeLayerExpression(runtimeSrc, enc, meta, opts) {
    var ellipseScale = Number(opts && opts.ellipseScale != null ? opts.ellipseScale : 1);
    return layerExpression(ROUTE_INPUTS, runtimeSrc, enc, meta, "{pointRadius: _i6, ellipseScale: " + ellipseScale + ", lift: _i7}");
  }

  // Highlights: the map inputs plus Pulse's phase (0-1 from an Oscillator). The effect in the meta
  // sets how far the outline grows outward: Pulse rings out to 40 px, Glow 6 px, the others not at all.
  var HIGHLIGHT_SHAPE_INPUTS = MAP_INPUTS.concat([["phase", 0]]);
  var HIGHLIGHT_GROW = { pulse: 40, glow: 6 };
  // Above this many points the grow step scales the outline instead of offsetting it: offset gets slow on detailed outlines.
  var HIGHLIGHT_OFFSET_MAX_POINTS = 500;
  function highlightLayerExpression(runtimeSrc, enc, meta, opts) {
    var ellipseScale = Number(opts && opts.ellipseScale != null ? opts.ellipseScale : 1);
    var grow = meta.effect === "pulse" ? "_i7 * " + HIGHLIGHT_GROW.pulse : meta.effect === "glow" ? String(HIGHLIGHT_GROW.glow) : "0";
    return writeTag("GEO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(HIGHLIGHT_SHAPE_INPUTS) +
      DATA_OPEN + JSON.stringify(enc) + DATA_CLOSE + "\n" +
      "var _hp = GeoRuntime.buildPath(GEO_DATA, " + CAM + ", _i5, {pointRadius: _i6, ellipseScale: " + ellipseScale + "}, cavalry.Path);\n" +
      "var _hg = " + grow + ";\n" +
      "if (_hg > 0) { try {\n" +
      "  if (_hp.pointCount() <= " + HIGHLIGHT_OFFSET_MAX_POINTS + ") { _hp.offset(_hg, true); }\n" +
      "  else { var _hb = _hp.boundingBox(), _hs = 1 + 2 * _hg / Math.max(1, (_hb.width + _hb.height) / 2); _hp.translate(-_hb.centre.x, -_hb.centre.y); _hp.scale(_hs, _hs); _hp.translate(_hb.centre.x, _hb.centre.y); }\n" +
      "} catch (_he) { /* plain outline */ } }\n" +
      "_hp;\n";
  }
  // Pulse: the ring fades out as it grows.
  var HIGHLIGHT_FADE_INPUTS = [["phase", 0]];
  function highlightFadeExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(HIGHLIGHT_FADE_INPUTS) + "(1 - _i0) * 100;\n";
  }

  function readData(expr) {
    var a = expr.indexOf(DATA_OPEN);
    if (a < 0) return null;
    var b = expr.indexOf(DATA_CLOSE, a);
    if (b < 0) return null;
    return JSON.parse(expr.slice(a + DATA_OPEN.length, b));
  }

  function cameraExpression(meta, body) {
    return writeTag("GEO_CAMERA", meta) + "\n" + (body || "0;") + "\n";
  }

  function labelDriverExpression(runtimeSrc, meta, returnForm) {
    var ret = RETURN_FORMS[returnForm];
    if (!ret) throw new Error("Unknown driver return form: " + returnForm);
    return writeTag("GEO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(LABEL_INPUTS) +
      "var _p = GeoRuntime.projectPoint(_i5, _i6, " + CAM + ");\n" + ret + "\n";
  }

  // Drives a label's opacity: 100 on screen, 0 when its place is behind the globe.
  function labelVisibilityExpression(runtimeSrc, meta) {
    return writeTag("GEO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(LABEL_INPUTS) +
      "(GeoRuntime.pointVisible(_i5, _i6, " + CAM + ") ? 100 : 0);\n";
  }

  // Imagery: the outer group turns with the camera; each zoom-level group is moved,
  // scaled and faded by three drivers that run GeoTiles (inlined runtime source).
  function imageryRotationExpression(meta, sign) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(IMAGERY_INPUTS) + "(" + Number(sign) + " * _i3);\n";
  }
  function imageryLevelExpression(runtimeSrc, attr, level) {
    var L = Number(level.L), call;
    if (attr === "position") call = "GeoTiles.levelPosition(" + CAM + ", " + L + ", " + Number(level.x0) + ", " + Number(level.y0) + ");";
    else if (attr === "scale") call = "GeoTiles.levelScale(" + CAM + ", " + L + ");";
    else if (attr === "opacity") call = "GeoTiles.levelOpacity(_i2, " + L + ", " + Number(level.lo) + ", " + Number(level.hi) + ", _i4);";
    else throw new Error("Unknown imagery driver: " + attr);
    return runtimeSrc + "\n;\n" + inputPrelude(IMAGERY_INPUTS) + call + "\n";
  }

  function routeEndPointExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(END_POINT_INPUTS) + "[_i0 + _i2, _i1 + _i3];\n";
  }

  function routeHandleExpression(curveSrc, meta, which) {
    if (which !== "start" && which !== "end") throw new Error("Unknown handle: " + which);
    return writeTag("GEO_META", meta) + "\n" + curveSrc + "\n;\n" + inputPrelude(HANDLE_INPUTS) +
      "(_i11 ? [_i12, _i13] : GeoCurve.handles([_i0 + _i2, _i1 + _i3], [_i4 + _i6, _i5 + _i7], {arc: _i8, lean: _i9, flip: _i10})." + which + ");\n";
  }

  var ROUTE_DRAW_INPUTS = [["travel", 100], ["index", 0], ["count", 1]];
  // One leg's draw-on from the route's Travel %: the legs draw one after another.
  function routeDrawExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(ROUTE_DRAW_INPUTS) + "Math.max(0, Math.min(100, (_i0 / 100 * _i2 - _i1) * 100));\n";
  }
  function routeFadeExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(FADE_INPUTS) + "Math.min(_i0, _i1);\n";
  }

  // Route travellers: a leg's copy sits at the tip of its draw-on (Cavalry wraps 100 % back
  // to the start, so stop just short) and only shows on the leg currently drawing.
  var TRAVELLER_TIP_INPUTS = [["drawOn", 100]];
  // Callouts: label box edge, optional elbow bend, and a two-line draw-on (label -> bend -> place).
  // All three share one input list so the helpers can be wired identically.
  var CALLOUT_GEOM_INPUTS = [["placeX", 0], ["placeY", 0], ["boxX", 0], ["boxY", 0], ["boxW", 0], ["boxH", 0], ["style", 1], ["elbow", 40]];
  var CALLOUT_DRAW_INPUTS = CALLOUT_GEOM_INPUTS.concat([["draw", 100], ["index", 0]]);
  // Expects the prelude's _i0.._i7 (place xy, box centre xy, box size, style, elbow); defines _cs (side), _ce (edge), _cb (bend).
  var CALLOUT_GEOM_SRC = "var _cs = _i0 < _i2 ? -1 : 1;\n" +
    "var _ce = [_i2 + _cs * _i4 / 2, _i3];\n" +
    "var _cb = _i6 >= 0.5 ? [_ce[0] + _cs * _i7, _ce[1]] : _ce;\n";
  function calloutEdgeExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(CALLOUT_GEOM_INPUTS) + CALLOUT_GEOM_SRC + "_ce;\n";
  }
  function calloutBendExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(CALLOUT_GEOM_INPUTS) + CALLOUT_GEOM_SRC + "_cb;\n";
  }
  // Trim end (0-100) for line index: 0 = label to bend, 1 = bend to place; Draw % covers both lengths in order.
  function calloutDrawExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(CALLOUT_DRAW_INPUTS) + CALLOUT_GEOM_SRC +
      "var _cl1 = Math.sqrt(Math.pow(_cb[0] - _ce[0], 2) + Math.pow(_cb[1] - _ce[1], 2));\n" +
      "var _cl2 = Math.sqrt(Math.pow(_i0 - _cb[0], 2) + Math.pow(_i1 - _cb[1], 2));\n" +
      "var _cd = Math.max(0, Math.min(100, _i8));\n" +
      "var _ct = _cd / 100 * (_cl1 + _cl2);\n" +
      "(_cl1 + _cl2 <= 1e-9) ? _cd : (_i9 < 0.5\n" +
      "  ? (_cl1 > 1e-9 ? Math.max(0, Math.min(1, _ct / _cl1)) * 100 : 100)\n" +
      "  : (_cl2 > 1e-9 ? Math.max(0, Math.min(1, (_ct - _cl1) / _cl2)) * 100 : (_i8 >= 100 ? 100 : 0)));\n";
  }

  function travellerTipExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(TRAVELLER_TIP_INPUTS) + "Math.max(0, Math.min(_i0, 99.9));\n";
  }
  // The copy's own size: the user's Traveller size times the source layer's scale (a Duplicator
  // copies geometry but ignores the source layer's own scale), as the [x, y] the copies take.
  var TRAVELLER_SCALE_INPUTS = [["size", 1], ["sourceScaleX", 1], ["sourceScaleY", 1]];
  function travellerScaleExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(TRAVELLER_SCALE_INPUTS) + "[_i0 * _i1, _i0 * _i2];\n";
  }
  function travellerShowInputs(laterCount) {
    var inputs = [["drawOn", 100], ["legOpacity", 100]];
    for (var k = 1; k <= laterCount; k++) inputs.push(["later" + k, 0]);
    return inputs;
  }
  function travellerShowExpression(meta, laterCount) {
    var cond = "_i0 > 0";
    for (var k = 0; k < laterCount; k++) cond += " && _i" + (k + 2) + " <= 0";
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(travellerShowInputs(laterCount)) + "((" + cond + ") ? _i1 : 0);\n";
  }

  var CAMERA_FIVE = MAP_INPUTS.slice(0, 5);
  var SCALE_BAR_INPUTS = CAMERA_FIVE.concat([["compW", 1920], ["compH", 1080], ["units", 0], ["style", 0], ["corner", 2], ["margin", 40], ["maxWidth", 200], ["raise", 0], ["textSize", 16]]);
  var NORTH_ARROW_INPUTS = CAMERA_FIVE.concat([["compW", 1920], ["compH", 1080], ["style", 0], ["corner", 1], ["margin", 40], ["size", 40]]);
  var FURNITURE_FADE_INPUTS = [["zoom", 2], ["hideBelow", 3]];
  function scaleBarExpression(src, meta) {
    return writeTag("GEO_META", meta) + "\n" + src + "\n;\n" + inputPrelude(SCALE_BAR_INPUTS) +
      "GeoFurniture.scaleBar({lat: _i0, lon: _i1, zoom: _i2, rotation: _i3, projection: _i4, compW: _i5, compH: _i6, units: _i7, style: _i8, corner: _i9, margin: _i10, maxWidth: _i11, raise: _i12, textSize: _i13}, cavalry);\n";
  }
  function northArrowExpression(src, meta) {
    return writeTag("GEO_META", meta) + "\n" + src + "\n;\n" + inputPrelude(NORTH_ARROW_INPUTS) +
      "GeoFurniture.northArrow({lat: _i0, lon: _i1, zoom: _i2, rotation: _i3, projection: _i4, compW: _i5, compH: _i6, style: _i7, corner: _i8, margin: _i9, size: _i10}, cavalry);\n";
  }
  // Same formula as GeoFurniture.fade (a unit test keeps them equal); no projection maths needed.
  function furnitureFadeExpression(meta) {
    return writeTag("GEO_META", meta) + "\n" + inputPrelude(FURNITURE_FADE_INPUTS) + "Math.max(0, Math.min(1, (_i0 - (_i1 - 0.5)) / 0.5)) * 100;\n";
  }

  return {
    SCALE_BAR_INPUTS: SCALE_BAR_INPUTS, NORTH_ARROW_INPUTS: NORTH_ARROW_INPUTS, FURNITURE_FADE_INPUTS: FURNITURE_FADE_INPUTS,
    scaleBarExpression: scaleBarExpression, northArrowExpression: northArrowExpression, furnitureFadeExpression: furnitureFadeExpression,
    CAMERA_INPUTS: CAMERA_INPUTS, MAP_INPUTS: MAP_INPUTS, ROUTE_INPUTS: ROUTE_INPUTS, LABEL_INPUTS: LABEL_INPUTS,
    REGION_INPUTS: REGION_INPUTS, BUBBLE_INPUTS: BUBBLE_INPUTS, VALUE_LABEL_INPUTS: VALUE_LABEL_INPUTS,
    LEGEND_INPUTS: LEGEND_INPUTS, BUBBLE_LEGEND_INPUTS: BUBBLE_LEGEND_INPUTS, IMAGERY_INPUTS: IMAGERY_INPUTS,
    END_POINT_INPUTS: END_POINT_INPUTS, HANDLE_INPUTS: HANDLE_INPUTS, FADE_INPUTS: FADE_INPUTS, TRAVELLER_TIP_INPUTS: TRAVELLER_TIP_INPUTS, TRAVELLER_SCALE_INPUTS: TRAVELLER_SCALE_INPUTS, inputIndex: inputIndex,
    HIGHLIGHT_SHAPE_INPUTS: HIGHLIGHT_SHAPE_INPUTS, HIGHLIGHT_FADE_INPUTS: HIGHLIGHT_FADE_INPUTS,
    highlightLayerExpression: highlightLayerExpression, highlightFadeExpression: highlightFadeExpression,
    writeTag: writeTag, readTag: readTag, mapLayerExpression: mapLayerExpression, routeLayerExpression: routeLayerExpression, readData: readData,
    cameraExpression: cameraExpression, labelDriverExpression: labelDriverExpression,
    labelVisibilityExpression: labelVisibilityExpression, imageryRotationExpression: imageryRotationExpression, imageryLevelExpression: imageryLevelExpression,
    routeEndPointExpression: routeEndPointExpression, routeHandleExpression: routeHandleExpression, routeFadeExpression: routeFadeExpression, ROUTE_DRAW_INPUTS: ROUTE_DRAW_INPUTS, routeDrawExpression: routeDrawExpression,
    CALLOUT_GEOM_INPUTS: CALLOUT_GEOM_INPUTS, CALLOUT_DRAW_INPUTS: CALLOUT_DRAW_INPUTS, calloutEdgeExpression: calloutEdgeExpression, calloutBendExpression: calloutBendExpression, calloutDrawExpression: calloutDrawExpression,
    travellerTipExpression: travellerTipExpression, travellerScaleExpression: travellerScaleExpression, travellerShowInputs: travellerShowInputs, travellerShowExpression: travellerShowExpression,
    regionsExpression: regionsExpression, bubblesExpression: bubblesExpression, valueLabelsExpression: valueLabelsExpression,
    legendExpression: legendExpression, bubbleLegendExpression: bubbleLegendExpression, replaceData: replaceData
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoExpression;
