// Writes dist/CavalryGeo.js and dist/CavalryGeo_assets/ (ne/ and icons/).
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, buildPanel, copyDirSync } = require("./buildlib.js");

const dist = path.join(ROOT, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "CavalryGeo_assets"), { recursive: true });
fs.writeFileSync(path.join(dist, "CavalryGeo.js"), buildPanel());
copyDirSync(path.join(ROOT, "assets", "ne"), path.join(dist, "CavalryGeo_assets", "ne"));
copyDirSync(path.join(ROOT, "assets", "icons"), path.join(dist, "CavalryGeo_assets", "icons"));
console.log("Built " + path.join(dist, "CavalryGeo.js"));
