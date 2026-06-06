#!/usr/bin/env node
// Seed/refresh the SUPPLEMENTAL org layer from the research-queue CSV.
//
// Supplemental orgs are utilities/businesses that are NOT in the NERC Compliance
// Registry (or are missing from our NERC extract) -- Alaska/Hawaii utilities,
// community choice aggregators, municipals/co-ops below the NERC threshold,
// merchant/IPPs, etc. They render as normal dots but carry no NERC ID and get
// best-effort (not official) functional roles.
//
// This script is IDEMPOTENT and MERGE-ONLY: it never overwrites an entry that
// already exists in supplemental-orgs.json (matched by name). So a human/Cursor
// can fill in lat/lng + refine roles in the JSON, and re-running this only APPENDS
// newly-added CSV rows. Edit the JSON for data; edit the CSV to queue new names.
//
// Usage:  node scripts/nerc/build-supplemental.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { inferOrgType, orgWeight } from "../../src/lib/nerc/enrich.mjs";
import { isExcludedTerritoryCode } from "../../src/lib/nerc/excluded-territories.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const CSV = resolve(root, "src/data/nerc/supplemental-candidates.csv");
const OUT = resolve(root, "src/data/nerc/supplemental-orgs.json");

// geoAlbersUsa only projects the 50 states (with AK/HI insets). Puerto Rico and
// the U.S. Virgin Islands are rendered as labelled offshore insets instead; no
// other U.S. territories are carried.
const OUT_OF_FOOTPRINT = new Set(["PR", "VI"]);

// Starter coordinates (approx HQ city) so a useful batch renders immediately.
// Everything else lands with lat/lng = null and is geocoded later (see
// scripts/nerc/SUPPLEMENTAL_GUIDE.md). Keyed by exact organization name.
const KNOWN_COORDS = {
  // Alaska
  "Chugach Electric Association, Inc.": [61.19, -149.88],
  "Golden Valley Electric Association, Inc.": [64.84, -147.72],
  "Matanuska Electric Association, Inc.": [61.6, -149.11],
  "Homer Electric Association, Inc.": [59.65, -151.54],
  "Alaska Electric Light & Power Company": [58.3, -134.42],
  "Alaska Energy Authority": [61.22, -149.89],
  "Alaska Village Electric Cooperative, Inc.": [61.19, -149.86],
  "Alaska Power Company": [61.19, -149.86],
  "Kodiak Electric Association, Inc.": [57.79, -152.41],
  "Copper Valley Electric Association, Inc.": [62.11, -145.55],
  "Cordova Electric Cooperative": [60.54, -145.76],
  "Kotzebue Electric Association": [66.9, -162.6],
  "Nome Joint Utility System": [64.5, -165.41],
  "City of Seward Electric System": [60.1, -149.44],
  "Railbelt Reliability Council": [61.22, -149.89],
  "Petersburg Municipal Power & Light": [56.81, -132.96],
  "Sitka Electric Department": [57.05, -135.33],
  "Ketchikan Public Utilities - Electric Division": [55.34, -131.65],
  "Wrangell Municipal Light & Power": [56.47, -132.38],
  "Naknek Electric Association, Inc.": [58.73, -157.02],
  "City of Unalaska Department of Public Utilities": [53.87, -166.54],
  // Hawaii
  "Hawaiian Electric Company, Inc.": [21.31, -157.86],
  "Hawaiian Electric Industries, Inc.": [21.31, -157.86],
  "Hawaii Electric Light Company, Inc.": [19.71, -155.08],
  "Maui Electric Company, Limited": [20.89, -156.47],
  "Kauai Island Utility Cooperative": [21.98, -159.37],
  "Kapolei Energy Storage, LLC": [21.34, -158.06],
  "AES Hawaii, Inc.": [21.32, -158.05],
  "Puna Geothermal Venture": [19.49, -154.91],
  "Kaheawa Wind Power, LLC": [20.8, -156.54],
  "Auwahi Wind Energy, LLC": [20.62, -156.36],
  // Mainland public power / municipal / co-op
  "Sacramento Municipal Utility District": [38.58, -121.49],
  "Austin Energy": [30.27, -97.74],
  "CPS Energy": [29.42, -98.49],
  "Seattle City Light": [47.61, -122.33],
  "Tacoma Power": [47.25, -122.44],
  "Snohomish County Public Utility District": [47.98, -122.2],
  "Turlock Irrigation District": [37.49, -120.85],
  "Pedernales Electric Cooperative": [30.28, -98.41],
  "Bryan Texas Utilities": [30.67, -96.37],
  "Denton Municipal Electric": [33.21, -97.13],
  // Community choice aggregators
  "Marin Clean Energy": [37.97, -122.53],
  "Ava Community Energy": [37.8, -122.27],
  CleanPowerSF: [37.77, -122.42],
  "Silicon Valley Clean Energy Authority": [37.39, -122.08],
  "Peninsula Clean Energy Authority": [37.56, -122.32],
  "San Diego Community Power": [32.72, -117.16],
  "Sonoma Clean Power Authority": [38.44, -122.71],
  "Central Coast Community Energy": [36.68, -121.65],
  "Clean Power Alliance of Southern California": [34.05, -118.25],
};

