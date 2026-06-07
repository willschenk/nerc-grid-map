#!/usr/bin/env node
// Backfill locations[] on geocoded and supplemental source records.
// Rank 1 copies current lat/lng + geo fields; ranks 2–3 are empty placeholders.
//
// Usage: node scripts/nerc/migrate-locations.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function round4(n) {
  return n == null ? null : Math.round(n * 1e4) / 1e4;
}

function emptySlot(rank) {
  return {
    rank,
    role: rank === 1 ? "headquarters" : "alternate",
    lat: null,
    lng: null,
    headquarters_address: null,
    city: null,
    state: null,
    country: null,
    geo_confidence: null,
    geo_source: null,
    geo_source_url: null,
    geo_notes: null,
  };
}

function primaryFromRecord(rec) {
  return {
    rank: 1,
    role: "headquarters",
    lat: round4(rec.lat),
    lng: round4(rec.lng),
    headquarters_address: rec.headquarters_address ?? null,
    city: rec.city ?? null,
    state: rec.state ?? null,
    country: rec.country ?? "US",
    geo_confidence: rec.geo_confidence ?? rec.confidence ?? null,
    geo_source: rec.geo_source ?? rec.source ?? null,
    geo_source_url: rec.geo_source_url ?? rec.source_url ?? null,
    geo_notes: rec.geo_notes ?? rec.notes ?? null,
  };
}

function migrateRecord(rec) {
  if (Array.isArray(rec.locations) && rec.locations.length === 3) return { rec, changed: false };
  const primary =
    Array.isArray(rec.locations) && rec.locations.find((l) => l.rank === 1)
      ? rec.locations.find((l) => l.rank === 1)
      : primaryFromRecord(rec);
  return {
    rec: {
      ...rec,
      locations: [primary, emptySlot(2), emptySlot(3)],
    },
    changed: true,
  };
}

function migrateFile(path, listKey = null) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const list = listKey ? raw[listKey] : Array.isArray(raw) ? raw : raw.orgs;
  if (!Array.isArray(list)) throw new Error(`No array in ${path}`);
  let changed = 0;
  const out = list.map((rec) => {
    const { rec: next, changed: c } = migrateRecord(rec);
    if (c) changed++;
    return next;
  });
  const payload = listKey ? { ...raw, [listKey]: out } : Array.isArray(raw) ? out : { ...raw, orgs: out };
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
  console.log(`migrate-locations: ${path.replace(root + "/", "")} — ${changed} updated, ${list.length} total`);
  return changed;
}

const geocoded = resolve(root, "src/data/nerc/geocoded-orgs.json");
const supplemental = resolve(root, "src/data/nerc/supplemental-orgs.json");
migrateFile(geocoded, "orgs");
migrateFile(supplemental);
