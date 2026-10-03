// Downloads Natural Earth (public domain) 110m + 50m GeoJSON and writes encoded layers to assets/ne/.
const fs = require("node:fs");
const path = require("node:path");
const GeoNE = require("../src/core/naturalearth.js");
const GeoCodec = require("../src/core/codec.js");

const ROOT = path.resolve(__dirname, "..");
const BUNDLED_SCALES = ["110m", "50m"];

async function main() {
  let total = 0;
  for (const scale of BUNDLED_SCALES) {
    for (const category of Object.keys(GeoNE.CATEGORIES)) {
      const url = "https://raw.githubusercontent.com" + GeoNE.sourcePath(category, scale);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const enc = GeoCodec.encodeLayer(GeoNE.fromGeoJSON(category, await res.json()));
      const json = JSON.stringify(enc);
      const out = path.join(ROOT, "assets", "ne", scale, category + ".json");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);
      total += json.length;
      console.log(`${scale} ${category}: ${enc.f.length} features, ${(json.length / 1e3).toFixed(0)} KB`);
    }
  }
  console.log(`Total bundled: ${(total / 1e6).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
