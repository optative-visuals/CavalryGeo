// Matches data rows to Natural Earth countries by ISO code or (normalised) name. Pure.
var GeoMatch = (function () {
  function normalize(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    t = t.replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ");
    t = (" " + t + " ").replace(/ the /g, " ").replace(/ republic of /g, " ");
    return t.replace(/\s+/g, " ").trim();
  }

  var NAME_ALIASES = {
    "usa": "USA", "us": "USA", "united states": "USA", "united states of america": "USA", "america": "USA",
    "uk": "GBR", "united kingdom": "GBR", "great britain": "GBR", "britain": "GBR",
    "russia": "RUS", "russian federation": "RUS", "czechia": "CZE", "czech republic": "CZE",
    "cote d ivoire": "CIV", "ivory coast": "CIV",
    "south korea": "KOR", "korea rep": "KOR", "korea": "KOR",
    "north korea": "PRK", "korea dem people s rep": "PRK", "korea dem rep": "PRK",
    "iran": "IRN", "iran islamic rep": "IRN", "syria": "SYR", "syrian arab": "SYR",
    "vietnam": "VNM", "viet nam": "VNM", "laos": "LAO", "lao pdr": "LAO", "bolivia": "BOL",
    "venezuela": "VEN", "venezuela rb": "VEN", "tanzania": "TZA",
    "congo": "COG", "congo rep": "COG", "congo brazzaville": "COG",
    "dr congo": "COD", "democratic congo": "COD", "congo dem rep": "COD", "congo kinshasa": "COD",
    "eswatini": "SWZ", "swaziland": "SWZ", "myanmar": "MMR", "burma": "MMR",
    "turkiye": "TUR", "turkey": "TUR", "kosovo": "KOS", "egypt arab rep": "EGY", "yemen rep": "YEM",
    "kyrgyz": "KGZ", "slovak": "SVK", "micronesia fed sts": "FSM", "hong kong sar china": "HKG",
    "macao sar china": "MAC", "gambia": "GMB", "bahamas": "BHS", "cabo verde": "CPV", "cape verde": "CPV",
    "timor leste": "TLS", "east timor": "TLS", "north macedonia": "MKD", "macedonia": "MKD",
    "palestine": "PSE", "west bank and gaza": "PSE", "brunei darussalam": "BRN", "st lucia": "LCA",
    "st kitts and nevis": "KNA", "st vincent and grenadines": "VCT", "sao tome and principe": "STP"
  };
  var CODE_ALIASES = { "OWID_KOS": "KOS" };

  function buildIndex(props) {
    var idx = { iso3: {}, iso2: {}, name: {} };
    (props || []).forEach(function (p, i) {
      if (!p) return;
      if (p.iso3 && !(p.iso3 in idx.iso3)) idx.iso3[p.iso3] = i;
      if (p.iso2 && !(p.iso2 in idx.iso2)) idx.iso2[p.iso2] = i;
      (p.names || []).forEach(function (n) { var k = normalize(n); if (k && !(k in idx.name)) idx.name[k] = i; });
    });
    return idx;
  }

  function byName(idx, name) {
    var k = normalize(name);
    if (!k) return -1;
    if (k in idx.name) return idx.name[k];
    var iso = NAME_ALIASES[k];
    return iso && iso in idx.iso3 ? idx.iso3[iso] : -1;
  }

  // key: the place column value; kind: "iso3" | "iso2" | "name"; label: the row's name (optional fallback).
  function findCountry(idx, key, kind, label) {
    var k = String(key == null ? "" : key).trim();
    if (kind === "iso3" || kind === "iso2") {
      var up = k.toUpperCase(), table = kind === "iso3" ? idx.iso3 : idx.iso2;
      if (up && up in table) return table[up];
      if (CODE_ALIASES[up] && CODE_ALIASES[up] in idx.iso3) return idx.iso3[CODE_ALIASES[up]];
      return label ? byName(idx, label) : -1;
    }
    return byName(idx, k);
  }

  return { normalize: normalize, buildIndex: buildIndex, findCountry: findCountry };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoMatch;
