// Copies dist/ into Cavalry's user Scripts folder. Leaves the download cache alone.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, copyDirSync } = require("./buildlib.js");

if (!process.env.APPDATA) throw new Error("APPDATA is not set; this installer targets Windows.");
const scripts = path.join(process.env.APPDATA, "Cavalry", "Scripts");
if (!fs.existsSync(scripts)) throw new Error("Cavalry Scripts folder not found: " + scripts);
fs.copyFileSync(path.join(ROOT, "dist", "CavalryGeo.js"), path.join(scripts, "CavalryGeo.js"));
// Whole folders, so nothing new in the assets or the plugin has to be listed here.
copyDirSync(path.join(ROOT, "dist", "CavalryGeo_assets"), path.join(scripts, "CavalryGeo_assets"));
copyDirSync(path.join(ROOT, "dist", "CavalryGeo_plugin"), path.join(scripts, "CavalryGeo_plugin"));
console.log("Installed to " + scripts);
