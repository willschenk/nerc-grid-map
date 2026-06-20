// EIA / planning-area codes and other legacy abbreviations mapped to canonical
// NERC org records. Aliases attach to the target org at build time; they do not
// create duplicate dots.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, "../../data/nerc/area-aliases.json");

function loadAreaAliasFile(path = DEFAULT_PATH) {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? { aliases: raw } : raw;
}

export function loadAreaAliases(path = DEFAULT_PATH) {
  return loadAreaAliasFile(path).aliases ?? [];
}

/** Planning/interface codes that are not canonical org records. */
export function loadAreaInterfaces(path = DEFAULT_PATH) {
  return loadAreaAliasFile(path).interfaces ?? [];
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
  const addAcronymOwner = (code, ncrId) => {
    if (!code) return;
    const owners = acronymOwners.get(code);
    if (owners) owners.add(ncrId);
    else acronymOwners.set(code, new Set([ncrId]));
  };
  for (const o of orgs) {
    const ac = String(o.acronym ?? "").trim().toUpperCase();
    addAcronymOwner(ac, o.ncr_id);
    const ns = String(o.name_shortest ?? "").trim().toUpperCase();
    addAcronymOwner(ns, o.ncr_id);
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
    if (
      Object.prototype.hasOwnProperty.call(row, "allow_acronym_conflict") &&
      typeof row.allow_acronym_conflict !== "boolean"
    ) {
      errors.push(`area alias ${code} allow_acronym_conflict must be boolean`);
    }
    if (
      Object.prototype.hasOwnProperty.call(row, "market") &&
      (typeof row.market !== "string" || !row.market.trim())
    ) {
      errors.push(`area alias ${code} market must be a non-empty string`);
    }
    if (
      Object.prototype.hasOwnProperty.call(row, "kind") &&
      (typeof row.kind !== "string" || !row.kind.trim())
    ) {
      errors.push(`area alias ${code} kind must be a non-empty string`);
    }
    if (row.kind === "transmission_zone" && !String(row.market ?? "").trim()) {
      errors.push(`area alias ${code} transmission_zone is missing market`);
    }
    const owners = acronymOwners.get(code) ?? new Set();
    const conflicts = [...owners].filter((owner) => owner !== ncr_id);
    // An alias may legitimately share a code with a different org's acronym (e.g.
    // PJM "APS" = Allegheny Power vs. Arizona Public Service). Rows that
    // declare allow_acronym_conflict explicitly opt out of this guard; everything
    // else still errors so accidental mis-targets are caught.
    if (conflicts.length && row.allow_acronym_conflict !== true) {
      errors.push(`area alias ${code} conflicts with org acronym on ${conflicts.join(", ")}`);
    }
    if (!conflicts.length && row.allow_acronym_conflict === true) {
      errors.push(`area alias ${code} has unnecessary allow_acronym_conflict`);
    }
  }
  return errors;
}

export function validateAreaInterfaces(orgs, aliases = loadAreaAliases(), interfaces = loadAreaInterfaces()) {
  const errors = [];
  const aliasCodes = new Set(
    aliases.map((row) => String(row.code ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const acronymOwners = new Map();
  const addAcronymOwner = (code, ncrId) => {
    if (!code) return;
    const owners = acronymOwners.get(code);
    if (owners) owners.add(ncrId);
    else acronymOwners.set(code, new Set([ncrId]));
  };
  for (const o of orgs) {
    const ac = String(o.acronym ?? "").trim().toUpperCase();
    addAcronymOwner(ac, o.ncr_id);
    const ns = String(o.name_shortest ?? "").trim().toUpperCase();
    addAcronymOwner(ns, o.ncr_id);
  }

  const seen = new Map();
  for (const row of interfaces) {
    const code = String(row.code ?? "").trim().toUpperCase();
    if (!code) {
      errors.push("area interface missing code");
      continue;
    }
    if (seen.has(code)) {
      errors.push(`duplicate area interface code: ${code}`);
      continue;
    }
    seen.set(code, true);
    if (aliasCodes.has(code)) {
      errors.push(`area interface ${code} conflicts with org alias`);
    }
    const owners = acronymOwners.get(code);
    if (owners?.size) {
      errors.push(`area interface ${code} conflicts with org acronym on ${[...owners].join(", ")}`);
    }
  }
  return errors;
}