// Minimal CSV parser: quoted fields, escaped quotes, newlines in quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const nameKey = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

// Best-effort org type + functional roles (NOT official NERC registration).
function classify(name, entityType, layer) {
  const e = `${entityType} ${layer}`.toLowerCase();
  // CCAs first (their type also contains the word "aggregator").
  if (/community choice/.test(e)) return { org_type: "cca", roles: ["LSE"] };
  if (/broader power-market|power marketer|der aggregator|developer|storage business|trading|commodities|energy management/.test(e)) {
    return { org_type: "merchant", roles: ["PSE"] };
  }
  // Rural electric co-ops are commonly named "... Electric Association".
  if (/cooperative|co-op|electric membership|\bemc\b|electric association|rural electric/i.test(name)) {
    return { org_type: "cooperative", roles: ["DP"] };
  }
  const generation =
    /\bwind\b|\bsolar\b|storage|geothermal|bioenergy|cogen|generating|energy center|\bllc\b|\bl\.?p\.?\b|partners|repower|\bventure\b/i.test(name) &&
    !/utilit|municipal|city of|department|authority|board|district|light & power|power & light|electric system|public power|power company|electric company/i.test(name);
  if (generation) return { org_type: "merchant", roles: ["GO"] };
  const roles = ["DP"];
  let org_type = inferOrgType(name, roles, orgWeight(roles));
  // Real ISOs/RTOs are already in the NERC data, so any ISO_RTO guess here is a
  // misclassification (e.g. "...Reliability Council").
  if (org_type === "ISO_RTO") org_type = "other";
  return { org_type, roles };
}

function main() {
  if (!existsSync(CSV)) {
    console.error(`Missing ${CSV.replace(root + "/", "")}`);
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  const header = rows[0].map((h) => h.trim());
  const col = (n) => header.indexOf(n);
  const iName = col("organization");
  const iState = col("state_or_territory");
  const iLayer = col("coverage_gap_layer");
  const iType = col("entity_type");
  const iPriority = col("priority");
  const iBasis = col("source_basis");
  const iUrl = col("source_url");

  const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
  const kept = existing.filter((o) => !isExcludedTerritoryCode(o.state));
  const purged = existing.length - kept.length;
  const byKey = new Map(kept.map((o) => [nameKey(o.entity_name), o]));

  let added = 0;
  let geocoded = 0;
  for (let r = 1; r < rows.length; r++) {
    const name = (rows[r][iName] || "").trim();
    if (!name) continue;
    const key = nameKey(name);
    if (byKey.has(key)) continue; // never clobber existing edits

    const state = (rows[r][iState] || "").trim() || null;
    if (isExcludedTerritoryCode(state)) continue;
    const { org_type, roles } = classify(name, rows[r][iType] || "", rows[r][iLayer] || "");
    const coords = KNOWN_COORDS[name];
    if (coords) geocoded++;

    const entry = {
      entity_name: name,
      acronym: null,
      state,
      city: null,
      lat: coords ? coords[0] : null,
      lng: coords ? coords[1] : null,
      roles, // best-effort, NOT official NERC registration
      org_type,
      nerc_registered: false,
      geo_confidence: coords ? "MEDIUM" : "ESTIMATED",
      out_of_footprint: OUT_OF_FOOTPRINT.has(state || ""),
      priority: (rows[r][iPriority] || "").trim() || null,
      geo_source: "EIA-861 / public utility records",
      geo_source_url: (rows[r][iUrl] || "").trim() || null,
      geo_notes: (rows[r][iBasis] || "").trim() || "",
    };
    kept.push(entry);
    byKey.set(key, entry);
    added++;
  }

  kept.sort((a, b) => (a.state || "").localeCompare(b.state || "") || a.entity_name.localeCompare(b.entity_name));
  writeFileSync(OUT, JSON.stringify(kept, null, 2) + "\n");

  const placed = kept.filter((o) => o.lat != null && o.lng != null).length;
  const needGeo = kept.filter((o) => o.lat == null && !o.out_of_footprint).length;
  console.log(`supplemental: ${kept.length} entries (${added} new this run${purged ? `, ${purged} excluded territories removed` : ""})`);
  console.log(`supplemental: ${placed} have coordinates (${geocoded} from the starter table)`);
  console.log(`supplemental: ${needGeo} still need geocoding; ${kept.filter((o) => o.out_of_footprint).length} are out-of-footprint (territories)`);
  console.log(`supplemental: wrote ${OUT.replace(root + "/", "")}`);
}

main();
