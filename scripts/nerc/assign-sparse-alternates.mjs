#!/usr/bin/env node
// Assign rank-2 alternate locations in sparse areas of each org's service territory,
// far from headquarters. Used when map declutter cannot place near rank 1.
//
// Usage: node scripts/nerc/assign-sparse-alternates.mjs [count=100]

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACES } from "../../src/lib/nerc/places.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const count = Math.max(1, parseInt(process.argv[2] || "100", 10));

/** Continental US + AK approx bounding boxes [minLat, maxLat, minLng, maxLng] */
const STATE_BBOX = {
  AL: [30.2, 35.0, -88.5, -84.9],
  AZ: [31.3, 37.0, -114.8, -109.0],
  AR: [33.0, 36.5, -94.6, -89.6],
  CA: [32.5, 42.0, -124.5, -114.1],
  CO: [37.0, 41.0, -109.1, -102.0],
  CT: [41.0, 42.1, -73.7, -71.8],
  DE: [38.4, 39.8, -75.8, -75.0],
  DC: [38.8, 39.0, -77.1, -76.9],
  FL: [24.5, 31.0, -87.6, -80.0],
  GA: [30.4, 35.0, -85.6, -80.8],
  ID: [42.0, 49.0, -117.2, -111.0],
  IL: [37.0, 42.5, -91.5, -87.5],
  IN: [37.8, 41.8, -88.1, -84.8],
  IA: [40.4, 43.5, -96.6, -90.1],
  KS: [37.0, 40.0, -102.1, -94.6],
  KY: [36.5, 39.2, -89.6, -81.9],
  LA: [29.0, 33.0, -94.0, -88.8],
  ME: [43.1, 47.5, -71.1, -66.9],
  MD: [37.9, 39.7, -79.5, -75.0],
  MA: [41.2, 42.9, -73.5, -69.9],
  MI: [41.7, 48.2, -90.4, -82.4],
  MN: [43.5, 49.4, -97.2, -89.5],
  MS: [30.2, 35.0, -91.7, -88.1],
  MO: [36.0, 40.6, -95.8, -89.1],
  MT: [45.0, 49.0, -116.1, -104.0],
  NE: [40.0, 43.0, -104.1, -95.3],
  NV: [35.0, 42.0, -120.0, -114.0],
  NH: [42.7, 45.3, -72.6, -70.6],
  NJ: [38.9, 41.4, -75.6, -73.9],
  NM: [31.3, 37.0, -109.1, -103.0],
  NY: [40.5, 45.0, -79.8, -71.9],
  NC: [33.8, 36.6, -84.3, -75.5],
  ND: [45.9, 49.0, -104.1, -96.6],
  OH: [38.4, 42.0, -84.8, -80.5],
  OK: [33.6, 37.0, -103.0, -94.4],
  OR: [42.0, 46.3, -124.6, -116.5],
  PA: [39.7, 42.3, -80.5, -74.7],
  RI: [41.1, 42.0, -71.9, -71.1],
  SC: [32.0, 35.2, -83.4, -78.5],
  SD: [42.5, 45.9, -104.1, -96.4],
  TN: [35.0, 36.7, -90.3, -81.6],
  TX: [25.8, 36.5, -106.6, -93.5],
  UT: [37.0, 42.0, -114.1, -109.0],
  VT: [42.7, 45.0, -73.4, -71.5],
  VA: [36.5, 39.5, -83.7, -75.2],
  WA: [45.5, 49.0, -124.8, -116.9],
  WV: [37.2, 40.6, -82.6, -77.7],
  WI: [42.5, 47.1, -92.9, -86.8],
  WY: [41.0, 45.0, -111.1, -104.0],
  AK: [51.0, 71.5, -179.0, -130.0],
  HI: [18.9, 22.3, -160.3, -154.8],
};

const ISO_TERRITORY = {
  PJM: ["PA", "NJ", "DE", "MD", "VA", "WV", "OH", "KY", "NC", "TN", "IN", "IL", "MI", "DC"],
  MISO: ["MN", "WI", "IA", "IL", "IN", "MI", "MO", "ND", "SD", "NE", "KS", "LA", "AR", "MS", "MT", "KY"],
  CAISO: ["CA"],
  SPP: ["KS", "OK", "NE", "NM", "AR", "LA", "MO", "ND", "SD", "MT", "WY", "CO"],
  ISONE: ["ME", "NH", "VT", "MA", "RI", "CT"],
  ERCOT: ["TX"],
  NYISO: ["NY"],
};

const REGION_STATES = {
  WECC: ["AZ", "CA", "CO", "ID", "MT", "NV", "NM", "OR", "UT", "WA", "WY"],
  MRO: ["MN", "WI", "IA", "IL", "IN", "MI", "MO", "ND", "SD", "NE", "KS", "OK", "AR", "LA", "MS", "MT"],
  SERC: ["AL", "GA", "FL", "MS", "TN", "NC", "SC", "VA", "KY", "MO", "LA"],
  RF: [
    "PA", "NJ", "DE", "MD", "VA", "WV", "OH", "KY", "NC", "TN", "IN", "IL", "MI", "WI", "MN", "IA",
    "MO", "ND", "SD", "NE", "KS", "OK", "AR", "LA", "MS", "MT", "DC",
  ],
  NPCC: ["NY", "ME", "NH", "VT", "MA", "RI", "CT"],
  "Texas RE": ["TX"],
};

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function orgId(org) {
  return org.ncr_id || `SUP-${slug(org.entity_name)}`;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

function stateAt(lat, lng) {
  for (const [st, [minLat, maxLat, minLng, maxLng]] of Object.entries(STATE_BBOX)) {
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) return st;
  }
  return null;
}

