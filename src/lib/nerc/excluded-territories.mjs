// Back-compat re-exports — prefer geography-scope.mjs for new code.
export {
  EXCLUDED_TERRITORY_CODES,
  EXCLUDED_TERRITORY_FIPS,
  isExcludedTerritoryCode,
  isExcludedTerritoryFips,
} from "./geography-scope.mjs";
