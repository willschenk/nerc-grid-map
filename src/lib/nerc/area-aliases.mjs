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
    if (row.kind === "transmission_zone" && row.market !== "PJM") {
      errors.push(`area alias ${code} transmission_zone requires market: PJM`);
    }
    if (row.market === "PJM" && row.kind !== "transmission_zone") {
      errors.push(`area alias ${code} market: PJM requires kind: transmission_zone`);
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

const DEFAULT_RENDERER_PATH = resolve(__dirname, "map/nerc-org-map.ts");

/** Parse PJM/MISO area-code sets from the map renderer (single source of truth). */
export function loadRendererMarketAreaCodes(rendererPath = DEFAULT_RENDERER_PATH) {
  const src = readFileSync(rendererPath, "utf8");
  const misoBlock = src.match(
    /const MISO_CONTROL_AREA_CODES = new Map<string, readonly string\[\]>\(\[([\s\S]*?)\]\);/,
  );
  const pjmBlock = src.match(/const PJM_TRANSMISSION_ZONE_CODES = new Set\(\[([\s\S]*?)\]\);/);
  if (!misoBlock) throw new Error("could not parse MISO_CONTROL_AREA_CODES from renderer");
  if (!pjmBlock) throw new Error("could not parse PJM_TRANSMISSION_ZONE_CODES from renderer");

  const miso = new Map();
  const entryRe = /\["([^"]+)",\s*\[([^\]]*)\]\]/g;
  for (const m of misoBlock[1].matchAll(entryRe)) {
    const codes = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1].toUpperCase());
    miso.set(m[1], codes);
  }

  const pjm = new Set([...pjmBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].toUpperCase()));
  return { miso, pjm };
}

/**
 * Cross-check area-aliases.json (and built org payloads) against the renderer's
 * PJM/MISO focus membership. Catches ALTE-style drift between data and UI logic.
 */
export function validateMarketAreaAliases(
  orgs,
  aliases = loadAreaAliases(),
  rendererPath = DEFAULT_RENDERER_PATH,
) {
  const errors = [];
  let renderer;
  try {
    renderer = loadRendererMarketAreaCodes(rendererPath);
  } catch (err) {
    return [`market area alias check: ${err.message}`];
  }

  const aliasByCode = new Map();
  for (const row of aliases) {
    const code = String(row.code ?? "").trim().toUpperCase();
    if (!code) continue;
    aliasByCode.set(code, row);
  }

  const orgIds = new Set(orgs.map((o) => o.ncr_id));
  const orgById = new Map(orgs.map((o) => [o.ncr_id, o]));

  for (const [ncrId, codes] of renderer.miso) {
    if (!orgIds.has(ncrId)) {
      errors.push(`MISO LBA org ${ncrId} in renderer but missing from built org data`);
      continue;
    }
    const builtAliases = new Set((orgById.get(ncrId)?.area_aliases ?? []).map((c) => c.toUpperCase()));
    for (const code of codes) {
      const row = aliasByCode.get(code);
      if (!row) {
        errors.push(`MISO LBA ${code} missing from area-aliases.json (renderer ${ncrId})`);
        continue;
      }
      if (row.ncr_id !== ncrId) {
        errors.push(`MISO LBA ${code} targets ${row.ncr_id}, renderer expects ${ncrId}`);
      }
      if (!builtAliases.has(code)) {
        errors.push(`MISO LBA ${code} not attached to ${ncrId} in built org payload`);
      }
    }
  }

  for (const code of renderer.pjm) {
    const row = aliasByCode.get(code);
    if (!row) {
      errors.push(`PJM zone ${code} missing from area-aliases.json`);
      continue;
    }
    if (row.market !== "PJM") {
      errors.push(`PJM zone ${code} missing market: PJM`);
    }
    if (row.kind !== "transmission_zone") {
      errors.push(`PJM zone ${code} missing kind: transmission_zone`);
    }
    if (!orgIds.has(row.ncr_id)) {
      errors.push(`PJM zone ${code} targets missing org ${row.ncr_id}`);
      continue;
    }
    const builtAliases = new Set((orgById.get(row.ncr_id)?.area_aliases ?? []).map((c) => c.toUpperCase()));
    if (!builtAliases.has(code)) {
      errors.push(`PJM zone ${code} not attached to ${row.ncr_id} in built org payload`);
    }
  }

  for (const row of aliases) {
    const code = String(row.code ?? "").trim().toUpperCase();
    if (row.market === "PJM" && row.kind === "transmission_zone" && !renderer.pjm.has(code)) {
      errors.push(
        `area alias ${code} is PJM transmission_zone but not in renderer PJM_TRANSMISSION_ZONE_CODES`,
      );
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