function inTerritory(lat, lng, states) {
  const st = stateAt(lat, lng);
  return st != null && states.includes(st);
}

function detectIsoTerritory(org) {
  const name = (org.entity_name || "").toUpperCase();
  if (/\bPJM\b/.test(name) || name.includes("PJM INTERCONNECTION")) return ISO_TERRITORY.PJM;
  if (/\bMISO\b/.test(name) || name.includes("MIDCONTINENT INDEPENDENT")) return ISO_TERRITORY.MISO;
  if (/\bCAISO\b/.test(name) || name.includes("CALIFORNIA INDEPENDENT SYSTEM")) return ISO_TERRITORY.CAISO;
  if (/\bSPP\b/.test(name) || name.includes("SOUTHWEST POWER POOL")) return ISO_TERRITORY.SPP;
  if (name.includes("ISO NEW ENGLAND") || name.includes("ISO-NE")) return ISO_TERRITORY.ISONE;
  if (/\bERCOT\b/.test(name)) return ISO_TERRITORY.ERCOT;
  if (/\bNYISO\b/.test(name) || name.includes("NEW YORK INDEPENDENT SYSTEM")) return ISO_TERRITORY.NYISO;
  return null;
}

function territoryStates(org) {
  const iso = detectIsoTerritory(org);
  if (iso) return iso;
  if (org.org_type === "ISO_RTO") {
    return REGION_STATES[org.region] || REGION_STATES.RF;
  }
  if (org.state && STATE_BBOX[org.state]) {
    return [org.state];
  }
  const regions = org.regions?.length ? org.regions : org.region ? [org.region] : [];
  const states = new Set();
  for (const r of regions) {
    for (const st of REGION_STATES[r] || []) states.add(st);
  }
  if (states.size) return [...states];
  return REGION_STATES.RF;
}

function buildDensityGrid(orgs) {
  const grid = new Map();
  for (const o of orgs) {
    if (o.lat == null || o.lng == null || o.out_of_footprint) continue;
    const key = `${Math.floor(o.lat * 2) / 2},${Math.floor(o.lng * 2) / 2}`;
    grid.set(key, (grid.get(key) || 0) + 1);
  }
  return grid;
}

