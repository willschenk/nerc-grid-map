// EIA / planning-area codes and other legacy abbreviations mapped to canonical
// NERC org records. Aliases attach to the target org at build time; they do not
// create duplicate dots.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, "../../data/nerc/area-aliases.json");

export function loadAreaAliases(path = DEFAULT_PATH) {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? raw : raw.aliases ?? [];
}

/** alias code (uppercase) -> { ncr_id, meaning } */
export function areaAliasIndex(aliases = loadAreaAliases()) {
  const index = new Map();
  for (const row of aliases) {
    const code = String(row.code ?? "").trim().toUpperCase();
    const ncr_id = String(row.ncr_id ?? "").trim();
    if (!code || !ncr_id) continue;
    index.set(code, { ncr_id, meaning: row.meaning ?? null });
  }
  return index;
}

/** ncr_id -> sorted alias codes */
export function areaAliasesByOrg(aliases = loadAreaAliases()) {
  const byOrg = new Map();
  for (const row of aliases) {
    const code = String(row.code ?? "").trim().toUpperCase();
    const ncr_id = String(row.ncr_id ?? "").trim();
    if (!code || !ncr_id) continue;
    (byOrg.get(ncr_id) ?? byOrg.set(ncr_id, []).get(ncr_id)).push(code);
  }
  for (const codes of byOrg.values()) codes.sort();
  return byOrg;
}

export function applyAreaAliases(orgs, aliases = loadAreaAliases()) {
  const byOrg = areaAliasesByOrg(aliases);
  return orgs.map((org) => {
    const area_aliases = byOrg.get(org.ncr_id);
    return area_aliases?.length ? { ...org, area_aliases } : org;
  });
}

export function validateAreaAliases(orgs, aliases = loadAreaAliases()) {
  const errors = [];
  const orgIds = new Set(orgs.map((o) => o.ncr_id));
  const acronymOwners = new Map();
  for (const o of orgs) {
    const ac = String(o.acronym ?? "").trim().toUpperCase();
    if (ac) acronymOwners.set(ac, o.ncr_id);
    const ns = String(o.name_shortest ?? "").trim().toUpperCase();
    if (ns) acronymOwners.set(ns, o.ncr_id);
  }

  const seen = new Map();
  for (const row of aliases) {
    const code = String(row.code ?? "").trim().toUpperCase();
    const ncr_id = String(row.ncr_id ?? "").trim();
    if (!code) {
      errors.push("area alias missing code");
      continue;
    }
    if (seen.has(code)) {
      errors.push(`duplicate area alias code: ${code}`);
      continue;
    }
    seen.set(code, ncr_id);
    if (!ncr_id) {
      errors.push(`area alias ${code} missing ncr_id`);
      continue;
    }
    if (!orgIds.has(ncr_id)) {
      errors.push(`area alias ${code} targets missing org ${ncr_id}`);
      continue;
    }
    const owner = acronymOwners.get(code);
    if (owner && owner !== ncr_id) {
      errors.push(`area alias ${code} conflicts with org acronym on ${owner}`);
    }
  }
  return errors;
}
