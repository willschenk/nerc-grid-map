#!/usr/bin/env node
// Builds the display-name research queue: every geocoded org that does NOT yet
// have a researched three-tier name in src/data/nerc/org-names.json. This is the
// work list for a human-in-the-loop agent (Cursor) that researches names one at
// a time, biggest/most-important entities first.
//
// Three tiers per entity:
//   shortest - the bare acronym ALWAYS shown for major entities (e.g. "PJM", "CE")
//   short    - a short readable form (e.g. "PJM Interconnection", "Consumers")
//   normal   - the full brand/legal-ish name (e.g. "PJM Interconnection, LLC")
//   tier     - "major" pins the entity to its shortest acronym at every zoom.
//
// Emits:
//   src/data/nerc/name-queue.jsonl - one record per line, in the research input
//       shape: {ncr_id, entity_name, acronym, region, roles, weight, is_iso_rto}.
//       Append results into the "names" array of src/data/nerc/org-names.json.
//   src/data/nerc/name-queue.csv   - human-readable index.
//
// Ordering = priority: heaviest / ISO-RTO / most-roles entities first, because a
// bad name on a big dot is the most visible. Re-run any time; it recomputes the diff.
//
// Usage:  node scripts/nerc/build-name-queue.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const orgs = JSON.parse(
  readFileSync("src/data/nerc/geocoded-orgs.json", "utf8"),
).orgs;

const named = existsSync("src/data/nerc/org-names.json")
  ? JSON.parse(readFileSync("src/data/nerc/org-names.json", "utf8")).names ?? []
  : [];
const doneIds = new Set(named.filter((n) => n && n.shortest).map((n) => n.ncr_id));

// Drop placeholder seeds whose real twin is already named (seed retires from the map
// once geocoded, but may linger in geocoded-orgs.json until cleaned up).
const retiredSeeds = new Set();
if (existsSync("src/data/nerc/seed-twins.json")) {
  const twins = JSON.parse(readFileSync("src/data/nerc/seed-twins.json", "utf8")).twins ?? {};
  for (const [seed, realIds] of Object.entries(twins)) {
    if (realIds.some((id) => doneIds.has(id))) retiredSeeds.add(seed);
  }
}

const ROLE_WEIGHTS = { RC: 10, BA: 8, PC: 6, TOP: 5, TSP: 4, TP: 3, RP: 2, RSG: 2 };
const weightOf = (r) =>
  (r.roles ?? []).reduce((s, role) => s + (ROLE_WEIGHTS[role] ?? 1), 0);

const todo = orgs
  .filter((o) => o.lat != null && o.lng != null)
  .filter((o) => !doneIds.has(o.ncr_id))
  .filter((o) => !retiredSeeds.has(o.ncr_id))
  // Dedupe by name so we don't research the same brand twice.
  .filter((o, i, all) => all.findIndex((x) => x.entity_name === o.entity_name) === i)
  .map((o) => ({ ...o, _w: weightOf(o) }));

// Priority: ISO/RTO and seed majors first, then heaviest, then most roles.
todo.sort(
  (a, b) =>
    Number(b.seed === true) - Number(a.seed === true) ||
    b._w - a._w ||
    (b.roles?.length ?? 0) - (a.roles?.length ?? 0) ||
    a.entity_name.localeCompare(b.entity_name),
);

const jsonl = todo
  .map((o) =>
    JSON.stringify({
      ncr_id: o.ncr_id,
      entity_name: o.entity_name,
      acronym: o.acronym ?? null,
      region: o.region ?? null,
      roles: o.roles ?? [],
      weight: o._w,
      is_iso_rto: o._w >= 35 || o.seed === true,
    }),
  )
  .join("\n");
writeFileSync("src/data/nerc/name-queue.jsonl", jsonl + "\n");

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csvRows = [["order", "ncr_id", "entity_name", "acronym", "weight", "roles"].join(",")];
todo.forEach((o, i) => {
  csvRows.push(
    [
      i + 1,
      esc(o.ncr_id),
      esc(o.entity_name),
      esc(o.acronym ?? ""),
      o._w,
      esc((o.roles ?? []).join(" ")),
    ].join(","),
  );
});
writeFileSync("src/data/nerc/name-queue.csv", csvRows.join("\n") + "\n");

console.log(`Name queue: ${todo.length} entities still need researched names`);
console.log(`Done so far: ${doneIds.size} named`);
console.log("\nWrote src/data/nerc/name-queue.jsonl and name-queue.csv");
