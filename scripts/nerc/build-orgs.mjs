#!/usr/bin/env node
// Build step: read geocoded NCR records, enrich them (weight, color, flags), and
// write the canonical public/orgs.json plus split runtime payloads. Also stage
// the US basemap into public/nerc/. Runs from npm "prebuild" so the data is fresh.
// (Spec Part 3.1: coordinates pre-baked into a static JSON at build time.)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { feature } from "topojson-client";
import { enrichOrg } from "../../src/lib/nerc/enrich.mjs";
import { applyMapCombines } from "../../src/lib/nerc/map-combines.mjs";
import { isExcludedTerritoryCode, isExcludedTerritoryFips } from "../../src/lib/nerc/excluded-territories.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const SEED = resolve(root, "src/data/nerc/seed-orgs.json");
// Non-NERC / NERC-missing orgs (Alaska/Hawaii utilities, CCAs, small munis &
// co-ops, merchant/IPPs). Merged in after the registry records. See
// scripts/nerc/build-supplemental.mjs and SUPPLEMENTAL_GUIDE.md.
const SUPPLEMENTAL = resolve(root, "src/data/nerc/supplemental-orgs.json");

// Fallback size/color for supplemental orgs that have no functional role, keyed
// by org_type (role-based orgs use the normal weight/color from enrichOrg).
const SUP_TYPE_WEIGHT = { ISO_RTO: 24, IOU: 16, federal: 14, cooperative: 9, municipal: 9, cca: 8, merchant: 6, other: 5 };
const SUP_TYPE_COLOR = {
  cooperative: "hsl(45, 62%, 50%)",
  municipal: "hsl(265, 42%, 56%)",
  cca: "hsl(168, 45%, 44%)",
  merchant: "hsl(20, 58%, 52%)",
  federal: "hsl(208, 48%, 50%)",
  IOU: "hsl(140, 55%, 43%)",
  ISO_RTO: "hsl(280, 55%, 50%)",
  other: "hsl(0, 0%, 55%)",
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const normName = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|lp|co|company|corporation|the|of|and)\b/g, " ").replace(/\s+/g, " ").trim();

// Read supplemental-orgs.json, enrich, and drop ones that lack coordinates or
// duplicate an existing (NERC) org by normalized name.
function loadSupplemental(existingNames) {
  if (!existsSync(SUPPLEMENTAL)) return [];
  const list = JSON.parse(readFileSync(SUPPLEMENTAL, "utf8"));
  const out = [];
  let dupes = 0;
  let ungeocoded = 0;
  let territories = 0;
  let excludedTerritories = 0;
  for (const s of list) {
    if (isExcludedTerritoryCode(s.state)) {
      excludedTerritories++;
      continue;
    }
    // Territory orgs (PR/VI only) have no mainland-projectable coordinates but
    // still belong on the map — the renderer places them in insets.
    const isTerritory = s.out_of_footprint === true;
    if ((s.lat == null || s.lng == null) && !isTerritory) { ungeocoded++; continue; }
    if (existingNames.has(normName(s.entity_name))) { dupes++; continue; }
    if (isTerritory) territories++;
    const org = enrichOrg({
      ...s,
      ncr_id: s.ncr_id || `SUP-${slug(s.entity_name)}`,
      nerc_registered: false,
      seed: false,
    });
    // Size by org_type (the NERC role weights are meaningless for non-registered
    // entities, and DP-only weight is tiny). Color by role mix when we have a
    // best-effort role, else by type.
    org.weight = SUP_TYPE_WEIGHT[org.org_type] ?? 5;
    if (org.roles.length === 0) org.color = SUP_TYPE_COLOR[org.org_type] ?? "hsl(0, 0%, 55%)";
    org.is_iso_rto = false; // supplemental orgs are never counted as real ISO/RTOs
    existingNames.add(normName(s.entity_name));
    out.push(org);
  }
  console.log(`nerc: +${out.length} supplemental orgs (${territories} territory-inset, ${dupes} name-dupes, ${ungeocoded} ungeocoded skipped${excludedTerritories ? `, ${excludedTerritories} excluded territories dropped` : ""})`);
  return out;
}

