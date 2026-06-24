#!/usr/bin/env node
// QA pipeline for the enriched org dataset. Hard failures exit non-zero; soft
// findings print as warnings for the manual review queue.
//
// Usage:  node scripts/nerc/qa.mjs [public/nerc/orgs.json]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isCoordInScope,
  isExcludedTerritoryCode,
  isInsetStateCoordConsistent,
  isOutOfFootprintCode,
  isUsInsetState,
  US_INSET_STATE_CODES,
} from "../../src/lib/nerc/geography-scope.mjs";
import { orgWeight, roleSetColor, isPrivate, validateLocations } from "../../src/lib/nerc/enrich.mjs";
import { validateAreaAliases, validateAreaInterfaces } from "../../src/lib/nerc/area-aliases.mjs";
import { CURRENT_REGIONAL_ENTITIES } from "../../src/lib/nerc/roles.mjs";

const file = resolve(process.argv[2] || "public/nerc/orgs.json");
const data = JSON.parse(readFileSync(file, "utf8"));
const orgs = Array.isArray(data) ? data : data.orgs;

const errors = [];
const warnings = [];
const COLOR_RE = /^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/;
const isSupplemental = (o) => o.nerc_registered === false;
const isTerritoryInset = (o) => o.out_of_footprint === true;
const validRegions = new Set(CURRENT_REGIONAL_ENTITIES);
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI",
]);
const CA_PROVINCE_CODES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);
const MX_STATE_CODES = new Set(["BC"]); // Baja California cross-border NERC generation.

// 1. Every projected record has non-null coordinates. Territory inset records
// are placed schematically by the renderer instead of by lat/lng.
const nullCoords = orgs.filter((o) => (o.lat == null || o.lng == null) && !isTerritoryInset(o));
if (nullCoords.length) errors.push(`${nullCoords.length} records with null lat/lng`);

// 2. Coordinates inside the map's geographic scope (mainland, AK/HI insets, PR/VI).
for (const o of orgs) {
  if (o.lat == null || o.lng == null) continue;
  if (!isCoordInScope(o.lat, o.lng, o.state, { outOfFootprint: isTerritoryInset(o) })) {
    warnings.push(`out-of-range coords: ${o.ncr_id} ${o.entity_name} (${o.lat}, ${o.lng})`);
  }
}

// 2b. Country/state combinations must be internally consistent. This catches
// cross-border rows accidentally tagged US and alternate locations inheriting
// a parent org's country when their own state is in a different country.
function validCountryState(country, state) {
  const c = String(country || "").toUpperCase();
  const s = String(state || "").toUpperCase();
  if (c === "US") return US_STATE_CODES.has(s);
  if (c === "CA") return CA_PROVINCE_CODES.has(s);
  if (c === "MX") return MX_STATE_CODES.has(s);
  return false;
}

for (const o of orgs) {
  if (!validCountryState(o.country, o.state)) {
    errors.push(`country/state mismatch: ${o.ncr_id} country=${o.country} state=${o.state}`);
  }
  for (const loc of o.locations ?? []) {
    const populated =
      loc.lat != null ||
      loc.lng != null ||
      loc.city != null ||
      loc.state != null ||
      loc.country != null ||
      loc.headquarters_address != null;
    if (!populated) continue;
    if (!validCountryState(loc.country, loc.state)) {
      errors.push(`location country/state mismatch: ${o.ncr_id} rank ${loc.rank} country=${loc.country} state=${loc.state}`);
    }
  }
}

// 3. HIGH confidence requires a source URL.
for (const o of orgs) {
  if (o.geo_confidence === "HIGH" && !o.geo_source_url) {
    warnings.push(`HIGH confidence but no source_url: ${o.ncr_id} ${o.entity_name}`);
  }
}

// 4. Duplicate NCR IDs.
const idCounts = {};
for (const o of orgs) idCounts[o.ncr_id] = (idCounts[o.ncr_id] ?? 0) + 1;
const dupIds = Object.entries(idCounts).filter(([, n]) => n > 1);
if (dupIds.length) errors.push(`duplicate NCR IDs: ${dupIds.map(([id]) => id).join(", ")}`);

