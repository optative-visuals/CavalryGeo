// Compact layer encoding: quantised, delta-encoded rings, features sorted by importance.
var GeoCodec = (function () {
  var Q = 1e6; // must match GeoRuntime.Q

  function encodeRing(ring) {
    var out = [], px = 0, py = 0;
    for (var i = 0; i < ring.length; i++) {
      var x = Math.round(ring[i][0] * Q), y = Math.round(ring[i][1] * Q);
      out.push(x - px, y - py);
      px = x; py = y;
    }
    return out;
  }

  function decodeRing(ints) {
    var out = [], x = 0, y = 0;
    for (var i = 0; i < ints.length; i += 2) { x += ints[i]; y += ints[i + 1]; out.push([x / Q, y / Q]); }
    return out;
  }

  function encodeLayer(layer) {
    var items = layer.features.map(function (f, i) { return { f: f, i: i }; });
    items.sort(function (a, b) { return (b.f.rank - a.f.rank) || (a.i - b.i); });
    var out = {
      v: 1,
      kind: layer.kind,
      f: items.map(function (it) { return [it.f.name || ""].concat(it.f.rings.map(encodeRing)); })
    };
    if (layer.features.some(function (f) { return f.props; })) out.p = items.map(function (it) { return it.f.props || null; });
    return out;
  }

  function decodeLayer(enc) {
    return {
      kind: enc.kind,
      features: enc.f.map(function (row, i) {
        var f = { name: row[0], rings: row.slice(1).map(decodeRing) };
        if (enc.p) f.props = enc.p[i];
        return f;
      })
    };
  }

  function subset(enc, indices) {
    var out = { v: enc.v, kind: enc.kind, f: indices.map(function (i) { return enc.f[i]; }) };
    if (enc.p) out.p = indices.map(function (i) { return enc.p[i]; });
    return out;
  }

  // Named features matching query, grouped by name, in importance order.
  function findByName(enc, query) {
    var q = String(query || "").toLowerCase(), groups = [], byName = {};
    for (var i = 0; i < enc.f.length; i++) {
      var name = enc.f[i][0];
      if (!name || name.toLowerCase().indexOf(q) < 0) continue;
      if (!byName[name]) { byName[name] = { name: name, indices: [] }; groups.push(byName[name]); }
      byName[name].indices.push(i);
    }
    return groups;
  }

  return { Q: Q, encodeRing: encodeRing, decodeRing: decodeRing, encodeLayer: encodeLayer, decodeLayer: decodeLayer, subset: subset, findByName: findByName };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoCodec;