// Stage the Canada landmass (TopoJSON country 124 -> GeoJSON feature) so the map
// can draw it as background context. Best-effort: skipped if world-atlas absent.
function stageCanada() {
  if (!existsSync(WORLD_SRC)) {
    console.warn(`WARN: world-atlas not found at ${WORLD_SRC}; Canada context will be missing.`);
    return;
  }
  const world = JSON.parse(readFileSync(WORLD_SRC, "utf8"));
  const countries = feature(world, world.objects.countries);
  const canada = countries.features.find((f) => String(f.id) === "124");
  if (!canada) {
    console.warn("WARN: Canada (id 124) not found in world-atlas; context will be missing.");
    return;
  }
  writeFileSync(CANADA_OUT, JSON.stringify(canada));
  console.log(`nerc: wrote ${CANADA_OUT.replace(root + "/", "")} (Canada context)`);
}
// A geocoding-agent output file (JSON array or {orgs:[...]}) overrides the seed
// when present, so the real registry can drop in without touching this script.
const GEOCODED = resolve(root, "src/data/nerc/geocoded-orgs.json");
// Maps placeholder seeds to their authoritative registry twin(s). A seed is
// dropped once any twin is geocoded, so seeds auto-retire without leaving a gap.
const SEED_TWINS = resolve(root, "src/data/nerc/seed-twins.json");
// Researched three-tier display names, keyed by ncr_id (Cursor fills this in
// one entity at a time). Merged onto records before enrichOrg().
const ORG_NAMES = resolve(root, "src/data/nerc/org-names.json");
const MAP_COMBINES = resolve(root, "src/data/nerc/map-combines.json");

const OUT_DIR = resolve(root, "public/nerc");
const OUT_ORGS = resolve(OUT_DIR, "orgs.json");
const OUT_RENDER_ORGS = resolve(OUT_DIR, "orgs-render.json");
const OUT_ORG_DETAILS = resolve(OUT_DIR, "org-details.json");
const BASEMAP_SRC = resolve(root, "node_modules/us-atlas/states-10m.json");
const BASEMAP_OUT = resolve(OUT_DIR, "states-10m.json");
// Canada landmass, drawn as faint context north of the border (Canadian NERC
// entities — Hydro-Québec, IESO, NB Power, Nova Scotia Power, etc. — plot onto
// it via a conic that mirrors the Albers lower-48 piece). Country id 124.
const WORLD_SRC = resolve(root, "node_modules/world-atlas/countries-50m.json");
const CANADA_OUT = resolve(OUT_DIR, "canada-land.json");

function loadRecords() {
  const file = existsSync(GEOCODED) ? GEOCODED : SEED;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const records = Array.isArray(raw) ? raw : raw.orgs;
  if (!Array.isArray(records)) {
    throw new Error(`No "orgs" array found in ${file}`);
  }
  return { file, records };
}

// Drop placeholder seeds whose authoritative registry twin is already present,
// so the map shows exactly one dot per organization. Seeds with no geocoded twin
// stay, keeping major entities visible until the real row lands.
function dropRetiredSeeds(records) {
  if (!existsSync(SEED_TWINS)) return records;
  const twins = JSON.parse(readFileSync(SEED_TWINS, "utf8")).twins ?? {};
  const present = new Set(records.map((r) => r.ncr_id));
  return records.filter((r) => {
    const ids = twins[r.ncr_id];
    return !(ids && ids.some((id) => present.has(id)));
  });
}