// 5. Duplicate (lat,lng) pairs (review, not fatal).
const coordCounts = {};
for (const o of orgs) {
  if (o.lat == null) continue;
  const key = `${o.lat},${o.lng}`;
  (coordCounts[key] ||= []).push(o.ncr_id);
}
for (const [key, ids] of Object.entries(coordCounts)) {
  if (ids.length > 1) warnings.push(`shared coordinate ${key}: ${ids.join(", ")}`);
}

// 6. role_count === roles.length.
for (const o of orgs) {
  if (o.role_count !== o.roles.length) errors.push(`role_count mismatch: ${o.ncr_id} (${o.role_count} vs ${o.roles.length})`);
}

// 7. is_private logic recomputes correctly.
for (const o of orgs) {
  if (o.is_private !== isPrivate(o.roles)) errors.push(`is_private mismatch: ${o.ncr_id} ${o.entity_name}`);
}

// 8. weight > 0 and recomputes for NERC records; supplemental records use
// explicit type-based display weight/color because their roles are approximate.
for (const o of orgs) {
  if (!(o.weight > 0)) errors.push(`weight not > 0: ${o.ncr_id}`);
  if (!isSupplemental(o) && o.weight !== orgWeight(o.roles)) {
    errors.push(`weight mismatch: ${o.ncr_id} (${o.weight} vs ${orgWeight(o.roles)})`);
  }
  if (!COLOR_RE.test(o.color || "")) errors.push(`bad color string: ${o.ncr_id} "${o.color}"`);
}

// 9. is_iso_rto=true implies weight >= 35.
for (const o of orgs) {
  if (o.is_iso_rto && o.weight < 35) errors.push(`is_iso_rto but weight < 35: ${o.ncr_id}`);
}

// 10. Color uniqueness: identical sorted role sets must share one color.
const byRoleSet = {};
for (const o of orgs) {
  if (isSupplemental(o)) continue;
  const key = [...o.roles].sort().join("+") || "(none)";
  (byRoleSet[key] ||= new Set()).add(o.color);
}
for (const [key, colors] of Object.entries(byRoleSet)) {
  if (colors.size > 1) errors.push(`role set [${key}] maps to ${colors.size} colors: ${[...colors].join(", ")}`);
}
// Spot-check the centroid invariant directly.
for (const [key] of Object.entries(byRoleSet)) {
  if (key === "(none)") continue;
  const roles = key.split("+");
  const expected = roleSetColor(roles);
  const sample = orgs.find((o) => [...o.roles].sort().join("+") === key);
  if (sample && sample.color !== expected) errors.push(`color drift for [${key}]: stored ${sample.color} vs computed ${expected}`);
}

// 11. Confidence distribution; ESTIMATED should be < 30%.
const conf = {};
for (const o of orgs) conf[o.geo_confidence] = (conf[o.geo_confidence] ?? 0) + 1;
const estPct = ((conf.ESTIMATED ?? 0) / orgs.length) * 100;
if (estPct >= 30) warnings.push(`ESTIMATED is ${estPct.toFixed(1)}% (>= 30%); agent may be under-searching`);

// 12. Regional Entity assignment must use current NERC Regional Entities.
for (const o of orgs) {
  if (o.region != null && !validRegions.has(o.region)) {
    errors.push(`invalid Regional Entity: ${o.ncr_id} ${o.entity_name} region="${o.region}"`);
  }
  for (const r of o.regions ?? []) {
    if (!validRegions.has(r)) {
      errors.push(`invalid Regional Entity: ${o.ncr_id} ${o.entity_name} regions includes "${r}"`);
    }
  }
}

