#!/usr/bin/env node
// Hard-check Hawaii scope: supplemental inventory, coords, and mainland false positives.
// Exit 0 when every HI-related record is intentionally included or excluded.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATE_COORD_BBOX,
  isInsetStateCoordConsistent,
} from "../../src/lib/nerc/geography-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXPECTED_HI_COUNT = 21;

const HI_NAME_RE =
  /\bhawaii\b|\bhawaiian\b|\bhelco\b|\bheco\b|\bhei\b|\bmaui electric\b|\bkauai island\b|\bkiuc\b|\bpgv\b|\bpuna geothermal\b|\bkapolei energy\b|\bhamakua energy\b|\bhu honua\b|\bkaheawa\b|\bkahuku wind\b|\bkalaeloa\b|\bkapaia solar\b|\bkawailoa\b|\bkuihelani\b|\blawai solar\b|\bpackini nui\b|\bauwahi wind\b|\bpacific current\b|\bhseo\b/i;

/** Mainland NERC rows agents often confuse with Hawaii scope. */
const KNOWN_MAINLAND_NOT_HI = [
  {
    ncr_id: "NCR07086",
    entity_name: "Fitchburg Gas and Electric Light Company",
    state: "MA",
    reason: "Unitil MA utility — not Hawaii Electric Light (HELCO supplemental)",
  },
  {
    ncr_id: "NCR13073",
    entity_name: "Invenergy Services-Fairbanks",
    state: "IN",
    reason: "Indiana wind project — not Alaska or Hawaii",
  },
];

function loadJson(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), "utf8"));
}

function inHiBbox(lat, lng) {
  return isInsetStateCoordConsistent("HI", lat, lng);
}

const errors = [];
const notes = [];

const supplemental = loadJson("src/data/nerc/supplemental-orgs.json");
const geocoded = loadJson("src/data/nerc/geocoded-orgs.json").orgs ?? [];
const published = loadJson("public/nerc/orgs.json").orgs ?? [];

const hiSupp = supplemental.filter((o) => o.state === "HI");
const hiPub = published.filter((o) => o.state === "HI");
const geocodedHi = geocoded.filter((o) => o.state === "HI");

if (hiSupp.length !== EXPECTED_HI_COUNT) {
  errors.push(`supplemental HI count ${hiSupp.length} (expected ${EXPECTED_HI_COUNT})`);
}
if (hiPub.length !== EXPECTED_HI_COUNT) {
  errors.push(`published HI count ${hiPub.length} (expected ${EXPECTED_HI_COUNT})`);
}
if (geocodedHi.length > 0) {
  errors.push(`geocoded NERC rows with state HI: ${geocodedHi.map((o) => o.ncr_id).join(", ")}`);
}

for (const o of hiSupp) {
  if (o.out_of_footprint) errors.push(`${o.entity_name}: out_of_footprint must be false`);
  if (o.nerc_registered !== false) errors.push(`${o.entity_name}: must be nerc_registered false`);
  if (!o.city) errors.push(`${o.entity_name}: missing city`);
  if (!inHiBbox(o.lat, o.lng)) {
    errors.push(`${o.entity_name}: coords (${o.lat}, ${o.lng}) outside HI bbox`);
  }
  const locs = o.locations ?? [];
  if (locs.length !== 3) errors.push(`${o.entity_name}: expected 3 location slots`);
  const r1 = locs.find((l) => l.rank === 1);
  if (r1 && (r1.lat !== o.lat || r1.lng !== o.lng)) {
    errors.push(`${o.entity_name}: rank-1 coords mismatch`);
  }
  for (const loc of locs) {
    if (loc.lat != null && loc.lng != null && !inHiBbox(loc.lat, loc.lng)) {
      errors.push(`${o.entity_name} rank ${loc.rank}: coords outside HI bbox`);
    }
  }
}

const mainlandInHiBbox = published.filter(
  (o) => o.lat != null && o.lng != null && o.state !== "HI" && inHiBbox(o.lat, o.lng),
);
for (const o of mainlandInHiBbox) {
  errors.push(`mainland org in HI bbox: ${o.ncr_id} ${o.state} ${o.entity_name}`);
}

const nameHits = geocoded.filter((o) => HI_NAME_RE.test(o.entity_name ?? "") && o.state !== "HI");
for (const o of nameHits) {
  const known = KNOWN_MAINLAND_NOT_HI.find((k) => k.ncr_id === o.ncr_id);
  if (known) {
    notes.push(`OK mainland name hit: ${o.ncr_id} ${o.entity_name} (${known.reason})`);
    if (!inHiBbox(o.lat, o.lng)) continue;
    errors.push(`${o.ncr_id} mainland org mapped inside HI bbox`);
  } else if (inHiBbox(o.lat, o.lng)) {
    errors.push(`unexpected mainland name hit in HI bbox: ${o.ncr_id} ${o.entity_name}`);
  }
}

for (const k of KNOWN_MAINLAND_NOT_HI) {
  const row = geocoded.find((o) => o.ncr_id === k.ncr_id);
  if (!row) {
    errors.push(`known false-positive row missing from geocoded: ${k.ncr_id}`);
    continue;
  }
  if (row.state !== k.state) {
    errors.push(`${k.ncr_id} state ${row.state} (expected ${k.state})`);
  }
  if (inHiBbox(row.lat, row.lng)) {
    errors.push(`${k.ncr_id} coords inside HI bbox`);
  }
}

console.log(`Hawaii audit: ${hiSupp.length} supplemental, ${hiPub.length} published`);
console.log(`HI bbox: ${JSON.stringify(STATE_COORD_BBOX.HI)}`);
if (notes.length) {
  console.log("\nKnown mainland false positives (intentionally excluded from HI):");
  for (const n of notes) console.log(`  - ${n}`);
}
if (errors.length) {
  console.error(`\nHawaii audit FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\nHawaii audit passed: all HI orgs intentional, no accidental HI mapping.");
