// Build-time enrichment. Turns a geocoded NCR record into a render-ready org:
// normalized roles, weight, precomputed color, and classification flags.
// The map renderer never recomputes these.

import {
  ROLE_WEIGHTS,
  ROLE_ANCHORS,
  RAW_ROLE_MAP,
  KNOWN_ROLES,
  PUBLIC_ROLES,
  normalizeRegion,
} from "./roles.mjs";
import { isCoordInScope } from "./geography-scope.mjs";

const KNOWN = new Set(KNOWN_ROLES);
const PUBLIC = new Set(PUBLIC_ROLES);

// Raw role label -> normalized tag. Handles the NCR Matrix column names plus
// the "GO-1", "GO Category 2", "GOP2" style variants. Unknown tags are dropped.
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

// Sum of role weights.
export function orgWeight(roles) {
  return roles.reduce((sum, r) => sum + (ROLE_WEIGHTS[r] ?? 1), 0);
}

// Weighted centroid of role anchors in HSL space. Identical role sets always
// yield the identical string; nearby role sets yield nearby colors. Hue is
// averaged on the circle to avoid wrap-around artifacts.
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

// ISO/RTO scale: RC or BA at full authority pushes weight to ~35+.
export function isIsoRto(weight) {
  return weight >= 35;
}

// Private = holds no public grid role; only asset-owner / market roles.
export function isPrivate(roles) {
  return !roles.some((r) => PUBLIC.has(r));
}

const ISO_RTO_NAME = /\b(ISO|RTO|Independent System Operator|Interconnection|PJM|MISO|CAISO|NYISO|ERCOT|Reliability Council)\b/i;
const COOP_NAME = /\b(Cooperative|Co-?op|Electric Membership|G\s*&\s*T)\b/i;
const MUNI_NAME = /\b(Municipal|Public Power|Public Utility District|Utility District|PUD|City of|Town of|Electric Department|Light\s*&\s*Power|Light Department)\b/i;
const FEDERAL_NAME = /\b(Power Administration|Tennessee Valley Authority|Bonneville|Western Area Power|Southwestern Power|Southeastern Power|Bureau of Reclamation)\b/i;