// 12b. Geographic scope — AK/HI insets, PR/VI offshore insets, excluded territories.
for (const o of orgs) {
  const state = o.state ?? "";
  if (isExcludedTerritoryCode(state)) {
    errors.push(`excluded territory in output: ${o.ncr_id} ${state}`);
  }
  if (o.out_of_footprint !== isOutOfFootprintCode(state)) {
    errors.push(`out_of_footprint mismatch: ${o.ncr_id} state=${state} flag=${!!o.out_of_footprint}`);
  }
  if (o.out_of_footprint && isUsInsetState(state)) {
    errors.push(`AK/HI must not be out_of_footprint: ${o.ncr_id} ${o.entity_name}`);
  }
  if (o.lat != null && o.lng != null && !isTerritoryInset(o) && isUsInsetState(state)) {
    if (!isInsetStateCoordConsistent(state, o.lat, o.lng)) {
      warnings.push(`AK/HI coords outside state bbox: ${o.ncr_id} ${o.entity_name} (${o.lat}, ${o.lng})`);
    }
  }
  if (o.lat != null && o.lng != null && !isTerritoryInset(o) && state && !isUsInsetState(state) && !isOutOfFootprintCode(state)) {
    for (const inset of US_INSET_STATE_CODES) {
      if (isInsetStateCoordConsistent(inset, o.lat, o.lng)) {
        warnings.push(`mainland org coords in ${inset} bbox: ${o.ncr_id} state=${state} (${o.lat}, ${o.lng})`);
        break;
      }
    }
  }
}

// 12c. Hawaii inventory — supplemental-only; no accidental mainland mapping.
const EXPECTED_HI_SUPPLEMENTAL = 21;
const hiOrgs = orgs.filter((o) => o.state === "HI");
const geocodedHi = orgs.filter((o) => o.state === "HI" && o.nerc_registered !== false);
if (hiOrgs.length !== EXPECTED_HI_SUPPLEMENTAL) {
  errors.push(`Hawaii supplemental count ${hiOrgs.length} (expected ${EXPECTED_HI_SUPPLEMENTAL})`);
}
if (geocodedHi.length > 0) {
  errors.push(`NERC-registered Hawaii rows in output: ${geocodedHi.map((o) => o.ncr_id).join(", ")}`);
}
for (const o of hiOrgs) {
  if (!isSupplemental(o)) errors.push(`Hawaii org must be supplemental: ${o.ncr_id} ${o.entity_name}`);
  if (o.out_of_footprint) errors.push(`Hawaii must not be out_of_footprint: ${o.ncr_id}`);
}

// 13. Map combines: absorbed member ids must not appear as standalone dots.
try {
  const combinePath = resolve(process.cwd(), "src/data/nerc/map-combines.json");
  const combineRaw = JSON.parse(readFileSync(combinePath, "utf8"));
  const present = new Set(orgs.map((o) => o.ncr_id));
  for (const group of combineRaw.combines ?? []) {
    if (!present.has(group.canonical)) {
      warnings.push(`map combine canonical missing from output: ${group.canonical}`);
      continue;
    }
    for (const id of group.members ?? []) {
      if (present.has(id)) errors.push(`map combine member still published separately: ${id}`);
    }
    const canonical = orgs.find((o) => o.ncr_id === group.canonical);
    if (canonical && !canonical.combined_members?.length) {
      errors.push(`map combine canonical missing combined_members: ${group.canonical}`);
    }
  }
} catch {
  // map-combines.json optional
}

// 14. Area aliases: unique codes, valid targets, no acronym conflicts.
for (const e of validateAreaAliases(orgs)) errors.push(e);

// 15. Area interfaces: non-org planning/interface codes excluded from the map.
for (const e of validateAreaInterfaces(orgs)) errors.push(e);

// 16. Locations: three-slot schema; rank 1 must match lat/lng.
const locCheck = validateLocations(orgs);
for (const e of locCheck.errors) errors.push(e);
for (const w of locCheck.warnings) warnings.push(w);

// Acceptance: >= 60% HIGH or MEDIUM.
const hiMed = ((conf.HIGH ?? 0) + (conf.MEDIUM ?? 0)) / orgs.length * 100;

console.log(`QA: ${orgs.length} records`);
console.log(`QA: confidence`, conf, `(HIGH+MEDIUM ${hiMed.toFixed(1)}%, ESTIMATED ${estPct.toFixed(1)}%)`);
if (hiMed < 60) warnings.push(`HIGH+MEDIUM is ${hiMed.toFixed(1)}% (< 60% acceptance target)`);

if (warnings.length) {
  console.log(`\nQA warnings (${warnings.length}) - manual review queue:`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (errors.length) {
  console.error(`\nQA FAILED (${errors.length} hard errors):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nQA passed: 0 hard errors, ${warnings.length} warnings.`);
