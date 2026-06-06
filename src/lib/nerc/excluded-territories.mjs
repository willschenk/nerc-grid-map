// U.S. territories excluded from data, supplemental layer, and basemap (FIPS + postal).
export const EXCLUDED_TERRITORY_CODES = new Set(["GU", "AS", "MP"]);
export const EXCLUDED_TERRITORY_FIPS = new Set(["60", "66", "69"]);

export function isExcludedTerritoryCode(code) {
  return EXCLUDED_TERRITORY_CODES.has(String(code || "").toUpperCase());
}

export function isExcludedTerritoryFips(id) {
  return EXCLUDED_TERRITORY_FIPS.has(String(id));
}
