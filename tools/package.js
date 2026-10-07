// Builds the plugin, then writes dist/CavalryGeo-v<version>.zip for a GitHub release.
// The zip unpacks straight into Cavalry's Scripts folder.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("./buildlib.js");
const { createZip } = require("./ziplib.js");

function installText(version) {
  return [
  "Cavalry Geo v" + version,
  "",
  "1. In Cavalry, choose Help > Show Scripts Folder.",
  "2. Drag CavalryGeo.js and the CavalryGeo_assets folder into that folder (straight in,",
  "   not inside another folder).",
  "   Updating? Replace CavalryGeo.js, and merge the new CavalryGeo_assets folder into the old one. On a Mac, hold Option while dragging and choose Merge: Replace would delete your settings (keys, saved styles) and downloads.",
  "3. Open Scripts > CavalryGeo. No restart needed.",
  "4. Imagery on the globe or Equal Earth? Drag the CavalryGeo_plugin folder anywhere into the Cavalry window once and confirm the install. Nothing else needs it.",
  "",
  "Tested on Windows and macOS.",
  "",
  "Street data (c) OpenStreetMap contributors (ODbL). World data: Natural Earth (public domain).",
  "Cavalry Geo is free software under the GNU GPL v3 or later (see LICENSE.txt); it comes with ABSOLUTELY NO WARRANTY.",
  "Guide and source: https://github.com/optative-visuals/CavalryGeo",
  ""
].join("\r\n");
}

function collect(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) collect(full, name + "/", out);
    else out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

function packageFiles(dist, version) {
  return [
    { name: "CavalryGeo.js", data: fs.readFileSync(path.join(dist, "CavalryGeo.js")) },
    ...collect(path.join(dist, "CavalryGeo_assets"), "CavalryGeo_assets/", []),
    ...collect(path.join(dist, "CavalryGeo_plugin"), "CavalryGeo_plugin/", []),
    { name: "LICENSE.txt", data: fs.readFileSync(path.join(ROOT, "LICENSE")) },
    { name: "INSTALL.txt", data: Buffer.from(installText(version), "utf8") }
  ];
}

if (require.main === module) {
  const version = require(path.join(ROOT, "package.json")).version;
  const dist = path.join(ROOT, "dist");
  execFileSync(process.execPath, [path.join(__dirname, "build.js")], { stdio: "inherit" });
  const files = packageFiles(dist, version);
  const zipPath = path.join(dist, "CavalryGeo-v" + version + ".zip");
  fs.writeFileSync(zipPath, createZip(files));
  console.log("Packaged " + files.length + " files -> " + zipPath + " (" + (fs.statSync(zipPath).size / 1e6).toFixed(1) + " MB)");
} else {
  module.exports = { packageFiles, installText };
}