// Load the researched-names table into a Map keyed by ncr_id. Each entry carries
// shortest / short / normal display names plus a "major" flag (forced to shortest
// on the map at every zoom). Missing file or fields just fall back to algorithmic
// shortening, so the map keeps working while research is in flight.
function loadNameTable() {
  if (!existsSync(ORG_NAMES)) return new Map();
  const raw = JSON.parse(readFileSync(ORG_NAMES, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.names ?? [];
  const map = new Map();
  for (const n of list) {
    if (!n || !n.ncr_id) continue;
    map.set(n.ncr_id, {
      name_shortest: n.shortest ?? null,
      name_short: n.short ?? null,
      name_normal: n.normal ?? null,
      name_major: n.tier === "major",
    });
  }
  return map;
}

// Fold researched names onto a record by ncr_id (no-op when unresearched).
function applyNames(rec, names) {
  const n = names.get(rec.ncr_id);
  return n ? { ...rec, ...n } : rec;
}

function tally(orgs, key) {
  const counts = {};
  for (const o of orgs) {
    const v = o[key] ?? "(none)";
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function stageBasemap() {
  if (!existsSync(BASEMAP_SRC)) {
    console.warn(`WARN: basemap not found at ${BASEMAP_SRC}. Run "npm install" first.`);
    return;
  }
  const raw = JSON.parse(readFileSync(BASEMAP_SRC, "utf8"));
  const geoms = raw.objects?.states?.geometries;
  if (Array.isArray(geoms)) {
    const before = geoms.length;
    raw.objects.states.geometries = geoms.filter((g) => !isExcludedTerritoryFips(g.id));
    const dropped = before - raw.objects.states.geometries.length;
    if (dropped) console.log(`nerc: basemap omitted ${dropped} excluded territory geometries`);
  }
  writeFileSync(BASEMAP_OUT, JSON.stringify(raw));
}

const RENDER_ORG_FIELDS = [
  "ncr_id",
  "entity_name",
  "acronym",
  "acronym_source",
  "name_shortest",
  "name_short",
  "name_normal",
  "name_major",
  "region",
  "roles",
  "role_count",
  "is_private",
  "lat",
  "lng",
  "city",
  "state",
  "country",
  "geo_confidence",
  "geo_needs_review",
  "weight",
  "color",
  "is_iso_rto",
  "org_type",
  "eia_utility_id",
  "seed",
  "nerc_registered",
  "out_of_footprint",
  "map_combine_label",
];

const ORG_DETAIL_FIELDS = [
  "headquarters_address",
  "geo_source",
  "geo_source_url",
  "geo_notes",
  "parent_org",
  "combined_members",
  "map_combine_summary",
];

function pickFields(org, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(org, field)) out[field] = org[field];
  }
  return out;
}

function buildSplitPayloads(payload) {
  const renderOrgs = payload.orgs.map((org) => pickFields(org, RENDER_ORG_FIELDS));
  const details = Object.fromEntries(
    payload.orgs.map((org) => [org.ncr_id, pickFields(org, ORG_DETAIL_FIELDS)]),
  );
  return {
    renderPayload: {
      generated_at: payload.generated_at,
      source_file: payload.source_file,
      count: renderOrgs.length,
      orgs: renderOrgs,
    },
    detailPayload: {
      generated_at: payload.generated_at,
      source_file: payload.source_file,
      count: payload.orgs.length,
      details,
    },
  };
}

function main() {
  const { file, records } = loadRecords();
  const names = loadNameTable();
  let nercOrgs = dropRetiredSeeds(records)
    .filter((r) => r.skip !== true)
    .map((r) => enrichOrg(applyNames(r, names)))
    .filter((o) => o.lat != null && o.lng != null);

  if (existsSync(MAP_COMBINES)) {
    const combineConfig = JSON.parse(readFileSync(MAP_COMBINES, "utf8"));
    const { orgs: combinedOrgs, folded: foldedCount } = applyMapCombines(nercOrgs, combineConfig);
    nercOrgs = combinedOrgs;
    if (foldedCount) console.log(`nerc: map-combined ${foldedCount} co-located registration(s)`);
  }

  const existingNames = new Set(nercOrgs.map((o) => normName(o.entity_name)));
  const supplemental = loadSupplemental(existingNames);
  const orgs = [...nercOrgs, ...supplemental];

  mkdirSync(OUT_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const payload = {
    generated_at: generatedAt,
    source_file: file.replace(root + "/", ""),
    count: orgs.length,
    orgs,
  };
  const { renderPayload, detailPayload } = buildSplitPayloads(payload);
  writeFileSync(OUT_ORGS, JSON.stringify(payload));
  writeFileSync(OUT_RENDER_ORGS, JSON.stringify(renderPayload));
  writeFileSync(OUT_ORG_DETAILS, JSON.stringify(detailPayload));

  stageBasemap();
  stageCanada();

  const isoCount = orgs.filter((o) => o.is_iso_rto).length;
  console.log(`nerc: enriched ${orgs.length} orgs from ${payload.source_file}`);
  console.log(`nerc: ISOs/RTOs (weight>=35): ${isoCount}`);
  console.log(`nerc: by region:`, tally(orgs, "region"));
  console.log(`nerc: by confidence:`, tally(orgs, "geo_confidence"));
  console.log(
    `nerc: wrote ${OUT_ORGS.replace(root + "/", "")}, ${OUT_RENDER_ORGS.replace(root + "/", "")}, ${OUT_ORG_DETAILS.replace(root + "/", "")} and basemap`,
  );
}

main();
