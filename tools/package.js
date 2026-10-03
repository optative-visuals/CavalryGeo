// Builds the plugin, then writes dist/CavalryGeo-v<version>.zip for a GitHub release.
// The zip unpacks straight into Cavalry's Scripts folder.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("./buildlib.js");
const { createZip } = require("./ziplib.js");

const version = require(path.join(ROOT, "package.json")).version;
const dist = path.join(ROOT, "dist");

execFileSync(process.execPath, [path.join(__dirname, "build.js")], { stdio: "inherit" });

const INSTALL = [
  "Cavalry Geo v" + version,
  "",
  "1. In Cavalry, choose Help > Show Scripts Folder.",
  "2. Drag CavalryGeo.js and the CavalryGeo_assets folder into that folder (straight in,",
  "   not inside another folder). Updating? Drag them in again and replace the existing files.",
  "3. Open Scripts > CavalryGeo. No restart needed.",
  "",
  "Tested on Windows; macOS has not been tested yet.",
  "",
  "Street data (c) OpenStreetMap contributors (ODbL). World data: Natural Earth (public domain).",
  "Cavalry Geo is free software under the GNU GPL v3 or later (see LICENSE.txt); it comes with ABSOLUTELY NO WARRANTY.",
  "Guide and source: https://github.com/optative-visuals/CavalryGeo",
  ""
].join("\r\n");

function collect(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) collect(full, name + "/", out);
    else out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

const files = [
  { name: "CavalryGeo.js", data: fs.readFileSync(path.join(dist, "CavalryGeo.js")) },
  ...collect(path.join(dist, "CavalryGeo_assets"), "CavalryGeo_assets/", []),
  { name: "LICENSE.txt", data: fs.readFileSync(path.join(ROOT, "LICENSE")) },
  { name: "INSTALL.txt", data: Buffer.from(INSTALL, "utf8") }
];
const zipPath = path.join(dist, "CavalryGeo-v" + version + ".zip");
fs.writeFileSync(zipPath, createZip(files));
console.log("Packaged " + files.length + " files -> " + zipPath + " (" + (fs.statSync(zipPath).size / 1e6).toFixed(1) + " MB)");
