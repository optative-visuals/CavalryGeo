// Bézier handles for a route leg between two stops on screen. Pure: it also runs inside the
// legs' handle helpers (inlined as GEO_CURVE_SRC). Handles are relative to their own stop, as
// Cavalry's Bézier line offsets are. Arc height keeps the old lift meaning: 100 % puts the
// middle of the curve half the leg's length away from the straight line.
var GeoCurve = (function () {
  function clamp(v, lo, hi) { v = Number(v) || 0; return Math.max(lo, Math.min(hi, v)); }

  // opts: { arc: 0..100, lean: -100..100 (positive = towards the end stop), flip: truthy = other side }
  function handles(p0, p1, opts) {
    opts = opts || {};
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return { start: [0, 0], end: [0, 0] };
    var nx = -dy / len, ny = dx / len; // 90° anticlockwise of travel
    if (opts.flip) { nx = -nx; ny = -ny; }
    // Both handles pushed out by c put the curve's middle 0.75 c out.
    var c = clamp(opts.arc, 0, 100) / 100 * 0.5 * len / 0.75, s = clamp(opts.lean, -100, 100) / 100;
    var a = (1 + s) / 3, b = (1 - s) / 3;
    return { start: [dx * a + nx * c, dy * a + ny * c], end: [-dx * b + nx * c, -dy * b + ny * c] };
  }

  return { handles: handles };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoCurve;
