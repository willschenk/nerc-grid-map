#!/usr/bin/env node
// Scan a batch of geocoded-orgs.json for co-located same-name duplicate candidates.
// Does not modify map-combines.json — reports only. Usage:
//   node scripts/nerc/review-map-combine-batch.mjs [batchNumber]
// Batch 1 = indices 0–99, batch 2 = 100–199, etc.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BATCH = Math.max(1, Number(process.argv[2] || 1));
const SIZE = 100;

const geo = JSON.parse(readFileSync(`${root}/src/data/nerc/geocoded-orgs.json`, "utf8")).orgs;
const twins = existsSync(`${root}/src/data/nerc/seed-twins.json`)
  ? JSON.parse(readFileSync(`${root}/src/data/nerc/seed-twins.json`, "utf8")).twins ?? {}
  : {};
const combines = existsSync(`${root}/src/data/nerc/map-combines.json`)
  ? JSON.parse(readFileSync(`${root}/src/data/nerc/map-combines.json`, "utf8")).combines ?? []
  : [];

const present = new Set(geo.map((o) => o.ncr_id));
const absorbed = new Set();
for (const c of combines) {
  if (c.canonical) absorbed.add(c.canonical);
  for (const id of c.members ?? []) absorbed.add(id);
}

const start = (BATCH - 1) * SIZE;
const batch = geo.slice(start, start + SIZE);

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|lp|co|company|corporation|the|of|and|l p|l l c)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" as agent")[0]
    .split(" d b a ")[0];
}

function distKm(a, b) {
  if (a.lat == null || b.lat == null) return Infinity;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(x)));
}

function isRetiredSeed(id) {
  const t = twins[id];
  return !!(t && t.some((x) => present.has(x)));
}

function isActive(o) {
  if (isRetiredSeed(o.ncr_id)) return false;
  if (o.lat == null) return false;
  return true;
}

const active = batch.filter(isActive);
const candidates = [];

for (let i = 0; i < active.length; i++) {
  for (let j = i + 1; j < active.length; j++) {
    const a = active[i];
    const b = active[j];
    const d = distKm(a, b);
    if (d > 8) continue;
    const na = normName(a.entity_name);
    const nb = normName(b.entity_name);
    const sameName = na === nb;
    const sharedAcronym =
      a.acronym &&
      b.acronym &&
      a.acronym.toLowerCase() === b.acronym.toLowerCase() &&
      a.acronym.length >= 3;
    if (!sameName && !sharedAcronym) continue;
    const already =
      (absorbed.has(a.ncr_id) && absorbed.has(b.ncr_id)) ||
      combines.some(
        (c) =>
          (c.canonical === a.ncr_id && c.members?.includes(b.ncr_id)) ||
          (c.canonical === b.ncr_id && c.members?.includes(a.ncr_id)),
      );
    candidates.push({ a, b, d, sameName, already });
  }
}

console.log(`Batch ${BATCH}: indices ${start}–${start + batch.length - 1} (${batch.length} rows, ${active.length} active)`);
if (batch.length) {
  console.log(`  First: ${batch[0].ncr_id} — ${batch[0].entity_name?.slice(0, 60)}`);
  console.log(`  Last:  ${batch[batch.length - 1].ncr_id} — ${batch[batch.length - 1].entity_name?.slice(0, 60)}`);
}

if (!candidates.length) {
  console.log("  No same-name / same-acronym pairs within 8 km.");
} else {
  console.log(`  ${candidates.length} candidate pair(s):`);
  for (const { a, b, d, already } of candidates) {
    console.log(`  - ${d.toFixed(2)} km  ${already ? "[already combined]" : "[NEW?]"}`);
    console.log(`      ${a.ncr_id}  ${a.entity_name?.slice(0, 70)}`);
    console.log(`      ${b.ncr_id}  ${b.entity_name?.slice(0, 70)}`);
  }
}

const nextStart = start + SIZE;
if (nextStart < geo.length) {
  console.log(`\nPAUSE: After batch ${BATCH}, next index is ${nextStart} (${geo[nextStart].ncr_id}).`);
} else {
  console.log("\nEnd of geocoded-orgs.json reached.");
}
