#!/usr/bin/env node
// Verifies that the runtime payload split is a lossless projection of the
// canonical public/nerc/orgs.json for render-critical and panel-critical fields.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const fullPath = resolve(root, "public/nerc/orgs.json");
const renderPath = resolve(root, "public/nerc/orgs-render.json");
const detailsPath = resolve(root, "public/nerc/org-details.json");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fullPayload = readJson(fullPath);
const renderPayload = readJson(renderPath);
const detailsPayload = readJson(detailsPath);

const fullOrgs = Array.isArray(fullPayload) ? fullPayload : fullPayload.orgs;
const renderOrgs = Array.isArray(renderPayload) ? renderPayload : renderPayload.orgs;
const details = detailsPayload.details ?? {};

const errors = [];
const renderById = new Map(renderOrgs.map((org) => [org.ncr_id, org]));
const fullById = new Map(fullOrgs.map((org) => [org.ncr_id, org]));

const RENDER_CRITICAL_FIELDS = [
  "lat",
  "lng",
  "roles",
  "role_count",
  "weight",
  "color",
  "org_type",
  "region",
  "seed",
  "nerc_registered",
  "out_of_footprint",
  "geo_confidence",
];

const PANEL_FIELDS = [
  "ncr_id",
  "entity_name",
  "acronym",
  "acronym_source",
  "name_shortest",
  "name_short",
  "name_normal",
  "name_major",
  "roles",
  "role_count",
  "weight",
  "is_iso_rto",
  "region",
  "org_type",
  "seed",
  "nerc_registered",
  "headquarters_address",
  "city",
  "state",
  "country",
  "geo_confidence",
  "geo_source",
  "geo_source_url",
  "geo_notes",
  "combined_members",
  "map_combine_summary",
  "map_combine_label",
  "parent_org",
  "lat",
  "lng",
];

const DETAIL_ONLY_FIELDS = [
  "headquarters_address",
  "locations",
  "geo_source",
  "geo_source_url",
  "geo_notes",
  "parent_org",
  "combined_members",
  "map_combine_summary",
];

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fieldValue(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field) ? obj[field] : undefined;
}

function compareField(id, label, expected, actual, field) {
  if (!sameValue(fieldValue(expected, field), fieldValue(actual, field))) {
    errors.push(`${label} mismatch for ${id}.${field}`);
  }
}

if (!Array.isArray(fullOrgs)) errors.push("canonical payload has no orgs array");
if (!Array.isArray(renderOrgs)) errors.push("render payload has no orgs array");
if (fullOrgs.length !== renderOrgs.length) {
  errors.push(`count mismatch: canonical ${fullOrgs.length}, render ${renderOrgs.length}`);
}
if ((detailsPayload.count ?? Object.keys(details).length) !== fullOrgs.length) {
  errors.push(`detail count mismatch: canonical ${fullOrgs.length}, details ${detailsPayload.count ?? Object.keys(details).length}`);
}

for (const org of fullOrgs) {
  const renderOrg = renderById.get(org.ncr_id);
  if (!renderOrg) {
    errors.push(`missing render org: ${org.ncr_id}`);
    continue;
  }
  if (!Object.prototype.hasOwnProperty.call(details, org.ncr_id)) {
    errors.push(`missing details org: ${org.ncr_id}`);
    continue;
  }

  for (const field of RENDER_CRITICAL_FIELDS) {
    compareField(org.ncr_id, "render", org, renderOrg, field);
  }

  for (const field of DETAIL_ONLY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(renderOrg, field)) {
      errors.push(`detail-only field leaked into render payload: ${org.ncr_id}.${field}`);
    }
  }

  const reconstructed = { ...renderOrg, ...details[org.ncr_id] };
  for (const field of PANEL_FIELDS) {
    compareField(org.ncr_id, "reconstructed panel", org, reconstructed, field);
  }
}

for (const org of renderOrgs) {
  if (!fullById.has(org.ncr_id)) errors.push(`extra render org: ${org.ncr_id}`);
}
for (const id of Object.keys(details)) {
  if (!fullById.has(id)) errors.push(`extra details org: ${id}`);
}

console.log(`payload split: canonical=${fullOrgs.length} render=${renderOrgs.length} details=${Object.keys(details).length}`);
if (errors.length) {
  console.error(`payload split FAILED (${errors.length}):`);
  for (const error of errors.slice(0, 80)) console.error(`  - ${error}`);
  if (errors.length > 80) console.error(`  ... ${errors.length - 80} more`);
  process.exit(1);
}
console.log("payload split passed");
