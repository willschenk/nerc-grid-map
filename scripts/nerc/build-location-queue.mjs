#!/usr/bin/env node
// Export orgs that share rank-1 coordinates and still lack alternate locations.
// Fill ranks 2–3 in geocoded-orgs.json / supplemental-orgs.json manually.
//
// Usage: node scripts/nerc/build-location-queue.mjs [public/nerc/orgs.json]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const file = resolve(process.argv[2] || "public/nerc/orgs.json");
const outDir = resolve(root, "src/data/nerc");
const outJsonl = resolve(outDir, "location-queue.jsonl");
const outCsv = resolve(outDir, "location-queue.csv");

const data = JSON.parse(readFileSync(file, "utf8"));
const orgs = Array.isArray(data) ? data : data.orgs;

const byCoord = new Map();
for (const o of orgs) {
  if (o.lat == null || o.lng == null || o.out_of_footprint) continue;
  const key = `${o.lat},${o.lng}`;
  (byCoord.has(key) ? byCoord.get(key) : byCoord.set(key, []).get(key)).push(o);
}

const queue = [];
for (const [, group] of byCoord) {
  if (group.length < 2) continue;
  for (const o of group) {
    const locs = o.locations ?? [];
    const hasAlt = locs.some((l) => l.rank > 1 && l.lat != null);
    queue.push({
      ncr_id: o.ncr_id,
      entity_name: o.entity_name,
      lat: o.lat,
      lng: o.lng,
      shared_with: group.filter((g) => g.ncr_id !== o.ncr_id).map((g) => g.ncr_id),
      shared_count: group.length,
      has_alternate_location: hasAlt,
      needs_research: !hasAlt,
    });
  }
}

queue.sort(
  (a, b) =>
    b.shared_count - a.shared_count ||
    a.entity_name.localeCompare(b.entity_name),
);

mkdirSync(outDir, { recursive: true });
writeFileSync(outJsonl, queue.map((r) => JSON.stringify(r)).join("\n") + (queue.length ? "\n" : ""));
const header = "ncr_id,entity_name,lat,lng,shared_count,shared_with,needs_research\n";
const csvRows = queue.map((r) =>
  [
    r.ncr_id,
    `"${String(r.entity_name).replace(/"/g, '""')}"`,
    r.lat,
    r.lng,
    r.shared_count,
    `"${r.shared_with.join("; ")}"`,
    r.needs_research,
  ].join(","),
);
writeFileSync(outCsv, header + csvRows.join("\n") + (queue.length ? "\n" : ""));

const needs = queue.filter((r) => r.needs_research).length;
console.log(`location-queue: ${queue.length} shared-coordinate rows (${needs} need alternate locations)`);
console.log(`  wrote ${outJsonl.replace(root + "/", "")}`);
console.log(`  wrote ${outCsv.replace(root + "/", "")}`);
