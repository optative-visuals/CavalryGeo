const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/core/match.js");

const props = [
  { iso3: "FRA", iso2: "FR", names: ["France", "French Republic"], label: [2.5, 46.7] },
  { iso3: "USA", iso2: "US", names: ["United States of America", "United States"], label: null },
  { iso3: "CIV", iso2: "CI", names: ["Côte d'Ivoire"], label: null },
  { iso3: "KOS", iso2: "XK", names: ["Kosovo"], label: null },
  { iso3: "COD", iso2: "CD", names: ["Dem. Rep. Congo", "Democratic Republic of the Congo"], label: null },
  { iso3: "BIH", iso2: "BA", names: ["Bosnia and Herz."], label: null }
];
const idx = M.buildIndex(props);

test("normalize: case, accents, &, punctuation, 'the', 'republic of'", () => {
  assert.equal(M.normalize("  Côte d'Ivoire "), "cote d ivoire");
  assert.equal(M.normalize("Bosnia & Herzegovina"), "bosnia and herzegovina");
  assert.equal(M.normalize("The Gambia"), "gambia");
});

test("codes: iso3, iso2 and OWID_KOS", () => {
  assert.equal(M.findCountry(idx, "FRA", "iso3"), 0);
  assert.equal(M.findCountry(idx, "fr", "iso2"), 0);
  assert.equal(M.findCountry(idx, "OWID_KOS", "iso3"), 3);
  assert.equal(M.findCountry(idx, "OWID_WRL", "iso3", "World"), -1);
});

test("names and aliases", () => {
  assert.equal(M.findCountry(idx, "France", "name"), 0);
  assert.equal(M.findCountry(idx, "USA", "name"), 1);
  assert.equal(M.findCountry(idx, "United States", "name"), 1);
  assert.equal(M.findCountry(idx, "Ivory Coast", "name"), 2);
  assert.equal(M.findCountry(idx, "Congo, Dem. Rep.", "name"), 4);
  assert.equal(M.findCountry(idx, "High income", "name"), -1);
});

test("a code column falls back to the row's name when the code is empty", () => {
  assert.equal(M.findCountry(idx, "", "iso3", "France"), 0);
});
