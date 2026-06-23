import { ROLE_FULL_NAMES } from "../roles.mjs";
import { MAP_LABEL_MAX, compressSpacedBrand, tightenMapLabel } from "../display-names.mjs";

type DisplayOrg = {
  ncr_id: string;
  entity_name: string;
  acronym?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  headquarters_address?: string | null;
  region?: string | null;
  regions?: string[];
  roles: string[];
  nerc_registered?: boolean;
  combined_members?: Array<{
    ncr_id: string;
    entity_name: string;
    region: string | null;
    roles: string[];
  }>;
  map_combine_label?: string;
  name_shortest?: string | null;
  name_short?: string | null;
  name_normal?: string | null;
  _tiny?: string;
};

export const TYPE_LABELS: Record<string, string> = {
  ISO_RTO: "ISO / RTO",
  IOU: "Investor-owned utility",
  cooperative: "Electric cooperative",
  municipal: "Municipal / public power",
  federal: "Federal power authority",
  merchant: "Merchant / IPP",
  cca: "Community choice (CCA)",
  other: "Other",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  ESTIMATED: "Estimated",
};

const PRIMARY_ROLE_ORDER = [
  "RC",
  "BA",
  "PC",
  "TOP",
  "TSP",
  "TP",
  "TO",
  "DP",
  "LSE",
  "RP",
  "RSG",
  "FRSG",
  "RRSG",
  "GO",
  "GOP",
  "PSE",
];
const PRIMARY_ROLE_RANK = new Map(PRIMARY_ROLE_ORDER.map((role, i) => [role, i]));

function shortName(name: string): string {
  return name
    .replace(/,?\s+(LLC|Inc\.?|L\.?P\.?|Corporation|Company|Co\.?|Services?)$/i, "")
    .replace(/^The\s+/i, "")
    .trim();
}

function fallbackAcronym(name: string): string {
  const cleaned = shortName(name).replace(/&/g, " and ").replace(/[.,-]/g, " ");
  const words = cleaned
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|and|for|a|an)$/i.test(w));
  if (words.length === 1) return words[0].length <= 8 ? words[0] : words[0].slice(0, 6).toUpperCase();
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 8);
}

const WEAK_MAP_LABELS = new Set([
  "A",
  "AN",
  "AND",
  "AT",
  "BY",
  "CO",
  "COMPANY",
  "COOP",
  "COOPERATIVE",
  "CORP",
  "CORPORATION",
  "EAST",
  "ELECTRIC",
  "ENERGY",
  "FOR",
  "GAS",
  "GENERATION",
  "GENERATING",
  "LIGHT",
  "NEW",
  "NORTH",
  "OF",
  "OLD",
  "ONE",
  "POWER",
  "SOUTH",
  "THE",
  "TO",
  "UTILITY",
  "UTILITIES",
  "WATER",
  "WEST",
]);

function isWeakMapLabel(text: string | null | undefined): boolean {
  const token = String(text ?? "").trim();
  if (!token) return true;
  const clean = token.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!clean || /\d/.test(clean)) return false;
  return WEAK_MAP_LABELS.has(clean);
}

function compactMapLabel(text: string | null | undefined, maxLen = MAP_LABEL_MAX): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (raw.length <= maxLen && !isWeakMapLabel(raw)) return raw;
  const tightened = tightenMapLabel(raw, maxLen);
  if (tightened && tightened.length <= maxLen && !isWeakMapLabel(tightened)) {
    return tightened;
  }
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = tightenMapLabel(words[0], maxLen);
    if (first && first.length <= maxLen && !isWeakMapLabel(first)) return first;
    const initials = words.map((w) => w[0]).join("").toUpperCase().slice(0, maxLen);
    if (initials.length >= 2 && !isWeakMapLabel(initials)) return initials;
  }
  return null;
}

