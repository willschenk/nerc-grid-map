#!/usr/bin/env node
// Build the name_shortest standards-review queue across every source record.
// Queue generation is read-only with respect to organization names.
//
// Default: records without a complete approved review.
// --all: include approved records too.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ROLE_WEIGHTS } from "../../src/lib/nerc/roles.mjs";
import {
  NAME_SHORTEST_BEST_MAX,
  NAME_SHORTEST_HARD_MAX,
  NAME_SHORTEST_PREFERRED_MAX,
  isApprovedNameReview,
  nameShortestIssues,
  normalizedNameLabel,
} from "../../src/lib/nerc/name-standards.mjs";

const PATHS = {
  geocoded: "src/data/nerc/geocoded-orgs.json",
  supplemental: "src/data/nerc/supplemental-orgs.json",
  names: "src/data/nerc/org-names.json",
  seedTwins: "src/data/nerc/seed-twins.json",
  published: "public/nerc/orgs.json",
  jsonl: "src/data/nerc/name-queue.jsonl",
  csv: "src/data/nerc/name-queue.csv",
};

const includeApproved = process.argv.includes("--all");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function weightOf(record) {
  return (record.roles ?? []).reduce(
    (sum, role) => sum + (ROLE_WEIGHTS[role] ?? 1),
    0,
  );
}

