#!/usr/bin/env node
// Builds the manual-research queue: every ingested NERC record that has NOT yet
// been geocoded (i.e. is missing from geocoded-orgs.json). This is the work list
// for a human-in-the-loop agent (Cursor) that researches entities one at a time
// using scripts/nerc/geocoding-agent-prompt.md.
//
// Emits two artifacts:
//   src/data/nerc/research-queue.jsonl  - one record per line, already in the
//       geocoding prompt's User Template shape: {ncr_id, entity_name, region, roles}.
//       Append the agent's JSON results into src/data/nerc/geocoded-orgs.json.
//   src/data/nerc/research-queue.csv    - human-readable index (region, ncr_id, name, roles).
//
// Ordering = priority: finish nearly-complete regions first, then by region size,
// alphabetical within a region. Re-run any time; it recomputes the diff.
//
// Usage:  node scripts/nerc/build-research-queue.mjs

import { readFileSync, writeFileSync } from "node:fs";

const ingested = JSON.parse(
  readFileSync("src/data/nerc/ingested-records.json", "utf8"),
).records;
const geocoded = JSON.parse(
  readFileSync("src/data/nerc/geocoded-orgs.json", "utf8"),
).orgs;

const doneIds = new Set(geocoded.map((o) => o.ncr_id));
const todo = ingested.filter((r) => !doneIds.has(r.ncr_id));

// Priority: complete the regions already in progress, then largest remaining.
// Lower number = research sooner.
const REGION_PRIORITY = {
  MRO: 0, // 9 stragglers - finish the region
  NPCC: 1, // 1 straggler - finish the region
  RF: 2, // partially done - complete it
  SERC: 3,
  "Texas RE": 4,
  WECC: 5,
};
const rank = (r) => REGION_PRIORITY[r.region] ?? 99;

todo.sort(
  (a, b) =>
    rank(a) - rank(b) ||
    a.region.localeCompare(b.region) ||
    a.entity_name.localeCompare(b.entity_name),
);

// JSONL in the User Template shape from geocoding-agent-prompt.md.
const jsonl = todo
  .map((r) =>
    JSON.stringify({
      ncr_id: r.ncr_id,
      entity_name: r.entity_name,
      region: r.region,
      roles: r.roles,
    }),
  )
  .join("\n");
writeFileSync("src/data/nerc/research-queue.jsonl", jsonl + "\n");

// CSV index for humans.
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csvRows = [["order", "region", "ncr_id", "entity_name", "roles"].join(",")];
todo.forEach((r, i) => {
  csvRows.push(
    [
      i + 1,
      esc(r.region),
      esc(r.ncr_id),
      esc(r.entity_name),
      esc(r.roles.join(" ")),
    ].join(","),
  );
});
writeFileSync("src/data/nerc/research-queue.csv", csvRows.join("\n") + "\n");

// Console summary.
const byRegion = {};
for (const r of todo) byRegion[r.region] = (byRegion[r.region] || 0) + 1;
console.log(`Research queue: ${todo.length} records remaining`);
console.log(`Done so far:    ${doneIds.size} geocoded of ${ingested.length} ingested`);
console.log("By region (research order):");
for (const region of Object.keys(REGION_PRIORITY)) {
  if (byRegion[region]) console.log(`  ${region.padEnd(10)} ${byRegion[region]}`);
}
for (const region of Object.keys(byRegion)) {
  if (!(region in REGION_PRIORITY))
    console.log(`  ${region.padEnd(10)} ${byRegion[region]} (unranked)`);
}
console.log(
  "\nWrote src/data/nerc/research-queue.jsonl and research-queue.csv",
);
