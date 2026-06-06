#!/usr/bin/env node
// Phase 1 ingester. Reads an exported NERC Compliance Registry file (CSV/TSV),
// validates headers, normalizes each row to {ncr_id, entity_name, region, roles},
// and emits a reviewable JSON file plus dashboard stats. Does NOT geocode and does
// NOT model compliance duties. (AGENTS.md Phase 1; backlog "NERC Registry Batch".)
//
// Usage:  node scripts/nerc/ingest.mjs <path-to-registry.csv> [out.json]
// The official registry ships as .xlsx; export it to CSV first (Save As > CSV).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeRoles } from "../../src/lib/nerc/enrich.mjs";
import { normalizeRegion } from "../../src/lib/nerc/roles.mjs";

const argPath = process.argv[2];
const outPath = process.argv[3] || "src/data/nerc/ingested-records.json";

if (!argPath) {
  console.error("Usage: node scripts/nerc/ingest.mjs <registry.csv> [out.json]");
  process.exit(2);
}
if (/\.xlsx?$/i.test(argPath)) {
  console.error(
    `Cannot read Excel directly. Open ${argPath} in Excel/Numbers and Save As CSV, then pass the .csv.`,
  );
  process.exit(2);
}

// Minimal RFC-4180-ish CSV/TSV parser: handles quoted fields, escaped quotes,
// and newlines inside quotes. Delimiter inferred from the header line.
function parseDelimited(text) {
  const delim = text.slice(0, text.indexOf("\n")).includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();
const MARKED = (v) => {
  const t = lower(v);
  return t !== "" && !["0", "n", "no", "false", "-", "na", "n/a"].includes(t);
};

function findHeader(headers, predicate) {
  return headers.findIndex((h) => predicate(lower(h)));
}

const text = readFileSync(resolve(argPath), "utf8");
const rows = parseDelimited(text);
if (rows.length < 2) {
  console.error("File has no data rows.");
  process.exit(1);
}
const headers = rows[0].map(norm);

// Validate required columns.
const idCol = findHeader(headers, (h) => h.includes("ncr") || h === "id");
const nameCol = findHeader(headers, (h) => h.includes("entity") || (h.includes("name") && !h.includes("region")));
const regionCol = findHeader(headers, (h) => h.includes("region"));

const missing = [];
if (idCol < 0) missing.push("NCR ID");
if (nameCol < 0) missing.push("Entity Name");
if (regionCol < 0) missing.push("Region");
if (missing.length) {
  console.error(`Header validation failed. Missing: ${missing.join(", ")}.`);
  console.error(`Found headers: ${headers.join(" | ")}`);
  process.exit(1);
}

// Two supported shapes:
//  A) one column per function (wide) - a marked cell means the org holds that role
//  B) a single "functions/roles" list column - split and normalize
const roleCols = [];
for (let i = 0; i < headers.length; i++) {
  if (i === idCol || i === nameCol || i === regionCol) continue;
  const tag = normalizeRoles([headers[i]]);
  if (tag.length === 1) roleCols.push({ index: i, header: headers[i] });
}
const funcCol = findHeader(headers, (h) => /function|role/.test(h));

if (roleCols.length === 0 && funcCol < 0) {
  console.error("No role columns or functions column recognized. Check the export.");
  console.error(`Found headers: ${headers.join(" | ")}`);
  process.exit(1);
}

// The compliance matrix lists one row per (entity, Regional Entity). Same NCR ID
// can appear in multiple REs (e.g. PJM is RF + SERC). Merge those rows here.
/** @type {Map<string, { ncr_id: string, entity_name: string, regions: Set<string>, roleSet: Set<string> }>} */
const byId = new Map();
let dupes = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const ncr_id = norm(row[idCol]);
  const entity_name = norm(row[nameCol]);
  if (!ncr_id && !entity_name) continue;

  let rawRoles;
  if (roleCols.length) {
    rawRoles = roleCols.filter((c) => MARKED(row[c.index])).map((c) => c.header);
  } else {
    rawRoles = norm(row[funcCol]).split(/[;,/|]+/);
  }
  const region = normalizeRegion(row[regionCol]);
  const roles = normalizeRoles(rawRoles);

  const existing = byId.get(ncr_id);
  if (existing) {
    dupes++;
    if (region) existing.regions.add(region);
    for (const role of roles) existing.roleSet.add(role);
    continue;
  }

  const regions = new Set(region ? [region] : []);
  const roleSet = new Set(roles);
  byId.set(ncr_id, { ncr_id, entity_name, regions, roleSet });
}

const records = [...byId.values()].map(({ ncr_id, entity_name, regions, roleSet }) => {
  const sortedRegions = [...regions].sort();
  return {
    ncr_id,
    entity_name,
    region: sortedRegions[0] ?? null,
    ...(sortedRegions.length > 1 ? { regions: sortedRegions } : {}),
    roles: [...roleSet].sort(),
  };
});

// Dashboard stats (ingested data only).
function tally(items, fn) {
  const m = {};
  for (const it of items) for (const v of [].concat(fn(it))) m[v] = (m[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
const noRoles = records.filter((r) => r.roles.length === 0).length;
const roleCountDist = tally(records, (r) => `${r.roles.length} roles`);

writeFileSync(resolve(outPath), JSON.stringify({ ingested_at: new Date().toISOString(), source: argPath, count: records.length, records }, null, 2));

console.log(`ingest: read ${rows.length - 1} rows from ${argPath}`);
console.log(`ingest: shape = ${roleCols.length ? `wide (${roleCols.length} role columns)` : "functions list column"}`);
console.log(`ingest: ${records.length} unique records, ${dupes} duplicate NCR IDs merged (multi-RE rows)`);
console.log(`ingest: ${noRoles} records with no recognized role (review these)`);
console.log(`ingest: by region:`, tally(records, (r) => r.region ?? "(none)"));
console.log(`ingest: by role:`, tally(records, (r) => r.roles));
console.log(`ingest: role-count distribution:`, roleCountDist);
console.log(`ingest: wrote ${outPath} (feed this to the geocoding agent)`);
