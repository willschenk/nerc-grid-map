#!/usr/bin/env node
// One-shot Hawaii org data cleanup: cities, geo_notes, false-positive clarifiers.
// Source of truth: src/data/nerc/supplemental-orgs.json + geocoded-orgs.json

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SUPP = resolve(root, "src/data/nerc/supplemental-orgs.json");
const GEO = resolve(root, "src/data/nerc/geocoded-orgs.json");

const HI_NOTE = "Supplemental Hawaii utility (not in NERC registry extract).";

/** Per-entity notes where generic "utility" would mislead future agents. */
const NOTE_BY_NAME = {
  "Hawaii State Energy Office":
    "Supplemental Hawaii state energy office (not in NERC registry extract).",
  "Pacific Current, LLC":
    "Supplemental Hawaii non-utility affiliate (HEI; not in NERC registry extract).",
};

/** HQ or primary site city for rank-1 coordinates. */
const CITY_BY_NAME = {
  "AES Hawaii, Inc.": "Kapolei",
  "Auwahi Wind Energy, LLC": "Ulupalakua",
  "Hawaii Electric Light Company, Inc.": "Hilo",
  "Hawaiian Electric Company, Inc.": "Honolulu",
  "Hawaiian Electric Industries, Inc.": "Honolulu",
  "Kaheawa Wind Power, LLC": "Maui",
  "Kapolei Energy Storage, LLC": "Kapolei",
  "Kauai Island Utility Cooperative": "Lihue",
  "Maui Electric Company, Limited": "Wailuku",
  "Puna Geothermal Venture": "Pahoa",
};

function setHiNote(o, note = HI_NOTE) {
  o.geo_notes = note;
  const loc = o.locations?.[0];
  if (loc) {
    if (!loc.geo_notes || loc.geo_notes.includes("candidate")) loc.geo_notes = note;
    if (o.city && !loc.city) loc.city = o.city;
    if (o.state && !loc.state) loc.state = o.state;
  }
}

function patchSupplemental() {
  const list = JSON.parse(readFileSync(SUPP, "utf8"));
  let cities = 0;
  let notes = 0;
  for (const o of list) {
    if (o.state !== "HI") continue;
    const city = CITY_BY_NAME[o.entity_name];
    if (city && o.city !== city) {
      o.city = city;
      if (o.locations?.[0]) o.locations[0].city = city;
      cities++;
    }
    const note = NOTE_BY_NAME[o.entity_name] ?? HI_NOTE;
    if (
      !o.geo_notes ||
      o.geo_notes.includes("candidate") ||
      o.geo_notes.includes("uploaded NERC-derived") ||
      (NOTE_BY_NAME[o.entity_name] && o.geo_notes !== note)
    ) {
      setHiNote(o, note);
      notes++;
    }
  }
  writeFileSync(SUPP, `${JSON.stringify(list, null, 2)}\n`);
  console.log(`fix-hawaii: supplemental ${cities} cities, ${notes} geo_notes`);
}

function patchGeocoded() {
  const { orgs } = JSON.parse(readFileSync(GEO, "utf8"));
  const patches = {
    NCR07086: {
      notes:
        "Unitil electric and gas utility serving Fitchburg MA — not Hawaii Electric Light (HELCO).",
      geo_notes:
        "Massachusetts mainland utility; fuzzy-match twin for HELCO in supplemental-candidates.csv only.",
    },
  };
  let n = 0;
  for (const o of orgs) {
    const p = patches[o.ncr_id];
    if (!p) continue;
    if (o.notes !== p.notes) {
      o.notes = p.notes;
      n++;
    }
    const loc = o.locations?.[0];
    if (loc && loc.geo_notes !== p.geo_notes) {
      loc.geo_notes = p.geo_notes;
      n++;
    }
  }
  writeFileSync(GEO, `${JSON.stringify({ orgs }, null, 2)}\n`);
  console.log(`fix-hawaii: geocoded ${n} false-positive clarifier updates`);
}

patchSupplemental();
patchGeocoded();