const SHORT_NAME_OVERRIDES = new Map([
  // Curated map labels keyed by entity_name; wins over the org-names table and the
  // algorithmic shortener. Keep values within the map's compact-label budget.
  ["Duke Energy Ohio-Kentucky", "CIN"],
  ["Evergy Missouri West", "EMW"],
]);
const RESERVED_SHORT_NAMES = new Set(["HE", "SC", "SMT", "WR"]);

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
  ["garkane energy cooperative", "Garkane"],
  ["moon lake electric association", "MoonLake"],
  ["dixie power", "Dixie"],
  ["flowell electric association", "Flowell"],
  ["bridger valley electric association", "BVEA"],
  ["lower valley energy", "LVE"],
  ["central new mexico electric cooperative", "CNMEC"],
  ["central valley electric cooperative", "CVEC"],
  ["jemez mountains electric cooperative", "Jemez"],
  ["kit carson electric cooperative", "KCEC"],
  ["mora san miguel electric cooperative", "Mora"],
  ["northern rio arriba electric cooperative", "NORA"],
  ["otero county electric cooperative", "Otero"],
  ["roosevelt county rural electric cooperative", "RCEC"],
  ["heart of texas electric cooperative", "HOTEC"],
  ["mid-south synergy", "MidSouth"],
  ["j-a-c electric cooperative", "JAC"],
  ["deaf smith electric cooperative", "DeafSmth"],
  ["coserv electric", "CoServ"],
  ["mountain view electric association", "MtnView"],
  ["san miguel power association", "SMPA"],
  ["y-w electric association", "Y-W"],
  ["southeast colorado power association", "SECPA"],
  ["sangre de cristo electric association", "Sangre"],
  ["escambia river electric cooperative", "EREC"],
  ["choctawhatchee electric cooperative", "CHELCO"],
  ["west florida electric cooperative", "WFEC"],
  ["gulf coast electric cooperative", "GCEC"],
  ["talquin electric cooperative", "Talquin"],
  ["tri county electric cooperative", "TCEC"],
  ["suwannee valley electric cooperative", "SVEC"],
  ["okefenoke rural electric membership", "Okefenke"],
  ["clay electric cooperative", "Clay EC"],
  ["central florida electric cooperative", "CFEC"],
  ["seco energy", "SECO"],
  ["withlacoochee river electric cooperative", "WREC"],
  ["peace river electric cooperative", "PRECO"],
  ["glades electric cooperative", "Glades"],
  ["anza electric cooperative", "Anza EC"],
  ["surprise valley electrification", "SurprisV"],
  ["bear valley electric service", "BearVly"],
  ["moreno valley utility", "MVU"],
  ["rancho cucamonga municipal utility", "RCMU"],
  ["victorville municipal utilities services", "Victorvl"],
  ["truckee donner public utility district", "Truckee"],
  ["trinity public utility district", "Trinity"],
  ["wells rural electric", "Wells"],
  ["mt wheeler power", "MtWheelr"],
  ["harney electric cooperative", "Harney"],
  ["raft river rural electric cooperative", "RaftRivr"],
  ["alamo power district", "Alamo PD"],
  ["central lincoln people s utility district", "CentLinc"],
  ["clatskanie people s utility district", "Clatskan"],
  ["columbia river people s utility district", "CRPUD"],
  ["emerald people s utility district", "Emerald"],
  ["tillamook people s utility district", "Tillamok"],
  ["blachly lane electric cooperative", "Blachly"],
  ["columbia basin electric cooperative", "ColBasin"],
  ["columbia power cooperative", "ColPower"],
  ["consumers power", "Consumrs"],
  ["coos curry electric cooperative", "Coos EC"],
  ["douglas electric cooperative", "Douglas"],
  ["hood river electric cooperative", "HoodRivr"],
  ["lane electric cooperative", "Lane EC"],
  ["midstate electric cooperative", "Midstate"],
  ["wasco electric cooperative", "Wasco EC"],
  ["west oregon electric cooperative", "WOregon"],
  ["clearwater power", "Clearwtr"],
  ["springfield utility board", "SUB"],
  ["mcminnville water", "McMinnvl"],
  ["forest grove light", "ForestGr"],
  ["ferry county public utility district", "FerryPUD"],
  ["franklin county public utility district", "Franklin"],
  ["pacific county pud no 2", "Pacific2"],
  ["benton rural electric association", "BentnREA"],
  ["big bend electric cooperative", "BigBend"],
  ["columbia rural electric association", "ColREA"],
  ["inland power", "Inland"],
  ["lakeview light", "Lakeview"],
  ["modern electric water", "Modern"],
  ["nespelem valley electric cooperative", "Nespelem"],
  ["okanogan county electric cooperative", "OkanEC"],
  ["orcas power", "OPALCO"],
  ["peninsula light", "PenLight"],
  ["tanner electric cooperative", "Tanner"],
  ["elmhurst mutual", "Elmhurst"],
  ["ohop mutual light", "Ohop"],
  ["parkland light", "Parkland"],
  ["vera water", "Vera"],
  ["beartooth electric cooperative", "Beartoth"],
  ["big horn county electric cooperative", "BigHorn"],
  ["fergus electric cooperative", "Fergus"],
  ["flathead electric cooperative", "Flathead"],
  ["lincoln electric cooperative", "LincolnE"],
  ["marias river electric cooperative", "Marias"],
  ["missoula electric cooperative", "Missoula"],
  ["park electric cooperative", "Park EC"],
  ["ravalli electric cooperative", "Ravalli"],
  ["sun river electric cooperative", "SunRiver"],
  ["vigilante electric cooperative", "Vigilant"],
  ["yellowstone valley electric cooperative", "YVEC"],
  ["big flat electric cooperative", "Big Flat"],
  ["goldenwest electric cooperative", "Goldnwst"],
  ["lower yellowstone rural electric cooperative", "LYREC"],
  ["mccone electric cooperative", "McCone"],
  ["mid yellowstone electric cooperative", "MidYello"],
  ["norval electric cooperative", "NorVal"],
  ["southeast electric cooperative", "SE Elec"],
  ["tongue river electric cooperative", "TongueR"],
  ["idaho county light", "IdahoCo"],
  ["kootenai electric cooperative", "Kootenai"],
  ["lost river electric cooperative", "LostRivr"],
  ["northern lights", "NorthLts"],
  ["riverside electric", "Riversde"],
  ["salmon river electric cooperative", "SalmonR"],
  ["south side electric", "SouthSid"],
  ["united electric", "UnitedE"],
  ["burke divide electric", "BurkeDiv"],
  ["capital electric cooperative", "Capital"],
  ["cass county electric", "CassCnty"],
  ["cavalier rural electric", "CavalirR"],
  ["dakota valley electric", "DakVally"],
  ["kem electric cooperative", "KEM"],
  ["mclean electric cooperative", "McLean"],
  ["mor gran sou electric", "MorGrSou"],
  ["north central electric cooperative", "NCentral"],
  ["northern plains electric cooperative", "NPlains"],
  ["nodak electric", "Nodak"],
  ["slope electric cooperative", "Slope"],
  ["verendrye electric", "Verendry"],
  ["west plains electric cooperative", "WPlains"],
  ["black hills electric cooperative", "BlackHil"],
  ["bon homme yankton electric", "BonHomme"],
  ["butte electric cooperative", "Butte EC"],
  ["cam wal electric", "Cam Wal"],
  ["charles mix electric", "CharlMix"],
  ["clay union electric", "ClayUnin"],
  ["codington clark electric", "CodClark"],
  ["dakota energy cooperative", "DakEnrgy"],
  ["fem electric association", "FEM"],
  ["h d electric cooperative", "H-D Elec"],
  ["kingsbury electric cooperative", "Kingsbry"],
  ["lacreek electric", "Lacreek"],
  ["lake region electric association", "LakeRegn"],
  ["moreau grand electric", "MoreauGr"],
  ["northern electric cooperative", "NorthrnE"],
  ["oahe electric cooperative", "Oahe"],
  ["sioux valley energy", "SiouxVal"],
  ["southeastern electric cooperative", "SE ElecS"],
  ["traverse electric cooperative", "Traverse"],
  ["union county electric", "UnionCty"],
  ["west central electric cooperative", "WCentral"],
  ["whetstone valley electric", "Whetstn"],
  ["big horn rural electric", "BHREC"],
  ["carbon power", "Carbon"],
  ["garland light", "Garland"],
  ["high plains power", "HiPlains"],
  ["high west energy", "HighWest"],
  ["niobrara electric", "Niobrara"],
  ["wheatland rural electric", "WheatREA"],
  ["wyrulec", "Wyrulec"],
  ["midwest electric cooperative", "MidwstEl"],
  ["niobrara valley electric membership", "NiobVall"],
  ["panhandle rural electric membership", "PREMA"],
  ["4 rivers electric cooperative", "4Rivers"],
  ["bluestem electric cooperative", "Bluestem"],
  ["brown atchison electric", "BrownAtc"],
  ["butler electric cooperative", "ButlerEC"],
  ["caney valley electric", "CaneyVal"],
  ["cms electric cooperative", "CMS"],
  ["doniphan electric cooperative", "Doniphan"],
  ["dso electric cooperative", "DSO Elec"],
  ["flint hills rural electric", "FlintHil"],
  ["freestate electric cooperative", "FreeStat"],
  ["heartland rural electric cooperative", "HeartlnK"],
  ["lane scott electric", "LaneScot"],
  ["nemaha marshall electric", "NemMarsh"],
  ["ninnescah electric cooperative", "Ninnesch"],
  ["prairie land electric cooperative", "PrairieL"],
  ["rolling hills electric cooperative", "RollHill"],
  ["sedgwick county electric", "SedgwkCo"],
  ["sumner cowley electric", "SumCowly"],
  ["victory electric cooperative", "Victory"],
  ["western cooperative electric", "WestrnKS"],
]);

const LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|lp|l\.p|company|co|corporation|corp|services|service|association|assn|limited|ltd)\b/gi;
const LIGHT_LEGAL_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|lp|l\.p|corporation|corp|limited|ltd)\b/gi;
const ACRONYM_STOP = new Set(["THE", "OF", "AND", "FOR", "A", "AN", "DE"]);
const SHORT_NAME_DROP = new Set(["THE", "OF", "AND", "FOR", "A", "AN", "AS", "AT", "BY", "IN", "TO"]);
const SHORT_NAME_UTILITY = new Set([
  "AUTHORITY",
  "ASSOCIATION",
  "COMMISSION",
  "COOPERATIVE",
  "DEPARTMENT",
  "DISTRICT",
  "DIVISION",
  "ELECTRIC",
  "ENERGY",
  "GENERATING",
  "GENERATION",
  "LIGHT",
  "MUNICIPAL",
  "POWER",
  "PUBLIC",
  "SERVICES",
  "SYSTEM",
  "TRANSMISSION",
  "UTILITIES",
  "UTILITY",
  "WATER",
  "WORKS",
]);
const GOVERNMENT_PREFIX = /^(city|town|village|borough|county|municipality)\s+(of|and)\s+/i;

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

function compactShortSource(rec) {
  return String(rec.name_shortest || rec.acronym || rec.entity_name || "ORG")
    .replace(/\s+as agent\b.*$/i, "")
    .replace(/\bd\/b\/a\b.*$/i, "")
    .replace(/[,;].*$/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(GOVERNMENT_PREFIX, "")
    .trim();
}

function compactShortWords(source) {
  return cleanNameForAcronym(source)
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .filter((w) => !SHORT_NAME_DROP.has(w.toUpperCase()));
}

function compactFromWords(words) {
  const keyWords = words.filter((w) => !SHORT_NAME_UTILITY.has(w.toUpperCase()));
  const selected = keyWords.length ? keyWords : words;
  if (selected.length === 1) {
    const word = selected[0];
    if (word.length <= 6) return word;
    return word.replace(/[aeiou]/gi, "").slice(0, 6).toUpperCase() || word.slice(0, 6).toUpperCase();
  }
  return selected
    .slice(0, 5)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function expandReservedShortName(words, fallback) {
  const keyWords = words.filter((w) => !SHORT_NAME_UTILITY.has(w.toUpperCase()));
  const selected = keyWords.length ? keyWords : words;
  const expanded = selected
    .slice(0, 3)
    .map((w) => {
      const clean = w.replace(/[^A-Za-z0-9]/g, "");
      if (/^[A-Z0-9]{2,4}$/.test(clean)) return clean;
      return clean.slice(0, Math.min(4, Math.max(2, clean.length))).toUpperCase();
    })
    .join("");
  return (expanded || fallback || "ORG").slice(0, 8);
}

function compactDisplayName(rec, acronym) {
  const override = SHORT_NAME_OVERRIDES.get(rec.entity_name);
  if (override) return override;

  const existing = rec.name_shortest != null ? String(rec.name_shortest).trim() : "";
  if (existing && existing.length <= 8) return existing;

  const compactAcronym = String(acronym || "").replace(/[^A-Za-z0-9&/-]/g, "");
  if (compactAcronym && compactAcronym.length <= 8 && !/\s/.test(acronym)) return acronym;

  const source = compactShortSource(rec);
  const known = (() => {
    const rawKey = nameKey(source);
    for (const [key, value] of KNOWN_ACRONYMS) {
      if (rawKey === key || rawKey.startsWith(`${key} `)) return value;
    }
    return null;
  })();
  if (known && known.length <= 8) return known;

  const words = compactShortWords(source);
  const generated = compactFromWords(words);
  if (RESERVED_SHORT_NAMES.has(String(generated).toUpperCase())) {
    return expandReservedShortName(words, generated);
  }
  return (generated || compactAcronym || "ORG").slice(0, 8);
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
// this is the fallback for ingested data.
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

function emptyLocationSlot(rank) {
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

function locationFromRecord(rec, rank) {
  const confidence = normalizeConfidence(rec.geo_confidence ?? rec.confidence);
  return {
    rank,
    role: rank === 1 ? "headquarters" : "alternate",
    lat: round4(rec.lat),
    lng: round4(rec.lng),
    headquarters_address: rec.headquarters_address ?? null,
    city: rec.city ?? null,
    state: rec.state ?? null,
    country: rec.country ?? "US",
    geo_confidence: confidence,
    geo_source: rec.geo_source ?? rec.source ?? null,
    geo_source_url: rec.geo_source_url ?? rec.source_url ?? null,
    geo_notes: rec.geo_notes ?? rec.notes ?? "",
  };
}

function normalizeLocationRow(loc, rank) {
  const confidence = loc.geo_confidence != null ? normalizeConfidence(loc.geo_confidence) : null;
  return {
    rank,
    role: loc.role ?? (rank === 1 ? "headquarters" : "alternate"),
    lat: round4(loc.lat),
    lng: round4(loc.lng),
    headquarters_address: loc.headquarters_address ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    country: loc.country ?? null,
    geo_confidence: confidence,
    geo_source: loc.geo_source ?? null,
    geo_source_url: loc.geo_source_url ?? null,
    geo_notes: loc.geo_notes ?? null,
  };
}

/** Three map-location slots per org; rank 1 required, ranks 2–3 optional fallbacks. */
export function normalizeLocations(rec) {
  const byRank = new Map();
  if (Array.isArray(rec.locations) && rec.locations.length) {
    for (const loc of rec.locations) {
      const rank = Number(loc.rank);
      if (rank >= 1 && rank <= 3) byRank.set(rank, normalizeLocationRow(loc, rank));
    }
  }
  const slots = [1, 2, 3].map((rank) => byRank.get(rank) ?? emptyLocationSlot(rank));
  if (slots[0].lat == null && rec.lat != null) {
    slots[0] = locationFromRecord(rec, 1);
  }
  return slots;
}

/** QA checks for the locations array on enriched org records. */
export function validateLocations(orgs) {
  const errors = [];
  const warnings = [];
  for (const o of orgs) {
    if (o.out_of_footprint) continue;
    const locs = o.locations;
    if (!Array.isArray(locs) || locs.length !== 3) {
      errors.push(`locations invalid: ${o.ncr_id} (expected 3 slots)`);
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const loc = locs[i];
      if (loc.rank !== i + 1) {
        errors.push(`locations rank mismatch: ${o.ncr_id} slot ${i + 1}`);
      }
    }
    const primary = locs[0];
    if (primary.lat == null || primary.lng == null) {
      errors.push(`locations rank 1 missing coords: ${o.ncr_id}`);
      continue;
    }
    if (primary.lat !== o.lat || primary.lng !== o.lng) {
      errors.push(`locations rank 1 != lat/lng: ${o.ncr_id}`);
    }
    for (const loc of locs.slice(1)) {
      if (loc.lat == null && loc.lng == null) continue;
      if (loc.lat == null || loc.lng == null) {
        errors.push(`locations partial coords: ${o.ncr_id} rank ${loc.rank}`);
      } else if (
        !isCoordInScope(loc.lat, loc.lng, loc.state || o.state, { outOfFootprint: o.out_of_footprint })
      ) {
        warnings.push(`locations out-of-range: ${o.ncr_id} rank ${loc.rank} (${loc.lat}, ${loc.lng})`);
      }
    }
    const shared = locs.filter((l) => l.lat != null).length === 1;
    if (shared && locs.slice(1).every((l) => l.lat == null)) {
      // rank-1-only is expected until alternates are researched
    }
  }
  return { errors, warnings };
}

// Geocoded record -> final NERCOrg. Accepts raw or already-normalized roles.
export function enrichOrg(rec) {
  const roles = normalizeRoles(rec.roles);
  const weight = orgWeight(roles);
  const color = roleSetColor(roles);
  const confidence = normalizeConfidence(rec.geo_confidence ?? rec.confidence);
  const acronym = rec.acronym ? String(rec.acronym).trim() : inferAcronym(rec.entity_name);
  const acronymSource = rec.acronym_source ?? (rec.acronym ? null : inferAcronymSource(rec.entity_name));
  const locations = normalizeLocations(rec);
  const primary = locations[0];

  return {
    // Identity
    ncr_id: rec.ncr_id,
    entity_name: rec.entity_name,
    acronym,
    acronym_source: acronymSource,
    // Researched three-tier display names from src/data/nerc/org-names.json.
    // The shortest tier is guaranteed and compact enough to fit early; longer
    // researched tiers remain available as bubbles grow.
    name_shortest: compactDisplayName(rec, acronym),
    name_short: rec.name_short ?? null,
    name_normal: rec.name_normal ?? null,
    name_major: rec.name_major === true,

    // Classification
    ...(() => {
      const primary = normalizeRegion(rec.region);
      const fromList = Array.isArray(rec.regions)
        ? rec.regions.map(normalizeRegion).filter(Boolean)
        : [];
      const regions = [...new Set([...(primary ? [primary] : []), ...fromList])].sort();
      const region = primary ?? regions[0] ?? null;
      return {
        region,
        ...(regions.length > 1 ? { regions } : {}),
      };
    })(),
    roles,
    role_count: roles.length,
    is_private: isPrivate(roles),

    // Location (canonical HQ = rank 1; alternates in locations[1..2])
    locations,
    lat: primary.lat ?? round4(rec.lat),
    lng: primary.lng ?? round4(rec.lng),
    headquarters_address: primary.headquarters_address ?? rec.headquarters_address ?? null,
    city: primary.city ?? rec.city ?? null,
    state: primary.state ?? rec.state ?? null,
    country: primary.country ?? rec.country ?? "US",

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
    // Supplemental (non-NERC) orgs set this false; they have no NERC ID and
    // their roles are a best-effort guess, not an official registration.
    nerc_registered: rec.nerc_registered !== false,
    // Out-of-footprint U.S. territories (PR/VI/GU/MP/AS) can't be placed on the
    // mainland Albers projection; the map shows them in labelled insets instead.
    out_of_footprint: rec.out_of_footprint === true,
  };
}