function nearestPlace(lat, lng, preferState) {
  let best = null;
  let bestD = Infinity;
  const tryPlace = (filterState) => {
    for (const p of PLACES) {
      if (filterState && stateAt(p.lat, p.lng) !== filterState) continue;
      const d = haversineKm(lat, lng, p.lat, p.lng);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  };
  if (preferState) tryPlace(preferState);
  if (!best) tryPlace(null);
  return best;
}

function pickSparseLocation(org, grid, usedPoints, territory) {
  const minDistKm = org.org_type === "ISO_RTO" || org.ncr_id?.includes("SEED-00") ? 180 : 80;
  const candidates = [];

  const latMin = territory.some((s) => ["AK"].includes(s)) ? 51 : 24;
  const latMax = territory.some((s) => ["AK"].includes(s)) ? 71 : 49;
  const lngMin = territory.some((s) => ["AK"].includes(s)) ? -170 : -125;
  const lngMax = territory.some((s) => ["HI"].includes(s)) ? -154 : -66;

  for (let lat = latMin; lat <= latMax; lat += 0.5) {
    for (let lng = lngMin; lng <= lngMax; lng += 0.5) {
      if (!inTerritory(lat, lng, territory)) continue;
      if (lat < 24 || lat > 72 || lng < -180 || lng > -50) continue;

      const cellKey = `${Math.floor(lat * 2) / 2},${Math.floor(lng * 2) / 2}`;
      const density = grid.get(cellKey) || 0;
      const dHq = haversineKm(org.lat, org.lng, lat, lng);
      if (dHq < minDistKm) continue;

      let minUsed = Infinity;
      for (const p of usedPoints) {
        const d = haversineKm(p.lat, p.lng, lat, lng);
        if (d < minUsed) minUsed = d;
      }
      if (minUsed < 35) continue;

      candidates.push({ lat, lng, density, dHq, minUsed });
    }
  }

  candidates.sort(
    (a, b) => a.density - b.density || b.dHq - a.dHq || b.minUsed - a.minUsed,
  );
  return candidates[0] || null;
}

function priorityScore(org) {
  let s = 0;
  if (org.org_type === "ISO_RTO") s += 2000;
  if (org.ncr_id?.startsWith("NCR-SEED")) s += 1500;
  if (org.seed) s += 1000;
  s += (org.roles?.length || 0) * 20;
  if (detectIsoTerritory(org)) s += 800;
  return s;
}

function selectCandidates(all, limit) {
  return all
    .filter((o) => {
      const r2 = o.locations?.find((l) => l.rank === 2);
      return o.lat != null && o.lng != null && !o.out_of_footprint && !r2?.lat;
    })
    .sort((a, b) => priorityScore(b) - priorityScore(a) || a.entity_name.localeCompare(b.entity_name))
    .slice(0, limit);
}

function applySlot(org, slot) {
  const state = stateAt(slot.lat, slot.lng) || org.state || null;
  const place = nearestPlace(slot.lat, slot.lng, state);
  const placeState = place ? stateAt(place.lat, place.lng) : null;
  const dPlace = place ? haversineKm(slot.lat, slot.lng, place.lat, place.lng) : Infinity;
  const city = place && placeState === state && dPlace < 120 ? place.name : null;
  const territory = territoryStates(org);
  return {
    rank: 2,
    role: "alternate",
    lat: round4(slot.lat),
    lng: round4(slot.lng),
    headquarters_address: null,
    city,
    state,
    country: org.country || "US",
    geo_confidence: "LOW",
    geo_source: "sparse_territory_placement",
    geo_source_url: null,
    geo_notes:
      `Sparse map placement in ${territory.slice(0, 5).join("/")} service territory ` +
      `(cell density ${slot.density}, ${Math.round(slot.dHq)} km from HQ).` +
      (city ? ` Nearest reference: ${city}.` : " Rural area."),
  };
}

function applyToOrgs(orgs, assignments) {
  let n = 0;
  for (const org of orgs) {
    const id = orgId(org);
    const slot = assignments.get(id);
    if (!slot || !org.locations?.length) continue;
    const idx = org.locations.findIndex((l) => l.rank === 2);
    if (idx < 0) continue;
    org.locations[idx] = { ...org.locations[idx], ...slot };
    n++;
  }
  return n;
}

// --- main ---
const pubOrgs = JSON.parse(readFileSync(resolve(root, "public/nerc/orgs.json"), "utf8"));
const pubList = Array.isArray(pubOrgs) ? pubOrgs : pubOrgs.orgs;
const grid = buildDensityGrid(pubList);

const geoPath = resolve(root, "src/data/nerc/geocoded-orgs.json");
const supPath = resolve(root, "src/data/nerc/supplemental-orgs.json");
const geo = JSON.parse(readFileSync(geoPath, "utf8"));
const sup = JSON.parse(readFileSync(supPath, "utf8"));
const allSource = [...geo.orgs, ...sup];

// Clear prior sparse placements so re-runs are idempotent
function clearSparse(orgs) {
  for (const org of orgs) {
    const r2 = org.locations?.find((l) => l.rank === 2);
    if (r2?.geo_source === "sparse_territory_placement") {
      Object.assign(r2, {
        lat: null,
        lng: null,
        headquarters_address: null,
        city: null,
        state: null,
        country: null,
        geo_confidence: null,
        geo_source: null,
        geo_source_url: null,
        geo_notes: null,
      });
    }
  }
}
clearSparse(geo.orgs);
clearSparse(sup);

const picked = selectCandidates(allSource, count);
const assignments = new Map();
const usedPoints = [];

// Include existing rank-2 coords as occupied
for (const o of allSource) {
  const r2 = o.locations?.find((l) => l.rank === 2);
  if (r2?.lat != null) usedPoints.push({ lat: r2.lat, lng: r2.lng });
}

const failures = [];
for (const org of picked) {
  const territory = territoryStates(org);
  const loc = pickSparseLocation(org, grid, usedPoints, territory);
  if (!loc) {
    failures.push(orgId(org));
    continue;
  }
  const slot = applySlot(org, loc);
  assignments.set(orgId(org), slot);
  usedPoints.push({ lat: slot.lat, lng: slot.lng });
  // bump density so next org avoids same cell
  const key = `${Math.floor(slot.lat * 2) / 2},${Math.floor(slot.lng * 2) / 2}`;
  grid.set(key, (grid.get(key) || 0) + 1);
}

const geoN = applyToOrgs(geo.orgs, assignments);
const supN = applyToOrgs(sup, assignments);

writeFileSync(geoPath, JSON.stringify(geo, null, 2) + "\n");
writeFileSync(supPath, JSON.stringify(sup, null, 2) + "\n");

console.log(`assign-sparse-alternates: picked ${picked.length}, applied ${geoN + supN}, failed ${failures.length}`);
if (failures.length) console.warn("  no sparse cell:", failures.slice(0, 10).join(", "), failures.length > 10 ? "..." : "");

// Sample output for verification
for (const id of ["NCR-SEED-001", "NCR-SEED-002", "NCR-SEED-003"]) {
  const o = geo.orgs.find((x) => x.ncr_id === id);
  const r2 = o?.locations?.find((l) => l.rank === 2);
  if (r2?.lat) console.log(`  ${id}: rank2 ${r2.lat}, ${r2.lng} (${r2.city}, ${r2.state}) d-note: ${r2.geo_notes?.slice(0, 60)}...`);
}
