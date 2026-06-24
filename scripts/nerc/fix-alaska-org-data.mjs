#!/usr/bin/env node
// One-shot Alaska org data cleanup: cities, coords, geo_notes, false-positive clarifiers.
// Source of truth: src/data/nerc/supplemental-orgs.json + geocoded-orgs.json

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SUPP = resolve(root, "src/data/nerc/supplemental-orgs.json");
const GEO = resolve(root, "src/data/nerc/geocoded-orgs.json");

const AK_NOTE = "Supplemental Alaska utility (not in NERC registry extract).";
const AK_BETHEL_NOTE =
  "City of Bethel AK municipal utility. Not the same entity as NERC NCR13276 Bethel Wind Energy LLC (Iowa wind project).";

/** HQ city for rank-1 coordinates (city-level geocoding). */
const CITY_BY_NAME = {
  "Alaska Electric Light & Power Company": "Juneau",
  "Alaska Energy Authority": "Anchorage",
  "Alaska Power Company": "Anchorage",
  "Alaska Village Electric Cooperative, Inc.": "Anchorage",
  "Chugach Electric Association, Inc.": "Anchorage",
  "City of Seward Electric System": "Seward",
  "City of Unalaska Department of Public Utilities": "Unalaska",
  "Copper Valley Electric Association, Inc.": "Glennallen",
  "Cordova Electric Cooperative": "Cordova",
  "Golden Valley Electric Association, Inc.": "Fairbanks",
  "Homer Electric Association, Inc.": "Homer",
  "Inside Passage Electric Cooperative, Inc.": "Coffman Cove",
  "Ketchikan Public Utilities - Electric Division": "Ketchikan",
  "Kodiak Electric Association, Inc.": "Kodiak",
  "Kotzebue Electric Association": "Kotzebue",
  "Matanuska Electric Association, Inc.": "Palmer",
  "Naknek Electric Association, Inc.": "Naknek",
  "Nome Joint Utility System": "Nome",
  "Petersburg Municipal Power & Light": "Petersburg",
  "Railbelt Reliability Council": "Anchorage",
  "Sitka Electric Department": "Sitka",
  "Wrangell Municipal Light & Power": "Wrangell",
};

const COORD_FIX = {
  "Inside Passage Electric Cooperative, Inc.": {
    lat: 55.0892,
    lng: -132.828,
    geo_source_url: "https://www.ipec.coop/",
    geo_confidence: "MEDIUM",
    geo_notes: "Prince of Wales Island co-op HQ, Coffman Cove AK (not Juneau).",
  },
};

function setAkNote(o, note = AK_NOTE) {
  o.geo_notes = note;
  const loc = o.locations?.[0];
  if (loc) {
    loc.geo_notes = note;
    if (o.city && !loc.city) loc.city = o.city;
    if (o.state && !loc.state) loc.state = o.state;
  }
}

function patchSupplemental() {
  const list = JSON.parse(readFileSync(SUPP, "utf8"));
  let n = 0;
  for (const o of list) {
    if (o.state !== "AK") continue;
    const city = CITY_BY_NAME[o.entity_name];
    if (city && o.city !== city) {
      o.city = city;
      if (o.locations?.[0]) o.locations[0].city = city;
      n++;
    }
    const fix = COORD_FIX[o.entity_name];
    if (fix) {
      Object.assign(o, fix);
      if (o.locations?.[0]) {
        Object.assign(o.locations[0], {
          lat: fix.lat,
          lng: fix.lng,
          city: city ?? o.city,
          geo_source_url: fix.geo_source_url,
          geo_confidence: fix.geo_confidence,
          geo_notes: fix.geo_notes,
        });
      }
      n++;
    }
    const note =
      o.entity_name === "City of Bethel Public Works - Electric Utility"
        ? AK_BETHEL_NOTE
        : fix?.geo_notes ?? AK_NOTE;
    if (o.geo_notes !== note) {
      setAkNote(o, note);
      n++;
    }
  }
  writeFileSync(SUPP, JSON.stringify(list, null, 2) + "\n");
  console.log(`supplemental-orgs.json: ${n} AK field updates`);
}

function patchGeocoded() {
  const { orgs } = JSON.parse(readFileSync(GEO, "utf8"));
  const patches = {
    NCR13276: {
      notes:
        "37.5 MW Bethel Wind Energy Center, Hawkeye IA — not Bethel AK. PPA seller to Central Iowa Power Cooperative.",
      geo_notes:
        "Iowa wind project; name is Bethel Wind Energy Center, not the Alaska city of Bethel.",
    },
    NCR13073: {
      notes:
        "Invenergy Fairbanks Wind Energy Center (Indiana). Sullivan IN HQ — not Fairbanks AK.",
      geo_notes:
        "Fairbanks in the entity name is the Indiana wind project, not Alaska.",
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
  writeFileSync(GEO, JSON.stringify({ orgs }, null, 2) + "\n");
  console.log(`geocoded-orgs.json: ${n} false-positive clarifier updates`);
}

patchSupplemental();
patchGeocoded();
