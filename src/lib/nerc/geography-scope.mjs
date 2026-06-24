// Geographic scope for the NERC grid map — single source of truth.
//
// Coverage tiers:
//   1. Lower 48 + Canada context — NERC registry orgs + mainland supplemental orgs.
//   2. Alaska & Hawaii — supplemental utilities only (not in the NERC extract);
//      geocoded normally and rendered on geoAlbersUsa's built-in AK/HI insets.
//      Same rules for both: state AK|HI, out_of_footprint false, real lat/lng.
//   3. Puerto Rico & U.S. Virgin Islands — supplemental only; `out_of_footprint`
//      schematic offshore insets (no mainland projection).
//   4. Guam, American Samoa, Northern Mariana Islands — excluded entirely.
//
// Known non-Alaska NERC registry rows with Alaska-adjacent names (mapped in the
// lower 48, not the AK inset): NCR13276 Bethel Wind Energy LLC (IA wind farm),
// NCR13073 Invenergy Services-Fairbanks (IN wind project).
//
// Hawaii: the NERC registry extract has zero HI rows. All 21 Hawaii dots are
// supplemental-only (`supplemental-orgs.json`, state HI, out_of_footprint false).
// Known mainland false positives when searching "Electric Light" or fuzzy-matching
// HELCO: NCR07086 Fitchburg Gas and Electric Light Company (MA, Unitil) — not
// Hawaii Electric Light Company (HELCO supplemental).

/** Fully excluded from data, supplemental layer, and basemap (postal + FIPS). */
export const EXCLUDED_TERRITORY_CODES = new Set(["GU", "AS", "MP"]);
export const EXCLUDED_TERRITORY_FIPS = new Set(["60", "66", "69"]);

/** Carried as supplemental orgs in labelled offshore insets — not lat/lng on the mainland. */
export const OUT_OF_FOOTPRINT_CODES = new Set(["PR", "VI"]);

/** Projectable on geoAlbersUsa native insets; geocode with real lat/lng; never out_of_footprint. */
export const US_INSET_STATE_CODES = new Set(["AK", "HI"]);

/** Approximate HQ bounding boxes for QA (decimal degrees). */
export const STATE_COORD_BBOX = {
  AK: { minLat: 51.0, maxLat: 71.5, minLng: -179.0, maxLng: -130.0 },
  HI: { minLat: 18.5, maxLat: 22.5, minLng: -160.5, maxLng: -154.0 },
};

/** Out-of-footprint territory coords (real lat/lng stored; renderer uses schematic insets). */
export const OUT_OF_FOOTPRINT_COORD_BBOX = {
  PR: { minLat: 17.5, maxLat: 18.6, minLng: -67.5, maxLng: -65.0 },
  VI: { minLat: 17.6, maxLat: 18.5, minLng: -65.1, maxLng: -64.5 },
};

/** Lower-48 + Canada context envelope used by QA (excludes AK/HI/PR/VI lat bands). */
export const MAINLAND_MAP_BBOX = {
  minLat: 24,
  maxLat: 72,
  minLng: -180,
  maxLng: -50,
};

export function isExcludedTerritoryCode(code) {
  return EXCLUDED_TERRITORY_CODES.has(String(code || "").toUpperCase());
}

export function isExcludedTerritoryFips(id) {
  return EXCLUDED_TERRITORY_FIPS.has(String(id));
}

export function isOutOfFootprintCode(code) {
  return OUT_OF_FOOTPRINT_CODES.has(String(code || "").toUpperCase());
}

export function isUsInsetState(code) {
  return US_INSET_STATE_CODES.has(String(code || "").toUpperCase());
}

export function coordsInBbox(lat, lng, bbox) {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/** True when published lat/lng plausibly matches the org's state (AK/HI only). */
export function isInsetStateCoordConsistent(state, lat, lng) {
  const code = String(state || "").toUpperCase();
  const bbox = STATE_COORD_BBOX[code];
  if (!bbox || lat == null || lng == null) return true;
  return coordsInBbox(lat, lng, bbox);
}

/**
 * Whether lat/lng is plausible for an org on this map. Used by QA and location
 * validation — replaces a naive lat >= 24 check that falsely rejects Hawaii.
 */
export function isCoordInScope(lat, lng, state, options = {}) {
  if (lat == null || lng == null) return true;
  const code = String(state || "").toUpperCase();
  const outOfFootprint = options.outOfFootprint === true;

  if (isExcludedTerritoryCode(code)) return false;

  if (isUsInsetState(code)) {
    const bbox = STATE_COORD_BBOX[code];
    return bbox ? coordsInBbox(lat, lng, bbox) : true;
  }

  if (isOutOfFootprintCode(code) || outOfFootprint) {
    const bbox = OUT_OF_FOOTPRINT_COORD_BBOX[code];
    if (bbox) return coordsInBbox(lat, lng, bbox);
    // Territory record without state — accept Caribbean band.
    return lat >= 17 && lat <= 19 && lng >= -68 && lng <= -64;
  }

  // Mainland US + Canadian context on the composite map.
  return coordsInBbox(lat, lng, MAINLAND_MAP_BBOX);
}