function milesBetween(a, b) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return Infinity;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function escapedCsv(value) {
  if (value == null) return "";
  const text = Array.isArray(value) || typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const geocodedRaw = readJson(PATHS.geocoded);
const geocoded = Array.isArray(geocodedRaw) ? geocodedRaw : geocodedRaw.orgs ?? [];
const supplementalRaw = readJson(PATHS.supplemental);
const supplemental = (Array.isArray(supplementalRaw) ? supplementalRaw : supplementalRaw.orgs ?? [])
  .map((record) => ({
    ...record,
    ncr_id: record.ncr_id || `SUP-${slug(record.entity_name)}`,
  }));

const nameRaw = existsSync(PATHS.names) ? readJson(PATHS.names) : { names: [] };
const nameEntries = Array.isArray(nameRaw) ? nameRaw : nameRaw.names ?? [];
const namesById = new Map(nameEntries.map((entry) => [entry.ncr_id, entry]));

const publishedIds = new Set();
const publishedById = new Map();
const combinedInto = new Map();
if (existsSync(PATHS.published)) {
  const publishedRaw = readJson(PATHS.published);
  for (const org of publishedRaw.orgs ?? []) {
    publishedIds.add(org.ncr_id);
    publishedById.set(org.ncr_id, org);
    for (const member of org.combined_members ?? []) {
      if (member?.ncr_id) combinedInto.set(member.ncr_id, org.ncr_id);
    }
  }
}

const retiredSeeds = new Set();
if (existsSync(PATHS.seedTwins)) {
  const twins = readJson(PATHS.seedTwins).twins ?? {};
  for (const [seedId, realIds] of Object.entries(twins)) {
    if (!publishedIds.has(seedId) && realIds.some((id) => publishedIds.has(id) || combinedInto.has(id))) {
      retiredSeeds.add(seedId);
    }
  }
}

const records = [
  ...geocoded.map((record) => ({ ...record, source_dataset: "geocoded" })),
  ...supplemental.map((record) => ({ ...record, source_dataset: "supplemental" })),
];

const ids = new Set();
for (const record of records) {
  if (!record.ncr_id) throw new Error(`Name queue record is missing ncr_id: ${record.entity_name}`);
  if (ids.has(record.ncr_id)) throw new Error(`Duplicate source ncr_id in name queue: ${record.ncr_id}`);
  ids.add(record.ncr_id);
}

const rows = records.map((record) => {
  const nameEntry = namesById.get(record.ncr_id) ?? null;
  const current = {
    shortest: nameEntry?.shortest ?? record.name_shortest ?? record.acronym ?? "",
    short: nameEntry?.short ?? record.name_short ?? "",
    normal: nameEntry?.normal ?? record.name_normal ?? record.entity_name ?? "",
    tier: nameEntry?.tier ?? "normal",
    shortest_type: nameEntry?.shortest_type ?? null,
    shortest_source: nameEntry?.shortest_source ?? null,
    shortest_source_url: nameEntry?.shortest_source_url ?? null,
    review_notes: nameEntry?.review_notes ?? null,
    review_status: nameEntry?.review_status ?? "pending",
    reviewed_at: nameEntry?.reviewed_at ?? null,
  };
  const mapStatus = publishedIds.has(record.ncr_id)
    ? "published"
    : combinedInto.has(record.ncr_id)
      ? "combined_member"
      : retiredSeeds.has(record.ncr_id)
        ? "retired_seed"
        : "source_only";
  const issues = [
    ...(nameEntry ? [] : ["missing_org_names_entry"]),
    ...(nameEntry && nameEntry.entity_name !== record.entity_name ? ["entity_name_mismatch"] : []),
    ...nameShortestIssues(current),
  ];
  return {
    ncr_id: record.ncr_id,
    source_dataset: record.source_dataset,
    map_status: mapStatus,
    combined_into: combinedInto.get(record.ncr_id) ?? null,
    entity_name: record.entity_name,
    rendered_shortest: publishedById.get(record.ncr_id)?.name_shortest ?? null,
    acronym: record.acronym ?? null,
    acronym_source: record.acronym_source ?? null,
    area_aliases: record.area_aliases ?? [],
    parent_org: record.parent_org ?? null,
    region: record.region ?? null,
    roles: record.roles ?? [],
    org_type: record.org_type ?? null,
    lat: record.lat ?? null,
    lng: record.lng ?? null,
    weight: weightOf(record),
    current,
    issues,
    collision_ids: [],
    nearby_collision_ids: [],
    approved: nameEntry ? isApprovedNameReview(nameEntry) : false,
  };
});

const rowsByLabel = new Map();
for (const row of rows) {
  const key = normalizedNameLabel(row.current.shortest);
  if (!key) continue;
  const group = rowsByLabel.get(key);
  if (group) group.push(row);
  else rowsByLabel.set(key, [row]);
}

for (const group of rowsByLabel.values()) {
  if (group.length < 2) continue;
  for (const row of group) {
    row.collision_ids = group
      .filter((other) => other.ncr_id !== row.ncr_id)
      .map((other) => other.ncr_id)
      .sort();
    row.nearby_collision_ids = group
      .filter((other) => other.ncr_id !== row.ncr_id && milesBetween(row, other) <= 100)
      .map((other) => other.ncr_id)
      .sort();
    row.issues.push("duplicate_label");
    if (row.nearby_collision_ids.length) row.issues.push("nearby_label_collision");
  }
}

const issueWeight = {
  missing_shortest: 120,
  over_15_characters: 115,
  generic_label: 110,
  nearby_label_collision: 100,
  under_3_without_alias_evidence: 95,
  two_letter_label_needs_alias_evidence: 90,
  entity_name_mismatch: 85,
  legal_suffix_in_shortest: 80,
  length_13_to_15: 70,
  missing_org_names_entry: 65,
  duplicate_label: 50,
  whitespace_cleanup: 40,
  documented_alias_over_15: 15,
};

function priorityScore(row) {
  const issueScore = row.issues.reduce(
    (max, issue) => Math.max(max, issueWeight[issue] ?? 0),
    0,
  );
  const mapScore =
    row.map_status === "published" ? 30 :
      row.map_status === "combined_member" ? 20 :
        row.map_status === "retired_seed" ? 10 : 0;
  return issueScore * 100000 + mapScore * 1000 + Math.min(row.weight, 99) * 10 + row.roles.length;
}

const queue = rows
  .filter((row) => includeApproved || !row.approved)
  .sort(
    (a, b) =>
      priorityScore(b) - priorityScore(a) ||
      a.entity_name.localeCompare(b.entity_name) ||
      a.ncr_id.localeCompare(b.ncr_id),
  )
  .map((row, index) => ({ order: index + 1, ...row }));

writeFileSync(
  PATHS.jsonl,
  queue.length ? `${queue.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
);

const csvHeaders = [
  "order",
  "ncr_id",
  "source_dataset",
  "map_status",
  "combined_into",
  "entity_name",
  "rendered_shortest",
  "current_shortest",
  "current_short",
  "current_normal",
  "tier",
  "shortest_type",
  "shortest_source",
  "shortest_source_url",
  "review_status",
  "reviewed_at",
  "acronym",
  "acronym_source",
  "area_aliases",
  "parent_org",
  "region",
  "roles",
  "org_type",
  "weight",
  "issues",
  "collision_ids",
  "nearby_collision_ids",
];
const csvRows = [csvHeaders.join(",")];
for (const row of queue) {
  csvRows.push([
    row.order,
    row.ncr_id,
    row.source_dataset,
    row.map_status,
    row.combined_into,
    row.entity_name,
    row.rendered_shortest,
    row.current.shortest,
    row.current.short,
    row.current.normal,
    row.current.tier,
    row.current.shortest_type,
    row.current.shortest_source,
    row.current.shortest_source_url,
    row.current.review_status,
    row.current.reviewed_at,
    row.acronym,
    row.acronym_source,
    row.area_aliases,
    row.parent_org,
    row.region,
    row.roles,
    row.org_type,
    row.weight,
    row.issues,
    row.collision_ids,
    row.nearby_collision_ids,
  ].map(escapedCsv).join(","));
}
writeFileSync(PATHS.csv, `${csvRows.join("\n")}\n`);

const statusCounts = Object.fromEntries(
  ["published", "combined_member", "retired_seed", "source_only"].map((status) => [
    status,
    queue.filter((row) => row.map_status === status).length,
  ]),
);
const withIssues = queue.filter((row) => row.issues.length).length;
const approvedCount = rows.filter((row) => row.approved).length;

console.log(`Name standards queue: ${queue.length} record(s)${includeApproved ? " (including approved)" : ""}`);
console.log(`Source records: ${rows.length}; approved: ${approvedCount}; with issue flags: ${withIssues}`);
console.log(`Map status: ${JSON.stringify(statusCounts)}`);
console.log(
  `Length targets: best <=${NAME_SHORTEST_BEST_MAX}, preferred <=${NAME_SHORTEST_PREFERRED_MAX}, hard <=${NAME_SHORTEST_HARD_MAX}`,
);
console.log(`Wrote ${PATHS.jsonl} and ${PATHS.csv}`);