// Three-tier names for map text. The full legal entity_name remains in the panel.
const NAME_RULES: Array<[RegExp, { tiny: string; mid: string }]> = [
  [/^consolidated edison/i, { tiny: "ConEd", mid: "Con Edison" }],
  [/^american electric power/i, { tiny: "AEP", mid: "AEP" }],
  [/^firstenergy/i, { tiny: "FE", mid: "FirstEnergy" }],
  [/^(public service enterprise group|pseg|p\.?s\.?e\.?&?g)/i, { tiny: "PSEG", mid: "PSEG" }],
  [/^northern states power|\bxcel energy\b/i, { tiny: "Xcel", mid: "Xcel" }],
  [/^pacificorp/i, { tiny: "PacCorp", mid: "PacifiCorp" }],
  [/^next\s?era/i, { tiny: "NextEra", mid: "NextEra" }],
  [/^duke energy/i, { tiny: "Duke", mid: "Duke" }],
  [/^dominion/i, { tiny: "Dominion", mid: "Dominion" }],
  [/^southern (company|co\b)/i, { tiny: "Southern", mid: "Southern Co" }],
  [/^entergy/i, { tiny: "Entergy", mid: "Entergy" }],
  [/^ameren/i, { tiny: "Ameren", mid: "Ameren" }],
  [/^exelon/i, { tiny: "Exelon", mid: "Exelon" }],
  [/^berkshire hathaway energy|^midamerican/i, { tiny: "MidAm", mid: "MidAmerican" }],
  [/^national grid/i, { tiny: "NatGrid", mid: "Nat. Grid" }],
  [/^tennessee valley/i, { tiny: "TVA", mid: "TVA" }],
  [/^bonneville power/i, { tiny: "BPA", mid: "Bonneville (BPA)" }],
  [/^los angeles department of water/i, { tiny: "LADWP", mid: "LADWP" }],
  [/^salt river project/i, { tiny: "SRP", mid: "Salt River Project" }],
  [/^arizona public service/i, { tiny: "APS", mid: "Arizona Public Svc" }],
  [/^public service company of colorado/i, { tiny: "PSCo", mid: "PSCo (Xcel)" }],
  [/^puget sound energy/i, { tiny: "PSE", mid: "Puget Sound" }],
  [/^portland general electric/i, { tiny: "PGE", mid: "Portland General" }],
  [/^pacific gas and electric/i, { tiny: "PG&E", mid: "PG&E" }],
  [/^southern california edison/i, { tiny: "SCE", mid: "SoCal Edison" }],
  [/^potomac edison/i, { tiny: "Potomac", mid: "Potomac Ed" }],
  [/^ohio edison/i, { tiny: "Ohio", mid: "Ohio Ed" }],
  [/^toledo edison/i, { tiny: "Toledo", mid: "Toledo Ed" }],
  [/^potomac electric power|^pepco\b/i, { tiny: "PEPCO", mid: "PEPCO" }],
  [/^jersey central power/i, { tiny: "JCP&L", mid: "JCP&L" }],
  [/^monongahela power/i, { tiny: "Mon Power", mid: "Mon Power" }],
  [/^san diego gas/i, { tiny: "SDG&E", mid: "SDG&E" }],
  [/^commonwealth edison/i, { tiny: "ComEd", mid: "ComEd" }],
  [/^baltimore gas/i, { tiny: "BGE", mid: "BGE" }],
  [/^georgia power/i, { tiny: "GA Pwr", mid: "GA Power" }],
  [/^florida power & light/i, { tiny: "FPL", mid: "FP&L" }],
  [/^tampa electric/i, { tiny: "TECO", mid: "Tampa Electric" }],
  [/^idaho power/i, { tiny: "Idaho", mid: "Idaho Pwr" }],
  [/^nevada power|^sierra pacific power|^nv energy/i, { tiny: "NV", mid: "NV Energy" }],
  [/^oncor/i, { tiny: "Oncor", mid: "Oncor" }],
  [/^centerpoint|d\/b\/a centerpoint/i, { tiny: "CNP", mid: "CenterPoint" }],
  [/^consumers energy/i, { tiny: "CE", mid: "Consumers" }],
  [/^dte electric|^detroit edison/i, { tiny: "DTE", mid: "DTE" }],
  [/^rocky mountain power/i, { tiny: "RM", mid: "Rocky Mtn" }],
  [/^minnesota power/i, { tiny: "MN Pwr", mid: "MN Power" }],
  [/^cleveland electric illuminating/i, { tiny: "CEI", mid: "CEI" }],
  [/^wheelabrator/i, { tiny: "Wheel", mid: "Wheelabrator" }],
  [/^invenergy/i, { tiny: "InvEnrg", mid: "Invenergy" }],
  [/^constellation/i, { tiny: "CEG", mid: "Constellation" }],
  [/^clearway/i, { tiny: "Clearwy", mid: "Clearway" }],
  [/^avangrid/i, { tiny: "Avgird", mid: "Avangrid" }],
  [/^tenaska/i, { tiny: "Tenaska", mid: "Tenaska" }],
  [/^brookfield/i, { tiny: "Brookfld", mid: "Brookfield" }],
  [/^hydro[- ]?qu[eé]bec/i, { tiny: "Hydro-Québec", mid: "Hydro-Québec" }],
  [/^hydro one/i, { tiny: "Hydro One", mid: "Hydro One" }],
  [/ontario.*ieso|^ieso\b/i, { tiny: "IESO", mid: "Ontario IESO" }],
  [/^new brunswick power/i, { tiny: "NB Power", mid: "NB Power" }],
  [/^nova scotia power/i, { tiny: "NS Pwr", mid: "NS Power" }],
  [/^manitoba hydro/i, { tiny: "MB Hydro", mid: "Manitoba Hydro" }],
  [/^saskatchewan power|^saskpower/i, { tiny: "SaskPower", mid: "SaskPower" }],
];

