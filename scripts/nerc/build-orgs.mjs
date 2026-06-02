#!/usr/bin/env node
// Build step: read geocoded NCR records, enrich them (weight, color, flags), and
// write the static public/orgs.json the map loads at runtime. Also stage the US
// basemap into public/nerc/. Runs from npm "prebuild" so the data is always fresh.
// (Spec Part 3.1: coordinates pre-baked into a static JSON at build time.)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { enrichOrg } from "../../src/lib/nerc/enrich.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const SEED = resolve(root, "src/data/nerc/seed-orgs.json");
// A geocoding-agent output file (JSON array or {orgs:[...]}) overrides the seed
// when present, so the real registry can drop in without touching this script.
const GEOCODED = resolve(root, "src/data/nerc/geocoded-orgs.json");

const OUT_DIR = resolve(root, "public/nerc");
const OUT_ORGS = resolve(OUT_DIR, "orgs.json");
const BASEMAP_SRC = resolve(root, "node_modules/us-atlas/states-10m.json");
const BASEMAP_OUT = resolve(OUT_DIR, "states-10m.json");

function loadRecords() {
  const file = existsSync(GEOCODED) ? GEOCODED : SEED;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const records = Array.isArray(raw) ? raw : raw.orgs;
  if (!Array.isArray(records)) {
    throw new Error(`No "orgs" array found in ${file}`);
  }
  return { file, records };
}

function tally(orgs, key) {
  const counts = {};
  for (const o of orgs) {
    const v = o[key] ?? "(none)";
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function main() {
  const { file, records } = loadRecords();
  const orgs = records
    .filter((r) => r.skip !== true)
    .map(enrichOrg)
    .filter((o) => o.lat != null && o.lng != null);

  mkdirSync(OUT_DIR, { recursive: true });

  const payload = {
    generated_at: new Date().toISOString(),
    source_file: file.replace(root + "/", ""),
    count: orgs.length,
    orgs,
  };
  writeFileSync(OUT_ORGS, JSON.stringify(payload));

  if (existsSync(BASEMAP_SRC)) {
    copyFileSync(BASEMAP_SRC, BASEMAP_OUT);
  } else {
    console.warn(`WARN: basemap not found at ${BASEMAP_SRC}. Run "npm install" first.`);
  }

  const isoCount = orgs.filter((o) => o.is_iso_rto).length;
  console.log(`nerc: enriched ${orgs.length} orgs from ${payload.source_file}`);
  console.log(`nerc: ISOs/RTOs (weight>=35): ${isoCount}`);
  console.log(`nerc: by region:`, tally(orgs, "region"));
  console.log(`nerc: by confidence:`, tally(orgs, "geo_confidence"));
  console.log(`nerc: wrote ${OUT_ORGS.replace(root + "/", "")} and basemap`);
}

main();
