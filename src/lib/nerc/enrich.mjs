// Build-time enrichment. Turns a geocoded NCR record into a render-ready org:
// normalized roles, weight, precomputed color, and classification flags.
// The map renderer never recomputes these. (Spec Parts 2.2, 3.2, 3.3.)

import {
  ROLE_WEIGHTS,
  ROLE_ANCHORS,
  RAW_ROLE_MAP,
  KNOWN_ROLES,
  PUBLIC_ROLES,
} from "./roles.mjs";

const KNOWN = new Set(KNOWN_ROLES);
const PUBLIC = new Set(PUBLIC_ROLES);

// Raw role label -> normalized tag. Handles the NCR Matrix column names plus
// the "GO-1", "GO Category 2", "GOP2" style variants. Unknown tags are dropped.
// (Spec Part 2.1: GO Category 1 + GO Category 2 collapse to a single "GO".)
export function normalizeRoles(rawRoles) {
  if (!Array.isArray(rawRoles)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of rawRoles) {
    if (raw == null) continue;
    const key = String(raw).toUpperCase().replace(/\s+/g, " ").trim();
    let tag = RAW_ROLE_MAP[key];
    if (!tag) {
      // Strip a trailing category/version marker: " CATEGORY 2", "-2", " 2", "2".
      const base = key.replace(/[\s-]*(CATEGORY)?[\s-]*\d+$/i, "").trim();
      tag = RAW_ROLE_MAP[base] ?? (KNOWN.has(base) ? base : undefined);
    }
    if (tag && KNOWN.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

// Sum of role weights. (Spec Part 3.2.)
export function orgWeight(roles) {
  return roles.reduce((sum, r) => sum + (ROLE_WEIGHTS[r] ?? 1), 0);
}

// Weighted centroid of role anchors in HSL space. Identical role sets always
// yield the identical string; nearby role sets yield nearby colors. Hue is
// averaged on the circle to avoid wrap-around artifacts. (Spec Part 3.3.3.)
export function roleSetColor(roles) {
  if (!roles || roles.length === 0) return "hsl(0, 0%, 60%)";

  let totalWeight = 0;
  let sumH_sin = 0, sumH_cos = 0, sumS = 0, sumL = 0;

  for (const role of roles) {
    const anchor = ROLE_ANCHORS[role];
    if (!anchor) continue;
    const w = ROLE_WEIGHTS[role] ?? 1;
    const hRad = (anchor[0] * Math.PI) / 180;
    sumH_sin += Math.sin(hRad) * w;
    sumH_cos += Math.cos(hRad) * w;
    sumS += anchor[1] * w;
    sumL += anchor[2] * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return "hsl(0, 0%, 60%)";

  const hDeg = (Math.atan2(sumH_sin / totalWeight, sumH_cos / totalWeight) * 180) / Math.PI;
  const h = (hDeg + 360) % 360;
  const s = sumS / totalWeight;
  const l = sumL / totalWeight;
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

// ISO/RTO scale: RC or BA at full authority pushes weight to ~35+. (Spec Part 3.2.)
export function isIsoRto(weight) {
  return weight >= 35;
}

// Private = holds no public grid role; only asset-owner / market roles. (Spec Part 5.)
export function isPrivate(roles) {
  return !roles.some((r) => PUBLIC.has(r));
}

const ISO_RTO_NAME = /\b(ISO|RTO|Independent System Operator|Interconnection|PJM|MISO|CAISO|NYISO|ERCOT|Reliability Council)\b/i;
const COOP_NAME = /\b(Cooperative|Co-?op|Electric Membership|G\s*&\s*T)\b/i;
const MUNI_NAME = /\b(Municipal|Public Power|Public Utility District|Utility District|PUD|City of|Town of|Electric Department|Light\s*&\s*Power|Light Department)\b/i;
const FEDERAL_NAME = /\b(Power Administration|Tennessee Valley Authority|Bonneville|Western Area Power|Southwestern Power|Southeastern Power|Bureau of Reclamation)\b/i;

const KNOWN_ACRONYMS = new Map([
  ["pjm interconnection", "PJM"],
  ["midcontinent independent system operator", "MISO"],
  ["california independent system operator", "CAISO"],
  ["southwest power pool", "SPP"],
  ["iso new england", "ISO-NE"],
  ["new york independent system operator", "NYISO"],
  ["electric reliability council of texas", "ERCOT"],
  ["pacific gas and electric", "PG&E"],
  ["southern california edison", "SCE"],
  ["san diego gas and electric", "SDG&E"],
  ["arizona public service", "APS"],
  ["public service company of colorado", "PSCo"],
  ["public service company of new mexico", "PNM"],
  ["nevada power", "NPC"],
  ["idaho power", "IPCO"],
  ["pacificorp", "PAC"],
  ["puget sound energy", "PSE"],
  ["portland general electric", "PGE"],
  ["el paso electric", "EPE"],
  ["public service electric and gas", "PSE&G"],
  ["oklahoma gas and electric", "OG&E"],
  ["tennessee valley authority", "TVA"],
  ["associated electric cooperative", "AECI"],
  ["jea", "JEA"],
  ["florida power and light", "FPL"],
  ["duke energy carolinas", "DEC"],
  ["duke energy progress", "DEP"],
  ["duke energy florida", "DEF"],
  ["georgia power", "GPC"],
  ["alabama power", "APC"],
  ["southern company services", "SCS"],
  ["tampa electric", "TECO"],
  ["virginia electric and power", "VEPCO"],
  ["commonwealth edison", "ComEd"],
  ["dte electric", "DTE"],
  ["consumers energy", "CE"],
  ["american electric power", "AEP"],
  ["indiana michigan power", "I&M"],
  ["ohio edison", "OE"],
  ["connecticut light and power", "CL&P"],
  ["niagara mohawk power", "NMPC"],
  ["new york power authority", "NYPA"],
  ["northern states power company minnesota", "NSP-MN"],
  ["northern states power minnesota", "NSP-MN"],
  ["basin electric power cooperative", "BEPC"],
  ["great river energy", "GRE"],
  ["omaha public power district", "OPPD"],
  ["southwestern public service", "SPS"],
  ["nebraska public power district", "NPPD"],
  ["evergy kansas central", "EKC"],
  ["oncor electric delivery", "Oncor"],
  ["cps energy", "CPS"],
  ["lower colorado river authority", "LCRA"],
  ["aep texas", "AEP TX"],
  ["bonneville power administration", "BPA"],
  ["western area power administration", "WAPA"],
  ["tri state generation and transmission", "Tri-State"],
  ["luminant generation", "Luminant"],
  ["calpine", "Calpine"],
  ["sunflower electric power", "SEPC"],
  ["deseret generation and transmission", "DG&T"],
]);

const LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|lp|l\.p|company|co|corporation|corp|services|service|association|assn|limited|ltd)\b/gi;
const LIGHT_LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|lp|l\.p|corporation|corp|limited|ltd)\b/gi;
const ACRONYM_STOP = new Set(["THE", "OF", "AND", "FOR", "A", "AN", "DE"]);

function nameKey(name) {
  return String(name || "")
    .replace(/&/g, " and ")
    .replace(/[.,-]/g, " ")
    .replace(LIGHT_LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/i, "")
    .toLowerCase();
}

function cleanNameForAcronym(name) {
  return String(name || "")
    .replace(/&/g, " and ")
    .replace(/[.,-]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferAcronym(entityName) {
  const rawKey = nameKey(entityName);
  for (const [key, value] of KNOWN_ACRONYMS) {
    if (rawKey === key || rawKey.startsWith(`${key} `)) return value;
  }

  const clean = cleanNameForAcronym(entityName);
  if (!clean) return "ORG";

  const lower = clean.toLowerCase();
  for (const [key, value] of KNOWN_ACRONYMS) {
    if (lower === key || lower.startsWith(`${key} `)) return value;
  }

  const parenthetical = String(entityName || "").match(/\(([A-Z0-9&/-]{2,12})\)/);
  if (parenthetical) return parenthetical[1];

  const words = clean.split(/\s+/).filter((w) => w && !ACRONYM_STOP.has(w.toUpperCase()));
  if (words.length === 1) {
    const word = words[0].replace(/[^A-Za-z0-9&/-]/g, "");
    return word.length <= 8 ? word : word.slice(0, 6).toUpperCase();
  }

  const initials = words.map((w) => w[0]).join("").toUpperCase();
  return initials.length > 8 ? initials.slice(0, 8) : initials;
}

export function inferAcronymSource(entityName) {
  const rawKey = nameKey(entityName);
  for (const key of KNOWN_ACRONYMS.keys()) {
    if (rawKey === key || rawKey.startsWith(`${key} `)) return "common_market_name";
  }
  const clean = cleanNameForAcronym(entityName).toLowerCase();
  for (const key of KNOWN_ACRONYMS.keys()) {
    if (clean === key || clean.startsWith(`${key} `)) return "common_market_name";
  }
  return "name_initialism";
}

// Best-effort org type from name + roles. Seed records may set org_type explicitly;
// this is the fallback for ingested data. (Spec Part 2.2 org_type.)
export function inferOrgType(entityName, roles, weight) {
  const name = entityName || "";
  if (isIsoRto(weight) || ISO_RTO_NAME.test(name)) return "ISO_RTO";
  if (FEDERAL_NAME.test(name)) return "federal";
  if (COOP_NAME.test(name)) return "cooperative";
  if (MUNI_NAME.test(name)) return "municipal";
  if (isPrivate(roles)) return "merchant";
  if (roles.includes("LSE") || roles.includes("DP")) return "IOU";
  if (/\b(Company|Corporation|Energy|Electric|Power)\b/i.test(name)) return "IOU";
  return "other";
}

const VALID_CONFIDENCE = new Set(["HIGH", "MEDIUM", "LOW", "ESTIMATED"]);

// Reconcile the Part 1 (ESTIMATED) and Part 2 (NONE) vocabularies onto one scale.
function normalizeConfidence(c) {
  const up = String(c || "").toUpperCase();
  if (up === "NONE" || up === "") return "ESTIMATED";
  return VALID_CONFIDENCE.has(up) ? up : "ESTIMATED";
}

function round4(n) {
  return n == null ? null : Math.round(n * 1e4) / 1e4;
}

// Geocoded record -> final NERCOrg. Accepts raw or already-normalized roles.
// (Spec Part 2.2 schema + Part 3.2/3.3 precompute step.)
export function enrichOrg(rec) {
  const roles = normalizeRoles(rec.roles);
  const weight = orgWeight(roles);
  const color = roleSetColor(roles);
  const confidence = normalizeConfidence(rec.geo_confidence ?? rec.confidence);
  const acronym = rec.acronym ? String(rec.acronym).trim() : inferAcronym(rec.entity_name);
  const acronymSource = rec.acronym_source ?? (rec.acronym ? null : inferAcronymSource(rec.entity_name));

  return {
    // Identity
    ncr_id: rec.ncr_id,
    entity_name: rec.entity_name,
    acronym,
    acronym_source: acronymSource,

    // Classification
    region: rec.region ?? null,
    roles,
    role_count: roles.length,
    is_private: isPrivate(roles),

    // Location
    lat: round4(rec.lat),
    lng: round4(rec.lng),
    headquarters_address: rec.headquarters_address ?? null,
    city: rec.city ?? null,
    state: rec.state ?? null,
    country: rec.country ?? "US",

    // Geocoding metadata
    geo_confidence: confidence,
    geo_source: rec.geo_source ?? rec.source ?? null,
    geo_source_url: rec.geo_source_url ?? rec.source_url ?? null,
    geo_notes: rec.geo_notes ?? rec.notes ?? "",
    geo_needs_review: rec.geo_needs_review ?? (confidence === "ESTIMATED" || confidence === "LOW"),

    // Computed
    weight,
    color,
    is_iso_rto: isIsoRto(weight),
    org_type: rec.org_type ?? inferOrgType(rec.entity_name, roles, weight),
    parent_org: rec.parent_org ?? null,
    eia_utility_id: rec.eia_utility_id ?? null,

    // Provenance: seed records carry placeholder NCR IDs until official ingest.
    seed: rec.seed === true,
  };
}