function curate(name: string): { tiny: string; mid: string } | null {
  for (const [re, v] of NAME_RULES) if (re.test(name)) return v;
  return null;
}

function coreFromAcronym(acr: string): string {
  let s = acr.trim();
  for (let i = 0; i < 2; i++) {
    s = s.replace(/[\s,]+(service\s+corp\w*|corp\w*|holdings?|utilities|company|co|inc|llc|l\.?p\.?)\.?$/i, "").trim();
  }
  return s || acr.trim();
}

export function tinyName(o: DisplayOrg): string {
  if (o._tiny != null) return o._tiny;
  return (o._tiny = computeTinyName(o));
}

function computeTinyName(o: DisplayOrg): string {
  const curated = curate(o.entity_name);
  const fromShortest = o.name_shortest
    ? tightenMapLabel(o.name_shortest, MAP_LABEL_MAX)
    : null;
  if (curated) {
    const tiny = tightenMapLabel(curated.tiny, MAP_LABEL_MAX);
    if (!fromShortest || tiny.length < fromShortest.length) return tiny;
  }
  if (fromShortest) return fromShortest;
  if (curated) return tightenMapLabel(curated.tiny, MAP_LABEL_MAX);
  if (o.acronym) {
    const compressed = compressSpacedBrand(o.acronym, MAP_LABEL_MAX);
    if (compressed.length <= MAP_LABEL_MAX) return compressed;
    const core = coreFromAcronym(o.acronym);
    return tightenMapLabel(core, MAP_LABEL_MAX);
  }
  return tightenMapLabel(fallbackAcronym(o.entity_name), MAP_LABEL_MAX);
}

export function midName(o: DisplayOrg): string {
  if (o.name_short) return tightenMapLabel(o.name_short, 14);
  const c = curate(o.entity_name);
  if (c) return c.mid;
  let s = o.entity_name.split(/\s+as agent\b|\bd\/b\/a\b|;/i)[0];
  s = shortName(s).replace(/,.*$/, "").trim();
  if (s.length >= 3 && s.length <= 22) return s;
  return tinyName(o);
}

function compactAcronymLabel(o: DisplayOrg): string | null {
  if (!o.acronym) return null;
  const compressed = compressSpacedBrand(o.acronym, MAP_LABEL_MAX);
  if (compressed.length <= MAP_LABEL_MAX && !isWeakMapLabel(compressed)) {
    return compressed;
  }
  const core = coreFromAcronym(o.acronym);
  const tightened = tightenMapLabel(core, MAP_LABEL_MAX);
  if (tightened.length <= MAP_LABEL_MAX && !isWeakMapLabel(tightened)) {
    return tightened;
  }
  return null;
}

export function displayMapLabel(o: DisplayOrg, placementText: string, maxLen = MAP_LABEL_MAX): string {
  if (!isWeakMapLabel(placementText)) return placementText;
  const fromAcronym = compactAcronymLabel(o);
  if (fromAcronym && fromAcronym.length <= maxLen) return fromAcronym;
  const curated = curate(o.entity_name);
  if (curated) {
    const curatedTiny = compactMapLabel(curated.tiny, maxLen);
    if (curatedTiny) return curatedTiny;
  }
  const fromShort = compactMapLabel(o.name_short, maxLen);
  if (fromShort) return fromShort;
  const fromShortest = compactMapLabel(o.name_shortest, maxLen);
  if (fromShortest) return fromShortest;
  if (o.acronym) {
    const compressed = compressSpacedBrand(o.acronym, maxLen);
    if (compressed.length <= maxLen && !isWeakMapLabel(compressed)) return compressed;
    const core = coreFromAcronym(o.acronym);
    const tightened = tightenMapLabel(core, maxLen);
    if (tightened.length <= maxLen && !isWeakMapLabel(tightened)) return tightened;
  }
  const fallback = tightenMapLabel(fallbackAcronym(o.entity_name), maxLen);
  if (!isWeakMapLabel(fallback)) return fallback;
  return fallbackAcronym(o.entity_name);
}

export function orgAcronym(o: DisplayOrg): string {
  return displayMapLabel(o, tinyName(o));
}

export function memberDisplayName(name: string): string {
  let s = name.split(/\s+as agent\b|\bd\/b\/a\b|;/i)[0].replace(/,.*$/, "").trim();
  if (s.length > 72) s = `${s.slice(0, 69)}…`;
  return s;
}

function combinedRegions(o: DisplayOrg): string | null {
  const regions = new Set<string>();
  if (o.regions?.length) for (const r of o.regions) regions.add(r);
  else if (o.region) regions.add(o.region);
  for (const m of o.combined_members ?? []) {
    if (m.region) regions.add(m.region);
  }
  const list = [...regions].sort();
  if (list.length <= 1) return list[0] ?? null;
  return list.join(", ");
}

export function displayName(o: DisplayOrg): string {
  if (o.map_combine_label) return o.map_combine_label;
  if (o.combined_members?.length) {
    const c = curate(o.entity_name);
    if (c) return c.mid;
    return o.name_normal ?? midName(o);
  }
  if (o.entity_name.length > 40) {
    return o.name_short ?? o.name_shortest ?? midName(o);
  }
  return o.entity_name;
}

export function idLabel(o: DisplayOrg): string {
  if (o.nerc_registered === false) return "No NERC ID";
  if (o.combined_members?.length) {
    const n = o.combined_members.length;
    return `${o.ncr_id} + ${n} co-located registration${n === 1 ? "" : "s"}`;
  }
  return o.ncr_id;
}

export function regionLabel(o: DisplayOrg): string {
  return combinedRegions(o) ?? o.region ?? "No Regional Entity";
}

export function typeLabel(value: string | null): string {
  return TYPE_LABELS[value ?? "other"] ?? value ?? "Other";
}

export function confidenceLabel(value: string | null): string {
  const label = CONFIDENCE_LABELS[value ?? ""] ?? value ?? "Unknown";
  return `Confidence: ${label}`;
}

export function locationLabel(o: DisplayOrg): string {
  const place = [o.city, o.state].filter(Boolean).join(", ");
  return place || o.headquarters_address || o.country || "Location unknown";
}

export function safeColor(color: string | null | undefined): string {
  const value = String(color ?? "").trim();
  return /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/i.test(value) ? value : "hsl(0, 0%, 45%)";
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function roleFullName(role: string): string {
  return (ROLE_FULL_NAMES as Record<string, string>)[role] ?? role;
}

export function primaryRoles(o: DisplayOrg): string[] {
  return o.roles
    .map((role, index) => ({ role, index }))
    .sort(
      (a, b) =>
        (PRIMARY_ROLE_RANK.get(a.role) ?? 999) - (PRIMARY_ROLE_RANK.get(b.role) ?? 999) ||
        a.index - b.index,
    )
    .map((entry) => entry.role);
}

export function primaryRoleSummaryText(o: DisplayOrg, max = 3): string {
  const roles = primaryRoles(o);
  const shown = roles.slice(0, max);
  const remaining = roles.length - shown.length;
  if (!shown.length) return "No roles";
  return `${shown.join(", ")}${remaining > 0 ? ` + ${remaining} more` : ""}`;
}
