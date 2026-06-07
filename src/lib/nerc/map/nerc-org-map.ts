import { geoAlbersUsa, geoConicEqualArea, geoMercator, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import { feature, mesh } from "topojson-client";
import { ROLE_FULL_NAMES } from "../roles.mjs";
import { PLACES } from "../places.mjs";
import { isExcludedTerritoryFips } from "../excluded-territories.mjs";

type Place = { name: string; lat: number; lng: number; tier: number; _x?: number; _y?: number };

type OrgLocation = {
  rank: 1 | 2 | 3;
  role?: string;
  lat: number | null;
  lng: number | null;
  headquarters_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  geo_confidence?: string | null;
  geo_source?: string | null;
  geo_source_url?: string | null;
  geo_notes?: string | null;
};

type Org = {
  ncr_id: string;
  entity_name: string;
  acronym: string;
  acronym_source: string | null;
  area_aliases?: string[];
  // Researched three-tier display names; null until Cursor fills org-names.json.
  // name_major entities are pinned to name_shortest at every zoom.
  name_shortest?: string | null;
  name_short?: string | null;
  name_normal?: string | null;
  name_major?: boolean;
  region: string | null;
  regions?: string[];
  roles: string[];
  role_count: number;
  is_private: boolean;
  lat: number | null;
  lng: number | null;
  locations?: OrgLocation[];
  map_location_rank?: 1 | 2 | 3 | null;
  headquarters_address?: string | null;
  city: string | null;
  state: string | null;
  country: string;
  geo_confidence: string;
  geo_source?: string | null;
  geo_source_url?: string | null;
  geo_notes?: string | null;
  geo_needs_review?: boolean;
  weight: number;
  color: string;
  is_iso_rto: boolean;
  org_type: string | null;
  parent_org?: string | null;
  eia_utility_id?: string | number | null;
  seed?: boolean;
  nerc_registered?: boolean;
  out_of_footprint?: boolean;
  combined_members?: Array<{
    ncr_id: string;
    entity_name: string;
    region: string | null;
    roles: string[];
  }>;
  map_combine_summary?: string;
  map_combine_label?: string;
  _x?: number;
  _y?: number;
  // Declutter offset in current screen-space layout units. Rendering divides
  // it by zoom so the projected _x/_y coordinate remains the true location.
  _dx?: number;
  _dy?: number;
  _rx?: number;
  _ry?: number;
  _sx?: number;
  _sy?: number;
  _vis?: boolean;
  // Whether this bubble found a non-overlapping spot at the current zoom bucket.
  // Set by computePlacements; drives disclosure (placed => shown). Recomputed only
  // when the zoom bucket changes, never on pan.
  _placed?: boolean;
  // bubble = normal decluttered placement; fallbackTiny = background-tier dot.
  placementMode?: "bubble" | "fallbackTiny";
  // Ephemeral per-frame: draw at background tier (tiny, subdued, no label).
  _renderFallback?: boolean;
  _rk?: number;
  // Last viewBox radius actually written to the circle, so zoom-only sizing can
  // update without a per-frame attribute storm.
  _rr?: number;
  // Memoized renderedRadius and the (zoom, size-generation) it was computed for.
  // visualRadius is heavy and gets called many times per org per frame; caching
  // it keeps panning (constant k) cheap.
  _vr?: number;
  _vrk?: number;
  _vrGen?: number;
  _vrFallback?: boolean;
  // Last viewBox hit radius written to the invisible target. It follows the
  // resolved visual radius, not just zoom, so panning at deep zoom stays aligned.
  _hr?: number;
  // Which projection placed this org: mainland Albers ("us"), the Canada conic
  // ("ca"), or a territory inset ("terr").
  _frame?: "us" | "ca" | "terr";
  _locXY?: Array<{ rank: 1 | 2 | 3; x: number; y: number; frame: "us" | "ca" } | null>;
};

type LandLabel = { name: string; x: number; y: number; small: boolean; _node?: SVGTextElement };
// An offshore territory's layout region. x/y/w/h bound where its cluster of dots
// is laid out; lx/ly is the anchor for the region name, centred above the dots.
type TerritoryBox = { code: string; label: string; x: number; y: number; w: number; h: number; lx: number; ly: number; landPath?: string | null };

type OrgsPayload = {
  generated_at?: string;
  source_file?: string;
  count?: number;
  orgs: Org[];
};

type OrgDetailsPayload = {
  generated_at?: string;
  source_file?: string;
  count?: number;
  details: Record<string, Partial<Org>>;
};

// Viewbox dimensions. These are recomputed from the live element size so the
// viewBox aspect ratio matches the screen (no letterbox bands on tall phones).
let W = 960;
let H = 600;
// Vestigial spider-fan constants. The fan is disabled (spiderFanScale returns 0)
// now that coincident origins are separated by ring placement in
// computePlacements; kept only so the few remaining references compile.
const SPIDER_CLUSTER_EPSILON = 0.35;
const SPIDER_START_K = 4;
const SPIDER_FULL_K = 10;
const SPIDER_RING_STEP_PX = 28;
// Full-size (priority-100, fully-zoomed) bubble radius in CSS px on desktop.
// Drives visualRadius's desktop maxPx, so raising it enlarges every bubble.
// Bubbles only ever move in render space (_dx/_dy nudges); the true projected
// _x/_y are never mutated, so geography stays exact.
const MAX_RADIUS = 58;
const MAX_ZOOM = 1600;
const ORG_CONTENT_SCALE = 0.85;
// Quiet dots for orgs that could not earn a non-overlapping bubble slot.
// Background-tier dots: present on the map but not yet promoted to a bubble.
const FALLBACK_TINY_RADIUS_PX = { desktop: 1.1, compact: 1.0 };
const FALLBACK_TINY_RADIUS_DEEP_PX = { desktop: 1.35, compact: 1.2 };
// D3 transition duration for programmatic zoom (tour, center-on-org, home reset).
const ZOOM_TRANSITION_MS = 175;
const AUTHORITY_ROLES = new Set(["BA", "RC", "PC"]);
const BA_RC_ROLES = new Set(["BA", "RC"]);
const MAJOR_OPERATOR_PARTNER_ROLES = new Set(["TOP", "PC", "TSP"]);
const GRID_ROLES = new Set(["TSP", "TP", "TO", "DP", "LSE"]);
const SUPPORT_ROLES = new Set(["RP", "RSG", "FRSG", "RRSG"]);
const GENERATION_ROLES = new Set(["GO", "GOP"]);
const ZERO_VISUAL_PRIORITY_ROLES = new Set(["GO", "GOP", "COP", "PSE"]);
// Growth anchor for generation-only micro-orgs: how deep before their post-reveal
// size ramp begins. Kept high so they stay small at mid/deep zoom.
const GENERATION_ONLY_REVEAL_K = 50;
const GENERATION_ONLY_REVEAL_K_COMPACT = 48;
// PSE-market entities stay the deepest tier. (GO/GOP-only companies are excluded
// from the map entirely, so they have no display anchor.)
const PSE_MARKET_DISPLAY_K = 20;
const PSE_MARKET_DISPLAY_K_COMPACT = 48;
const TO_ONLY_REVEAL_K = 12;
const TO_ONLY_REVEAL_K_COMPACT = 14;
const SYSTEM_OPERATOR_NAME = /\b(ISO|RTO|Independent System Operator|Interconnection|Transmission System Operator|Electric Reliability Council)\b/i;
const RELIABILITY_ORG_NAME = /\b(ReliabilityFirst|Reliability (Organization|Corporation|Entity|Council|Coordinator)|Coordinating Council)\b/i;
const REGIONAL_ENTITY_NAME = /\b(NERC|SERC|WECC|MRO|NPCC|ReliabilityFirst|Texas Reliability Entity|Midwest Reliability Organization|Northeast Power Coordinating Council|Western Electricity Coordinating Council|Regional Entity)\b/i;
const FEDERAL_NAME = /\b(Power Administration|Tennessee Valley Authority|Bonneville|Western Area Power|Southwestern Power|Southeastern Power|Bureau of Reclamation|USACE|U\.S\. Army Corps)\b/i;
const PUBLIC_POWER_AUTHORITY_NAME = /\b(Power Authority|Power Administration)\b/i;
const PUBLIC_UTILITY_NAME = /\b(Public Power|Public Utility|Utility District|PUD|Municipal|City of|Town of|Electric Department|Light Department|Cooperative|Electric Membership)\b/i;

// Out-of-footprint U.S. territories rendered as labelled inset clusters (geoAlbersUsa
// cannot plot them on the mainland canvas).
const TERRITORY_STATES = new Set(["PR", "VI"]);
const TERRITORY_LABELS: Record<string, string> = {
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
};
// Right-to-bottom layout order; Puerto Rico is largest and anchors the cluster.
const TERRITORY_LAYOUT_ORDER = ["PR", "VI"] as const;
// FIPS ids of the territory land outlines carried in the states topojson, so the
// inset can draw the real island shape (geoAlbersUsa can't project them).
const TERRITORY_FIPS: Record<string, string> = { PR: "72", VI: "78" };
// Out-of-footprint PR/VI inset dots use a fixed schematic radius (not priority-based).
const TERRITORY_BUBBLE_RADIUS_PX = { desktop: 4.6, compact: 5.4 };
const TERRITORY_HIT_RADIUS_PX = { desktop: 8.6, compact: 10 };
// PR/VI have few orgs and ample inset space — enlarge for visibility and tapping.
const TERRITORY_BUBBLE_SCALE = 4;

// Alaska and Hawaii plot inside geoAlbersUsa's built-in lower-left/right insets.
// They share the mainland declutter path but need extra spread and tap area at
// overview zoom where the inset is tiny on screen.
const US_INSET_STATES = new Set(["AK", "HI"]);

function isUsInsetOrg(o: { state?: string | null }): boolean {
  return US_INSET_STATES.has(o.state ?? "");
}

// Dense upper-Midwest utility belt (NE/IA/MN/WI): extra declutter spread and
// slightly earlier label tries without changing the placement algorithm.
const MIDWEST_STATES = new Set(["NE", "IA", "MN", "WI"]);

function isMidwestOrg(o: { state?: string | null }): boolean {
  return MIDWEST_STATES.has(o.state ?? "");
}

function territoryLayoutMetrics(compact: boolean, u: number, viewW: number, viewH: number) {
  const padX = (compact ? 30 : 18) * u;
  const padY = (compact ? 12 : 8) * u;
  // Dedicated Atlantic lane east of the lower-48 footprint so PR/VI never sit on Florida.
  const laneW = (compact ? 136 : 224) * u;
  return {
    padX,
    padY,
    laneW,
    laneLeft: viewW - padX - laneW,
    laneRight: viewW - padX,
    laneBottom: viewH - padY,
    insetPad: 8 * u,
    stackGap: (compact ? 8 : 12) * u,
  };
}

// Canadian province label anchors (rough interior points), drawn faintly on the
// land like the U.S. state labels.
const PROVINCE_LABELS: Array<{ name: string; lat: number; lng: number }> = [
  { name: "British Columbia", lat: 53.9, lng: -124.5 },
  { name: "Alberta", lat: 54.4, lng: -114.4 },
  { name: "Saskatchewan", lat: 53.6, lng: -105.8 },
  { name: "Manitoba", lat: 53.4, lng: -97.5 },
  { name: "Ontario", lat: 49.3, lng: -85.5 },
  { name: "Québec", lat: 51.5, lng: -70.5 },
  { name: "New Brunswick", lat: 46.7, lng: -66.4 },
  { name: "Nova Scotia", lat: 45.1, lng: -62.9 },
  { name: "Newfoundland & Labrador", lat: 48.7, lng: -56.2 },
];

// Tiny states whose centroid label would clutter the eastern seaboard; held
// back until the map is zoomed in.
const SMALL_STATES = new Set([
  "Rhode Island", "Delaware", "Connecticut", "New Jersey", "New Hampshire",
  "Vermont", "Massachusetts", "Maryland", "District of Columbia", "Hawaii",
]);

const TYPE_LABELS: Record<string, string> = {
  ISO_RTO: "ISO / RTO",
  IOU: "Investor-owned utility",
  cooperative: "Electric cooperative",
  municipal: "Municipal / public power",
  federal: "Federal power authority",
  merchant: "Merchant / IPP",
  cca: "Community choice (CCA)",
  other: "Other",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  ESTIMATED: "Estimated",
};

const ROLE_TOUR_LABELS: Record<string, string> = {
  BA: "Balancing Authorities (BA)",
  RC: "Reliability Coordinators (RC)",
  PC: "Planning Coordinators (PC)",
  TOP: "Transmission Operators (TOP)",
  TSP: "Transmission Service Providers (TSP)",
  TP: "Transmission Planners (TP)",
  RSG: "Reserve Sharing Groups (RSG)",
  FRSG: "Frequency Response Sharing Groups (FRSG)",
  RRSG: "Reactive Reserve Sharing Groups (RRSG)",
  RP: "Resource Planners (RP)",
  TO: "Transmission Owners (TO)",
  GO: "Generator Owners (GO)",
  GOP: "Generator Operators (GOP)",
  LSE: "Load-Serving Entities (LSE)",
  DP: "Distribution Providers (DP)",
  PSE: "Purchasing-Selling Entities (PSE)",
};

// Walkthrough order: grid authorities -> planners -> the many smaller dots
// (transmission/distribution/generation owners & operators). TOP, TSP and LSE
// are intentionally omitted; PSE/LSE are no longer NERC-registered functions.
const TOUR_ROLE_ORDER = ["RC", "BA", "PC", "TP", "TO", "DP", "GO", "GOP"];

function byId<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as unknown as T;
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

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

// Three-tier names. tiny = super-short (zoomed out / tight spots), mid =
// shortened (zoomed in), and the full legal entity_name is reserved for the
// detail panel. Curated rules cover recognizable brands and the awkward
// "… as agent for …" registry names; everything else is derived algorithmically.
const NAME_RULES: Array<[RegExp, { tiny: string; mid: string }]> = [
  [/^consolidated edison/i, { tiny: "ConEd", mid: "Con Edison" }],
  [/^american electric power/i, { tiny: "AEP", mid: "American Electric Power" }],
  [/^firstenergy/i, { tiny: "FirstEnergy", mid: "FirstEnergy" }],
  [/^(public service enterprise group|pseg|p\.?s\.?e\.?&?g)/i, { tiny: "PSEG", mid: "PSEG" }],
  [/^northern states power|\bxcel energy\b/i, { tiny: "Xcel", mid: "Xcel Energy" }],
  [/^pacificorp/i, { tiny: "PacifiCorp", mid: "PacifiCorp" }],
  [/^next\s?era/i, { tiny: "NextEra", mid: "NextEra Energy" }],
  [/^duke energy/i, { tiny: "Duke", mid: "Duke Energy" }],
  [/^dominion/i, { tiny: "Dominion", mid: "Dominion Energy" }],
  [/^southern (company|co\b)/i, { tiny: "Southern", mid: "Southern Company" }],
  [/^entergy/i, { tiny: "Entergy", mid: "Entergy" }],
  [/^ameren/i, { tiny: "Ameren", mid: "Ameren" }],
  [/^exelon/i, { tiny: "Exelon", mid: "Exelon" }],
  [/^berkshire hathaway energy|^midamerican/i, { tiny: "MidAmerican", mid: "MidAmerican" }],
  [/^national grid/i, { tiny: "Nat. Grid", mid: "National Grid" }],
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
  [/^san diego gas/i, { tiny: "SDG&E", mid: "SDG&E" }],
  [/^commonwealth edison/i, { tiny: "ComEd", mid: "ComEd" }],
  [/^baltimore gas/i, { tiny: "BGE", mid: "BGE" }],
  [/^georgia power/i, { tiny: "GA Power", mid: "Georgia Power" }],
  [/^florida power & light/i, { tiny: "FPL", mid: "FP&L" }],
  [/^tampa electric/i, { tiny: "TECO", mid: "Tampa Electric" }],
  [/^idaho power/i, { tiny: "Idaho Pwr", mid: "Idaho Power" }],
  [/^nevada power|^sierra pacific power/i, { tiny: "NV Energy", mid: "NV Energy" }],
  [/^oncor/i, { tiny: "Oncor", mid: "Oncor" }],
  [/^centerpoint|d\/b\/a centerpoint/i, { tiny: "CenterPoint", mid: "CenterPoint" }],
  [/^hydro[- ]?qu[eé]bec/i, { tiny: "Hydro-Québec", mid: "Hydro-Québec" }],
  [/^hydro one/i, { tiny: "Hydro One", mid: "Hydro One" }],
  [/ontario.*ieso|^ieso\b/i, { tiny: "IESO", mid: "Ontario IESO" }],
  [/^new brunswick power/i, { tiny: "NB Power", mid: "NB Power" }],
  [/^nova scotia power/i, { tiny: "NS Power", mid: "Nova Scotia Power" }],
  [/^manitoba hydro/i, { tiny: "MB Hydro", mid: "Manitoba Hydro" }],
  [/^saskatchewan power|^saskpower/i, { tiny: "SaskPower", mid: "SaskPower" }],
];

function curate(name: string): { tiny: string; mid: string } | null {
  for (const [re, v] of NAME_RULES) if (re.test(name)) return v;
  return null;
}

// Strip trailing corporate filler from a short token: "AEP Service Corp" -> "AEP".
function coreFromAcronym(acr: string): string {
  let s = acr.trim();
  for (let i = 0; i < 2; i++) {
    s = s.replace(/[\s,]+(service\s+corp\w*|corp\w*|holdings?|utilities|company|co|inc|llc|l\.?p\.?)\.?$/i, "").trim();
  }
  return s || acr.trim();
}

function tinyName(o: Org): string {
  // Researched shortest acronym wins (e.g. "PJM", "CE"); else curated rule; else
  // the algorithmic fallback.
  if (o.name_shortest) return o.name_shortest;
  const c = curate(o.entity_name);
  if (c) return c.tiny;
  if (o.acronym) {
    const core = coreFromAcronym(o.acronym);
    if (core.length <= 7) return core;
    if (o.acronym.length <= 9) return o.acronym;
    return core.length <= o.acronym.length ? core : o.acronym;
  }
  return fallbackAcronym(o.entity_name);
}

// A shortened-but-readable brand: cut "… as agent for …", "d/b/a", trailing
// lists/clauses, and legal suffixes; fall back to the tiny token if still long.
function midName(o: Org): string {
  // Researched "short" name wins (e.g. "Consumers", "PJM Interconnection").
  if (o.name_short) return o.name_short;
  const c = curate(o.entity_name);
  if (c) return c.mid;
  let s = o.entity_name.split(/\s+as agent\b|\bd\/b\/a\b|;/i)[0];
  s = shortName(s).replace(/,.*$/, "").trim();
  return s.length >= 3 && s.length <= 30 ? s : tinyName(o);
}

// "Acronym"-style token used in chips / tooltips / aria: the super-short name.
function orgAcronym(o: Org): string {
  return tinyName(o);
}

function memberDisplayName(name: string): string {
  let s = name.split(/\s+as agent\b|\bd\/b\/a\b|;/i)[0].replace(/,.*$/, "").trim();
  if (s.length > 72) s = `${s.slice(0, 69)}…`;
  return s;
}

function combinedRegions(o: Org): string | null {
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

// Human-facing title: combined orgs use a short brand, not the full agent string.
function displayName(o: Org): string {
  if (o.map_combine_label) return o.map_combine_label;
  if (o.combined_members?.length) {
    const c = curate(o.entity_name);
    if (c) return c.mid;
    return o.name_normal ?? midName(o);
  }
  // Long legal names collapse to a shorter readable tier for titles/labels:
  // researched short name, then shortest, then the algorithmic acronym fallback
  // (midName -> tinyName -> acronym). The full entity_name is still shown in the
  // detail panel (see renderPanel) and so stays available on inspect.
  if (o.entity_name.length > 40) {
    return o.name_short ?? o.name_shortest ?? midName(o);
  }
  return o.entity_name;
}

function idLabel(o: Org): string {
  if (o.nerc_registered === false) return "No NERC ID";
  if (o.combined_members?.length) {
    const n = o.combined_members.length;
    return `${o.ncr_id} + ${n} co-located registration${n === 1 ? "" : "s"}`;
  }
  return o.ncr_id;
}

function regionLabel(o: Org): string {
  return combinedRegions(o) ?? o.region ?? "No Regional Entity";
}

function typeLabel(value: string | null): string {
  return TYPE_LABELS[value ?? "other"] ?? value ?? "Other";
}

function confidenceLabel(value: string | null): string {
  const label = CONFIDENCE_LABELS[value ?? ""] ?? value ?? "Unknown";
  return `Confidence: ${label}`;
}

function locationLabel(o: Org): string {
  const rank = o.map_location_rank ?? 1;
  const loc = o.locations?.find((l) => l.rank === rank) ?? o.locations?.[0];
  const place = [loc?.city ?? o.city, loc?.state ?? o.state].filter(Boolean).join(", ");
  return place || loc?.headquarters_address || o.headquarters_address || o.country || "Location unknown";
}

function safeColor(color: string | null | undefined): string {
  const value = String(color ?? "").trim();
  return /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/i.test(value) ? value : "hsl(0, 0%, 45%)";
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function roleFullName(role: string): string {
  return (ROLE_FULL_NAMES as Record<string, string>)[role] ?? role;
}

async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export function mountNercOrgMap(): void {
  const root = document.querySelector<HTMLElement>("[data-nerc-map]");
  if (!root || root.dataset.mounted === "true") return;
  root.dataset.mounted = "true";
  const dataBase = import.meta.env.BASE_URL;

  const svgNode = byId<SVGSVGElement>("nerc-svg");
  const svg = select(svgNode);
  const gMap = svg.append("g").attr("class", "map");
  // Territory inset frames ride the zoom transform (like the Alaska/Hawaii
  // insets) so their dots stay inside as you zoom.
  const gInsets = svg.append("g").attr("class", "insets");
  // City context stays below every NERC mark and label.
  const gPlaces = svg.append("g").attr("class", "places");
  // Area context is even quieter than city context and must paint below the
  // NERC overlay, not over it.
  const gLand = svg.append("g").attr("class", "land");
  const gOverlay = svg.append("g").attr("class", "overlay");
  const gHit = svg.append("g").attr("class", "hit");
  const gLabels = svg.append("g").attr("class", "labels");

  const tooltip = byId<HTMLElement>("nerc-tooltip");
  const panel = byId<HTMLElement>("nerc-panel");
  const panelBody = byId<HTMLElement>("nerc-panel-body");
  const infoPanel = byId<HTMLElement>("nerc-info-panel");
  const metricsPanel = byId<HTMLElement>("nerc-metrics-panel");
  const playBtn = byId<HTMLButtonElement>("nerc-play-tour");
  const fabBtn = byId<HTMLButtonElement>("nerc-tour-fab");
  const metricsBody = byId<HTMLElement>("nerc-metrics-body");
  const loadingEl = byId<HTMLElement>("nerc-loading");
  const tourStatus = byId<HTMLElement>("nerc-tour-status");
  const infoToggle = byId<HTMLButtonElement>("nerc-info-toggle");
  const metricsToggle = byId<HTMLButtonElement>("nerc-metrics-toggle");

  const projection = geoAlbersUsa();
  const path = geoPath(projection);
  // Canada is drawn with a conic that mirrors the Albers lower-48 piece (same
  // rotate/center/parallels), then locked to the composite's scale/translate
  // after fitSize — so Canadian land and entities line up north of the border.
  const canadaProj = geoConicEqualArea().rotate([96, 0]).center([-0.6, 38.7]).parallels([29.5, 45.5]);
  const canadaPath = geoPath(canadaProj);

  let transform: ZoomTransform = zoomIdentity;
  let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let orgs: Org[] = [];
  let placeableOrgs: Org[] = [];
  let orgDetails = new Map<string, Partial<Org>>();
  let orgDetailsLoaded = false;
  let orgDetailsPromise: Promise<Map<string, Partial<Org>>> | null = null;
  const places = PLACES as Place[];
  let selectedOrg: Org | null = null;
  let hoverOrg: Org | null = null;
  let recentOrg: Org | null = null;
  let recentOrgAt = 0;
  let lastUserZoomAt = 0;
  let userPanning = false;
  let lastPanEndAt = 0;
  let wheelZooming = false;
  let zoomBoundsDirty = false;
  let wheelRedrawPending = false;
  let focusPanPending = false;
  let tourIds = new Set<string>();
  let tourTimers: number[] = [];
  // Tour mode is on (button shows Stop) even between steps / during the reset.
  let tourRunning = false;
  // Timer that clears the Stop-button "attention" pulse after a gesture.
  let attentionTimer: number | undefined;
  // Cache for hit-circle radii: they only change with zoom, so skip the
  // per-redraw setAttribute storm during a tour (transform is static).
  let hitK = NaN;
  let nationFeature: unknown = null;
  let nationOutline: unknown = null;
  let canadaFeature: unknown = null;
  let stateFeatures: unknown[] = [];
  // Low-res land mask (US + Canada silhouette) in viewBox space, rebuilt on every
  // project(). Lets the declutter solver tell land from water in O(1) so dots
  // never drift far out to sea. mask[my*maskW+mx] is 1 on land, 0 on water.
  let landMask: Uint8Array | null = null;
  let maskW = 0;
  let maskH = 0;
  let maskScale = 1; // viewBox units per mask cell
  let landLabels: LandLabel[] = [];
  let territoryBoxes: TerritoryBox[] = [];
  const prefersReducedMotion = (): boolean =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // User-space units per on-screen pixel (W / element width). Lets us size
  // labels in real pixels so they read the same on desktop and iOS.
  let unitPerPx = 1;
  // Bumped whenever sizing inputs that aren't zoom change (unitPerPx / compact on
  // resize), to invalidate the per-org renderedRadius memo.
  let radiusGen = 0;
  // Phone-sized screens get fewer labels when zoomed in (less screen real
  // estate for the same physical-size labels).
  let compact = false;
  // Narrow phones (< ~450px CSS width): bubbles, labels and tap targets are
  // scaled up ~20% over the compact baseline so they stay tappable/readable on a
  // small handset. Desktop (and tablet-width compact) sizing is untouched.
  let phone = false;
  // Multiplier applied to bubble radius, label font and tap floors on narrow
  // phones only. 1 everywhere else, so desktop sizes never change.
  const phoneSizeScale = (): number => (phone ? 1.2 : 1);
  let orgMarkK = NaN;
  let orgLayoutBucket = NaN;
  // Last computed label placement, stashed for the optional ?audit UX harness so
  // it can report which dots got an inside vs floating label without recomputing.
  let lastLabelState: Map<string, { x: number; y: number; font: number; text: string; inside: boolean }> | null = null;
  let tooltipRequest = 0;

  function invalidateOrgLayout(): void {
    orgMarkK = NaN;
    orgLayoutBucket = NaN;
  }

  function rememberOrg(o: Org): void {
    recentOrg = o;
    recentOrgAt = performance.now();
  }

  function applyOrgDetails(o: Org): Org {
    const detail = orgDetails.get(o.ncr_id);
    if (detail) Object.assign(o, detail);
    return o;
  }

  function applyAllOrgDetails(): void {
    for (const o of orgs) applyOrgDetails(o);
  }

  function hasOrgDetails(o: Org): boolean {
    return orgDetailsLoaded || orgDetails.has(o.ncr_id);
  }

  function loadOrgDetails(): Promise<Map<string, Partial<Org>>> {
    if (orgDetailsPromise) return orgDetailsPromise;
    orgDetailsPromise = loadJson<OrgDetailsPayload>(`${dataBase}nerc/org-details.json`)
      .then((payload) => {
        orgDetails = new Map(Object.entries(payload.details ?? {}));
        orgDetailsLoaded = true;
        applyAllOrgDetails();
        return orgDetails;
      })
      .catch((err) => {
        orgDetailsPromise = null;
        throw err;
      });
    return orgDetailsPromise;
  }

  async function ensureOrgDetails(o: Org): Promise<Org> {
    if (hasOrgDetails(o)) return applyOrgDetails(o);
    await loadOrgDetails();
    return applyOrgDetails(o);
  }

  function scheduleOrgDetailsLoad(): void {
    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    }).requestIdleCallback;
    const load = (): void => {
      void loadOrgDetails().catch((err) => console.warn("NERC org details were not available", err));
    };
    if (idle) idle(load, { timeout: 3000 });
    else window.setTimeout(load, 250);
  }

  function clearOrgPointerFocus(): void {
    const active = document.activeElement;
    if (active instanceof Element && svgNode.contains(active)) {
      (active as HTMLElement).blur();
    }
  }

  function pointerViewPoint(ev: MouseEvent): { x: number; y: number } | null {
    if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return null;
    const rect = svgNode.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * unitPerPx,
      y: (ev.clientY - rect.top) * unitPerPx,
    };
  }

  function nearestOrgAtPointer(ev: MouseEvent, fallback: Org): Org {
    const point = pointerViewPoint(ev);
    if (!point) return fallback;
    const k = transform.k;
    let best = fallback;
    // Rank by how deep the pointer is INSIDE each bubble relative to that bubble's
    // own size (normalized distance), not raw distance to centre. In a dense
    // cluster this picks the dot you actually clicked into rather than a larger
    // neighbour whose centre happens to be nearer. A pointer inside a bubble's
    // *drawn* circle always beats one only inside the padded hit ring, so the
    // selection matches the circle you clicked.
    let bestNorm = Number.POSITIVE_INFINITY;
    let bestInVisual = false;
    let bestVisual = Number.POSITIVE_INFINITY;
    // Tolerance (in viewBox units) for treating two bubble radii as "the same
    // size" before falling back to normalized distance / draw priority.
    const radiusTol = 0.75 * unitPerPx;
    for (const o of placeableOrgs) {
      if (!o._vis || o._sx == null || o._sy == null) continue;
      const dx = o._sx - point.x;
      const dy = o._sy - point.y;
      const d2 = dx * dx + dy * dy;
      const hit = hitTargetRadius(o, k) + unitPerPx;
      if (d2 > hit * hit) continue;
      const visual = renderedRadius(o, k);
      const inVisual = d2 <= visual * visual;
      const norm = d2 / (hit * hit);
      // Selection order in dense clusters:
      //   1. A pointer inside a bubble's *drawn* circle always beats one only in
      //      the padded hit ring.
      //   2. When the pointer is inside more than one drawn circle, the INNERMOST
      //      (smallest-radius) bubble wins — a small dot stacked under a larger
      //      neighbour stays selectable when you click right on it.
      //   3. Ties (same containment, same size) fall back to normalized distance,
      //      then draw priority.
      let better: boolean;
      if (inVisual !== bestInVisual) {
        better = inVisual;
      } else if (inVisual && visual < bestVisual - radiusTol) {
        better = true; // innermost (smaller) drawn circle wins
      } else if (inVisual && visual > bestVisual + radiusTol) {
        better = false; // keep the tighter bubble already chosen
      } else {
        better =
          norm < bestNorm - 0.02 ||
          (Math.abs(norm - bestNorm) <= 0.02 && drawPriority(o, k) > drawPriority(best, k));
      }
      if (better) {
        best = o;
        bestNorm = norm;
        bestInVisual = inVisual;
        bestVisual = visual;
      }
    }
    return best;
  }

  function colorFor(role: string): string {
    const el = document.querySelector(`.nerc-role-def[data-role="${CSS.escape(role)}"] .nerc-dot`) as HTMLElement | null;
    return el ? getComputedStyle(el).backgroundColor : "#777";
  }

  function createRolePill(role: string, full = false): HTMLSpanElement {
    const pill = createEl("span", "nerc-rolepill", full ? `${role} - ${roleFullName(role)}` : role);
    pill.style.backgroundColor = colorFor(role);
    return pill;
  }

  function labelTextOptions(o: Org, k: number): string[] {
    // Super-short token first; once zoomed in, try the short brand too. The full
    // legal name only ever appears in the detail panel.
    const tiny = tinyName(o);
    const lp = labelPriority(o);
    const shortAt = compact
      ? lp >= 88 ? 2.2 : lp >= 68 ? 3.0 : lp >= 38 ? 4.2 : 5.5
      : lp >= 88 ? 1.6 : lp >= 68 ? 2.2 : lp >= 38 ? 3.2 : 4.5;
    if (k < shortAt) return [tiny];
    const mid = midName(o);
    // Keep the longer "mid" brand only when it is genuinely short; otherwise stay
    // with the compact token so a long name never dominates its neighbours. (The
    // full legal name still appears in the detail panel.)
    if (mid === tiny || mid.length > (compact ? 18 : 26)) return [tiny];
    return [tiny, mid];
  }

  function hasAnyRole(o: Org, roles: Set<string>): boolean {
    return o.roles.some((r) => roles.has(r));
  }

  function meaningfulRoleCount(o: Org): number {
    return o.roles.filter((r) => !ZERO_VISUAL_PRIORITY_ROLES.has(r)).length;
  }

  function isOnlyMeaningfulRole(o: Org, role: string): boolean {
    const roles = o.roles.filter((r) => !ZERO_VISUAL_PRIORITY_ROLES.has(r));
    return roles.length === 1 && roles[0] === role;
  }

  function isGenerationOnly(o: Org): boolean {
    return o.roles.length > 0 && o.roles.every((r) => GENERATION_ROLES.has(r));
  }

  // PSE-only (or PSE with other zero-priority roles like GO/GOP) — no grid/reliability
  // roles. Kept separate from isGenerationOnly so PSE+TO etc. stay prominent.
  function isPseMarketOnly(o: Org): boolean {
    return o.roles.includes("PSE") && meaningfulRoleCount(o) === 0;
  }

  // GO/GOP-only and PSE-market orgs disclose at the same deep zoom tier.
  function isDeferredMarketOrg(o: Org): boolean {
    return isGenerationOnly(o) || isPseMarketOnly(o);
  }

  function isTransmissionOwnerOnly(o: Org): boolean {
    // Federal and reliability orgs often carry GO/GOP alongside TO; don't shrink
    // them to the transmission-owner floor when the data marks them as agencies.
    if (o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) return false;
    if (RELIABILITY_ORG_NAME.test(o.entity_name)) return false;
    if (PUBLIC_POWER_AUTHORITY_NAME.test(o.entity_name)) return false;
    return isOnlyMeaningfulRole(o, "TO");
  }

  function generationOnlyRevealK(): number {
    return compact ? GENERATION_ONLY_REVEAL_K_COMPACT : GENERATION_ONLY_REVEAL_K;
  }

  function transmissionOwnerOnlyRevealK(): number {
    return compact ? TO_ONLY_REVEAL_K_COMPACT : TO_ONLY_REVEAL_K;
  }

  // GO/GOP-only dots and TO-only transmission owners disclose as pinpoints; this
  // ramps size quickly in the first ~5–7 zoom steps after reveal so a nudge in
  // makes them inspectable (especially on phone screens).
  function isMicroOrg(o: Org): boolean {
    return isDeferredMarketOrg(o) || isTransmissionOwnerOnly(o);
  }

  function microOrgRevealK(o: Org): number {
    if (isDeferredMarketOrg(o)) return generationOnlyRevealK();
    if (isTransmissionOwnerOnly(o)) return transmissionOwnerOnlyRevealK();
    return generationOnlyRevealK();
  }

  function postRevealBoostT(o: Org, k: number): number {
    if (!isMicroOrg(o) || k < microOrgRevealK(o)) return 0;
    const span = isDeferredMarketOrg(o) ? (compact ? 7 : 5) : compact ? 5 : 4;
    return smoothStep((k - microOrgRevealK(o)) / span);
  }

  // Zoom at which a generation-only org may start rendering. On desktop this is
  // earlier than its growth anchor (so it appears at deep zoom while still drawn
  // small); mobile keeps the conservative reveal-K to leave the overview clean.
  function pseMarketDisplayK(): number {
    return compact ? PSE_MARKET_DISPLAY_K_COMPACT : PSE_MARKET_DISPLAY_K;
  }

  // Progressive zoom tiers. Lower-priority / lower-weight entities reveal as the
  // user zooms in, so the widest view stays dominated by RC/BA/PC/TOP/TSP, ISOs/
  // RTOs and major utilities, while every zoom step still adds meaningful new
  // organizations. Nothing is removed from the dataset — only revealed later.
  function overviewRevealK(o: Org): number {
    const pri = visualPriority(o);
    const w = o.weight ?? 0;
    // Grid leadership and high-value utilities are always present at the overview.
    if (isGridLeadershipOrg(o) || pri >= 50) return 0; // leadership + grid roles always
    if (pri >= 42) return w >= 12 ? 0.78 : 0.95; // utilities, cooperatives, municipals
    if (pri >= 28) return w >= 8 ? 1.1 : 1.5;
    if (pri >= 18) return 1.9;
    return 2.4; // lowest non-deferred (minor/merchant) — GO/GOP/PSE deferred separately
  }

  function canDisplayOrg(o: Org, k: number): boolean {
    // Generation-only (GO/GOP) companies are excluded from the map entirely. They
    // are the bulk of the low-priority dots, so dropping them frees space for the
    // grid/utility organizations to fit cleanly at every zoom.
    if (isGenerationOnly(o)) return false;
    // Compact (phones/small tablets): below k2 keep the overview to major
    // entities only (grid leadership or high visual priority) so crowded metros
    // don't stack low-priority dots. They reveal normally once zoomed past k2.
    // Orgs that fail bubble placement still render as quiet fallback dots at their
    // true projected location (see computePlacements / rendersAsBackgroundDot).
    if (compact && k < 2 && !isGridLeadershipOrg(o) && visualPriority(o) < 28) return false;
    if (isTransmissionOwnerOnly(o)) return k >= transmissionOwnerOnlyRevealK();
    // PSE-market entities remain the deepest tier.
    if (isDeferredMarketOrg(o)) return k >= pseMarketDisplayK();
    return k >= overviewRevealK(o);
  }

  function isMajorSystemOperator(o: Org): boolean {
    if (SYSTEM_OPERATOR_NAME.test(o.entity_name)) return true;
    return hasAnyRole(o, BA_RC_ROLES) && hasAnyRole(o, MAJOR_OPERATOR_PARTNER_ROLES) && meaningfulRoleCount(o) >= 4;
  }

  function rolePriority(o: Org): number {
    const hasTo = o.roles.includes("TO");
    const hasDp = o.roles.includes("DP");
    const hasLse = o.roles.includes("LSE");
    if (isTransmissionOwnerOnly(o)) return 8;
    // Authority tier: RC outranks BA outranks PC (matches roles.mjs weights).
    // Checked in precedence order so multi-role orgs inherit their highest authority.
    // RC at 89 clears BA+multiRoleBonus (88).
    if (o.roles.includes("RC")) return 89;
    if (o.roles.includes("BA")) return 82;
    if (o.roles.includes("PC")) return 78;
    if ((hasTo && (hasDp || hasLse)) || (hasDp && hasLse)) return 62;
    if (o.roles.includes("TOP") || o.roles.includes("TSP")) return 52;
    if (hasAnyRole(o, GRID_ROLES)) return 50;
    if (hasAnyRole(o, SUPPORT_ROLES)) return 42;
    if (isDeferredMarketOrg(o)) return 6;
    return 14;
  }

  function typePriority(o: Org): number {
    // Federal power authorities, named reliability bodies and ISO/RTOs lead the
    // type tier so TVA/BPA/WAPA/NERC etc. read as major even without authority
    // roles. IOUs are not demoted (still 66 below).
    if (o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) return 80;
    if (RELIABILITY_ORG_NAME.test(o.entity_name)) return 78;
    if (o.is_iso_rto || o.org_type === "ISO_RTO") return 76;
    if (o.org_type === "IOU") return 66;
    if (o.org_type === "cca") return 38;
    if (PUBLIC_POWER_AUTHORITY_NAME.test(o.entity_name)) return 66;
    if (o.org_type === "municipal" || o.org_type === "cooperative") return 42;
    if (o.org_type === "merchant") return 24;
    if (PUBLIC_UTILITY_NAME.test(o.entity_name)) return 42;
    return 14;
  }

  // Build-time signals (weight, is_iso_rto, name_major) that mark grid importance
  // beyond what role heuristics alone capture.
  function dataProminenceScore(o: Org): number {
    if (isDeferredMarketOrg(o) || o.is_private) return 0;
    let score = 0;
    if (o.is_iso_rto) score = Math.max(score, 82);
    if (o.weight >= 28 && o.roles.includes("RC")) score = Math.max(score, 86);
    else if (o.weight >= 28 && o.roles.includes("BA")) score = Math.max(score, 82);
    else if (o.weight >= 28 && o.roles.includes("PC")) score = Math.max(score, 78);
    if (FEDERAL_NAME.test(o.entity_name) || o.org_type === "federal") score = Math.max(score, 78);
    if (RELIABILITY_ORG_NAME.test(o.entity_name)) score = Math.max(score, 78);
    if (o.org_type === "ISO_RTO") score = Math.max(score, 72);
    if (
      o.name_major &&
      meaningfulRoleCount(o) >= 2 &&
      (hasAnyRole(o, AUTHORITY_ROLES) || hasAnyRole(o, GRID_ROLES) || hasAnyRole(o, SUPPORT_ROLES))
    ) {
      score = Math.max(score, 70);
    }
    return score;
  }

  function multiRoleBonus(o: Org): number {
    const count = meaningfulRoleCount(o);
    if (count >= 4) return 6;
    if (count >= 2) return 3;
    return 0;
  }

  // Final visual priority: role tier first, then type/data signals, then multi-role
  // bonus. RC-only orgs (89) stay above BA+multiRoleBonus (88); visualPrioritySort
  // uses rolePriority as a tiebreaker when scores match.
  function visualPriority(o: Org): number {
    if (isDeferredMarketOrg(o)) return 6;
    if (isTransmissionOwnerOnly(o)) return 8;
    if (isMajorSystemOperator(o)) return 100;
    const score =
      Math.max(rolePriority(o), typePriority(o), dataProminenceScore(o)) + multiRoleBonus(o);
    return Math.max(10, Math.min(100, score));
  }

  // Label-specific priority: ISO/RTO and grid authority lead; merchant and
  // deferred-market orgs trail. Used for label eligibility, ordering, and tiers.
  function labelPriority(o: Org): number {
    if (isDeferredMarketOrg(o)) return 2;
    if (isTransmissionOwnerOnly(o)) return 10;
    if (o.is_iso_rto || o.org_type === "ISO_RTO" || SYSTEM_OPERATOR_NAME.test(o.entity_name)) return 98;
    if (isMajorSystemOperator(o)) return 96;
    if (o.roles.includes("RC")) return 92;
    if (o.roles.includes("BA")) return 88;
    if (o.roles.includes("PC")) return 85;
    if (o.roles.includes("TOP")) return 82;
    if (o.roles.includes("TSP")) return 80;
    if (o.roles.includes("TP")) return 78;
    if (REGIONAL_ENTITY_NAME.test(o.entity_name) || RELIABILITY_ORG_NAME.test(o.entity_name)) return 74;
    if (o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) return 72;
    if (o.org_type === "IOU" || PUBLIC_POWER_AUTHORITY_NAME.test(o.entity_name)) return 68;
    if (o.name_major && o.weight >= 20) return 64;
    if (hasAnyRole(o, GRID_ROLES)) return 52;
    if (o.org_type === "municipal" || o.org_type === "cooperative" || PUBLIC_UTILITY_NAME.test(o.entity_name)) {
      return 38;
    }
    if (o.org_type === "cca") return 34;
    if (hasAnyRole(o, SUPPORT_ROLES)) return 40;
    if (o.org_type === "merchant") return 16;
    return 24;
  }

  function canGrowAtZoom(o: Org): boolean {
    return meaningfulRoleCount(o) > 0 || isDeferredMarketOrg(o);
  }

  function isGridLeadershipOrg(o: Org): boolean {
    return (
      isMajorSystemOperator(o) ||
      hasAnyRole(o, AUTHORITY_ROLES) ||
      o.roles.includes("TOP") ||
      o.roles.includes("TSP") ||
      o.is_iso_rto ||
      o.org_type === "federal" ||
      FEDERAL_NAME.test(o.entity_name) ||
      RELIABILITY_ORG_NAME.test(o.entity_name)
    );
  }

  // Scale small-org catch-up growth so RC/BA/PC/TOP/TSP stay visually ahead of
  // GO/GOP and minor utilities at overview and mid zoom; catch-up ramps only deep in.
  function growthDominanceFactor(o: Org, k: number): number {
    if (isGridLeadershipOrg(o)) return 1;
    if (isDeferredMarketOrg(o)) return 0.12 + 0.88 * postRevealBoostT(o, k);
    const pri = visualPriority(o);
    const lowPriT = smoothStep((48 - pri) / 40);
    const deepCatchUpT = smoothStep((k - 8) / 5);
    return 1 - 0.52 * lowPriT * (1 - deepCatchUpT);
  }

  function visualPrioritySort(a: Org, b: Org): number {
    return (
      visualPriority(b) - visualPriority(a) ||
      rolePriority(b) - rolePriority(a) ||
      typePriority(b) - typePriority(a) ||
      meaningfulRoleCount(b) - meaningfulRoleCount(a) ||
      a.ncr_id.localeCompare(b.ncr_id)
    );
  }

  function labelPrioritySort(a: Org, b: Org): number {
    return (
      labelPriority(b) - labelPriority(a) ||
      visualPriority(b) - visualPriority(a) ||
      rolePriority(b) - rolePriority(a) ||
      typePriority(b) - typePriority(a) ||
      meaningfulRoleCount(b) - meaningfulRoleCount(a) ||
      a.ncr_id.localeCompare(b.ncr_id)
    );
  }

  function visualPrioritySortAsc(a: Org, b: Org): number {
    return (
      visualPriority(a) - visualPriority(b) ||
      rolePriority(a) - rolePriority(b) ||
      typePriority(a) - typePriority(b) ||
      meaningfulRoleCount(a) - meaningfulRoleCount(b) ||
      a.ncr_id.localeCompare(b.ncr_id)
    );
  }

  function drawPriority(o: Org, _k: number): number {
    if (o.placementMode === "fallbackTiny" || o._renderFallback) {
      return visualPriority(o) - 1000;
    }
    return visualPriority(o) + meaningfulRoleCount(o) * 2;
  }

  function fallbackTinyRadiusPx(k: number): number {
    const overview = compact ? FALLBACK_TINY_RADIUS_PX.compact : FALLBACK_TINY_RADIUS_PX.desktop;
    const deep = compact ? FALLBACK_TINY_RADIUS_DEEP_PX.compact : FALLBACK_TINY_RADIUS_DEEP_PX.desktop;
    // Always well below visualRadius's ~1.7px floor; grows slightly when zoomed in.
    return overview + (deep - overview) * smoothStep((k - 0.85) / 14);
  }

  // True when the org should draw as a tiny dot this frame (placement failed).
  function rendersAsBackgroundDot(o: Org, hasLabel: boolean, forced: boolean): boolean {
    if (o._frame === "terr" || o.placementMode !== "fallbackTiny") return false;
    if (forced || hasLabel) return false;
    return true;
  }

  function visualTier(o: Org): "bubble" | "background" {
    return o._renderFallback || o.placementMode === "fallbackTiny" ? "background" : "bubble";
  }

  // Label eligibility is independent of bubble visibility. Fallback dots never
  // label unless forced; major orgs label early; low-priority orgs defer.
  function isLabelForced(o: Org, tourActive: boolean, hot: Org | null): boolean {
    if (hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id) return true;
    if (tourActive && tourIds.has(o.ncr_id)) return true;
    return false;
  }

  function isLabelEligible(o: Org, k: number, forced: boolean): boolean {
    if (o._frame === "terr") return forced;
    if (o.placementMode === "fallbackTiny" || o._renderFallback) return forced;
    if (forced) return true;
    return shouldTryLabel(o, k);
  }

  // Which orgs may *try* for a label at this zoom (collision still decides).
  function shouldTryLabel(o: Org, k: number): boolean {
    if (o.placementMode === "fallbackTiny") return false;
    if (isDeferredMarketOrg(o)) return k >= (compact ? 5.5 : 4.8);
    const lp = labelPriority(o);
    const midwest = isMidwestOrg(o);
    // ISO/RTO and grid authority: label at national overview.
    if (lp >= 88) return true;
    if (lp >= 78) return k >= (compact ? 0.95 : 0.85);
    // Regional entity, federal, major regulated utility.
    if (lp >= 68) return k >= (compact ? 1.05 : 0.95);
    // Co-op, muni, smaller utility.
    if (lp >= 38) return k >= (compact ? 2.0 : 1.65);
    // Merchant / IPP.
    if (lp >= 16) return k >= (compact ? 3.2 : 2.8);
    // Residual low tier — deep zoom only.
    if (k >= (compact ? 4.5 : 4.0)) return lp >= 10;
    if (k < 1.25) return lp >= (midwest ? 30 : 34);
    if (k < 1.8) return lp >= (midwest ? 24 : 28);
    if (k < 2.2) return lp >= (midwest ? 20 : 24);
    return lp >= (midwest ? 16 : 20);
  }

  // Target on-screen label size in CSS pixels (multiplied by unitPerPx before it
  // hits the SVG). Keeps growing as you zoom in — including for small/low-priority
  // orgs — so that once you zoom in close enough on something its name reads big.
  // (The inside-label path still clamps to the bubble's chord, so a label never
  // overflows its own bubble; the bubble itself grows via visualRadius's deep
  // boost, which is what lets the text keep getting bigger.)
  function labelFontPx(o: Org, k: number): number {
    const priority = visualPriority(o);
    // Desktop bases keep the smallest national-view abbreviations readable; the
    // top tier is trimmed slightly (iOS more than desktop) so the largest labels
    // don't crowd the map or cover too much space.
    const base = compact
      ? priority >= 80 ? 9 : priority >= 50 ? 7.8 : 6
      : priority >= 80 ? 12 : priority >= 50 ? 10.5 : 8.5;
    // Mid/high-zoom readability: an extra ramp that kicks in past the overview so
    // labels keep getting bigger (and more legible) the further you zoom in. The
    // inside-label path still clamps to the bubble chord and long names fall back
    // to the short token, so this never causes overflow.
    const midHighBoost = 1 + 0.5 * smoothStep((k - 1.8) / (compact ? 6 : 7));
    const growth = compact
      ? Math.min(2.3, (1 + Math.max(0, k - 1) * 0.06) * midHighBoost)
      : Math.min(2.6, (1 + Math.max(0, k - 1) * 0.08) * midHighBoost);
    const microLabelBoost = 1 + (isDeferredMarketOrg(o) ? (compact ? 1.05 : 0.85) : 0.55) * postRevealBoostT(o, k);
    // Once the user has intentionally zoomed in (k~3+), smaller organizations'
    // labels grow an extra bit so they read easily. This does NOT change when a
    // dot is disclosed (that is overviewRevealK/canDisplayOrg) — it only enlarges
    // the text of dots already on screen. Top-tier (>=80) labels are left alone
    // since they're already prominent (and being trimmed above).
    const smallOrgCloseBoost =
      priority >= 80 ? 1 : 1 + (priority < 50 ? 0.28 : 0.16) * smoothStep((k - 3) / 4);
    // Narrow phones: scale every label up so names stay readable on a small handset.
    return base * growth * microLabelBoost * smallOrgCloseBoost * phoneSizeScale() * ORG_CONTENT_SCALE;
  }

  function labelLimit(k: number): number {
    // Raised at high zoom so smaller organizations' names appear once there's
    // room. Collision checks still gate floating labels, so denser caps only fill
    // genuinely free space rather than overlapping.
    const cap =
      k < 1.25 ? 700 :
      k < 1.8 ? 1000 :
      k < 2.6 ? 1400 :
      k < 3.4 ? 1800 :
      k < 4.8 ? 2200 :
      k < 6.8 ? 2800 :
      k < 9.5 ? 2400 :
      k < 12.5 ? 3200 :
      k < 18 ? 4200 :
      100000;
    // On phones, keep the overview sparse (small screen) but open up as you zoom
    // in — there's screen space to fill, and the user wants iOS to feel as dynamic
    // as desktop. Now that the compact overview discloses fewer (bigger) dots, it
    // can carry a few more labels. Multiplier ramps 0.56 -> 1.0 across the range.
    if (!compact) return cap;
    const mult = 0.65 + 0.31 * smoothStep((k - 1.6) / 4.5);
    return Math.round(cap * mult);
  }

  function placeLabelLimit(k: number): number {
    // Background city context. Desktop carries more of it for a higher-resolution
    // backdrop; city names still yield to NERC org labels/bubbles via blockers,
    // so they never crowd out the data. Mobile stays modest (small screen).
    if (compact) return 10;
    if (k < 1.8) return 16;
    if (k < 4.8) return 34;
    return 60;
  }

  function placeDotMinK(tier: number): number {
    return tier === 1 ? 0.72 : tier === 2 ? 1.4 : 2.6;
  }

  function placeLabelMinK(tier: number): number {
    return tier === 1 ? 0.72 : tier === 2 ? 1.6 : 3.4;
  }

  function placeDotRadius(p: Place): number {
    return (p.tier === 1 ? 2.8 : p.tier === 2 ? 2.3 : 1.9) * unitPerPx;
  }

  function visualRadius(o: Org, k: number): number {
    // Simple visual-priority sizing: low-priority entities stay small but visible,
    // while authority, regulated, public, and reliability organizations get more
    // area. Radius is in CSS pixels, then converted to SVG units for the viewBox.
    const rawPriority = visualPriority(o);
    const priority = rawPriority / 100;
    const minPx = compact ? 1.7 : 1.7;
    const maxPx = compact ? 24 : MAX_RADIUS;
    const fullPx = minPx + (maxPx - minPx) * priority;
    // Bubbles start smaller at the overview so many more organizations fit on
    // screen at once (denser national/mid view), then grow toward full size as the
    // user zooms in. Desktop keeps a gentle ramp so mid-low zoom doesn't balloon.
    const zoomT = smoothStep((k - 0.72) / (compact ? 3.5 : 12));
    const overviewScale = compact ? 0.4 : 0.46;
    const basePx = fullPx * (overviewScale + (1 - overviewScale) * zoomT);
    const closeT = smoothStep((k - 2.1) / (compact ? 7.5 : 8.5));
    const priorityT = smoothStep((rawPriority - 42) / 58);
    const boostPx = canGrowAtZoom(o) ? (compact ? 6 : 10) * priorityT * closeT : 0;
    // Mid-zoom lift for grid leadership so BA/RC/PC/TOP/TSP stay ahead after the
    // small-org growth pass; fades once deep-zoom catch-up kicks in.
    const leadershipMidBoost = isGridLeadershipOrg(o)
      ? (compact ? 4 : 6.5) * smoothStep((k - 0.85) / 2.4) * (1 - smoothStep((k - 7.5) / 3.5))
      : 0;
    // Deep-zoom boost, weighted toward the smallest orgs: if you keep zooming
    // into a low-priority entity it grows so its name can finally read.
    const deepT = smoothStep((k - (compact ? 6 : 7)) / (compact ? 22 : 26));
    const smallOrgT = smoothStep((72 - rawPriority) / 62);
    const dominance = growthDominanceFactor(o, k);
    const deepBoostMaxPx = 13;
    const deepBoostPx = canGrowAtZoom(o)
      ? deepBoostMaxPx * deepT * (0.25 + 0.75 * smallOrgT) * (isDeferredMarketOrg(o) ? 0.55 : 1) * dominance
      : 0;
    // Continuous growth applied to every bubble across the whole zoom range, so
    // that going one step deeper always yields visibly larger circles instead of
    // plateauing once basePx saturates. Ramps smoothly from the overview to deep
    // zoom, scaled by priority so important orgs grow the most.
    const wideT = smoothStep((k - 1) / 36);
    const zoomGrowthPx = (compact ? 12 : 18) * wideT * (0.18 + 0.82 * priority) * dominance;
    const zoomMaxPx =
      maxPx +
      (canGrowAtZoom(o) ? (compact ? 6 : 10) : 0) +
      (canGrowAtZoom(o) ? deepBoostMaxPx : 0) +
      (compact ? 12 : 18);
    // Deep-zoom minimum: once you are zoomed right in, no visible org should stay
    // tiny when there is clearly room — every bubble reaches a readable floor so
    // its label can show. Screen coords are spread far apart at this zoom, so the
    // floor never reintroduces overlap (placement re-solves per bucket).
    const deepMinPx =
      (compact ? 6.5 : 7.5) *
      smoothStep((k - 8) / 16) *
      (isGridLeadershipOrg(o) ? 1 : smoothStep((rawPriority - 22) / 38));
    // Overview floor for AK/HI inset dots — lift the smallest utilities in the
    // tiny projection inset without changing mainland sizing.
    const insetOverviewMinPx = isUsInsetOrg(o)
      ? (compact ? 6.4 : 7) * smoothStep((2.8 - k) / 2)
      : 0;
    const postRevealT = postRevealBoostT(o, k);
    const postRevealPx = postRevealT
      * (isDeferredMarketOrg(o) ? (compact ? 18 : 22) : isTransmissionOwnerOnly(o) ? (compact ? 10 : 12) : 0);
    const microRevealMinPx =
      postRevealT * (isDeferredMarketOrg(o) ? (compact ? 9 : 11) : (compact ? 6.5 : 7.5));
    return (
      Math.max(
        minPx,
        deepMinPx,
        insetOverviewMinPx,
        microRevealMinPx,
        Math.min(
          zoomMaxPx,
          basePx + boostPx + leadershipMidBoost + deepBoostPx + zoomGrowthPx + postRevealPx,
        ),
      ) * unitPerPx * phoneSizeScale() * ORG_CONTENT_SCALE
    );
  }

  // Puerto Rico / U.S. Virgin Islands inset dots are schematic (uniform, not
  // priority-based) so they fit the offshore cluster; scaled up — few orgs, ample space.
  function territoryBubbleRadiusPx(): number {
    return (compact ? TERRITORY_BUBBLE_RADIUS_PX.compact : TERRITORY_BUBBLE_RADIUS_PX.desktop)
      * TERRITORY_BUBBLE_SCALE;
  }

  function territoryHitRadiusPx(): number {
    return (compact ? TERRITORY_HIT_RADIUS_PX.compact : TERRITORY_HIT_RADIUS_PX.desktop)
      * TERRITORY_BUBBLE_SCALE;
  }

  function renderedRadius(o: Org, k: number): number {
    if (o._frame === "terr") return territoryBubbleRadiusPx() * unitPerPx;
    const fallback = !!o._renderFallback;
    // Memoize: visualRadius is heavy and called many times per org per frame.
    // The result only depends on (o, k, unitPerPx, compact); radiusGen folds in
    // the latter two, so panning (constant k) reuses the cached value.
    if (o._vrk === k && o._vrGen === radiusGen && o._vr != null && o._vrFallback === fallback) {
      return o._vr;
    }
    const v = fallback
      ? fallbackTinyRadiusPx(k) * unitPerPx * ORG_CONTENT_SCALE
      : visualRadius(o, k);
    o._vr = v;
    o._vrk = k;
    o._vrGen = radiusGen;
    o._vrFallback = fallback;
    return v;
  }

  function hitTargetRadius(o: Org, k: number): number {
    if (o._frame === "terr") return territoryHitRadiusPx() * unitPerPx;
    if (o._renderFallback) {
      const visual = renderedRadius(o, k);
      return Math.max(visual + 2 * unitPerPx, (compact ? 8 : 6) * unitPerPx);
    }
    // Every shown bubble is fully placed, so tap targets track the visible radius
    // plus a small pad and a floor — no per-dot reveal strength to fold in.
    const visual = renderedRadius(o, k);
    const priority = visualPriority(o);
    // Floors keep even modest mid-priority utilities (e.g. western irrigation /
    // municipal districts like TID, IID, LADWP) comfortably clickable when their
    // bubble is small at the overview.
    // Tap-target floors are kept independent of the (smaller) visual radius so a
    // tiny bubble still gets a comfortable hit ring. On narrow phones they are
    // scaled up further via phoneSizeScale so small orgs stay easy to select.
    const tapScale = phoneSizeScale();
    const overviewFloorPx = (compact
      ? priority < 30 ? 11.5 : 15
      : priority < 30 ? 5 : priority < 55 ? 6.2 : 7.5) * tapScale;
    const deepFloorPx = (compact
      ? priority < 30 ? 7.8 : 9
      : priority < 30 ? 2.8 : priority < 55 ? 3.4 : 4.4) * tapScale;
    const deepT = smoothStep((k - 10) / 18);
    const floorPx = overviewFloorPx + (deepFloorPx - overviewFloorPx) * deepT;
    const overviewPadPx = compact ? (priority < 30 ? 2.4 : 3.4) : priority < 30 ? 1 : priority < 55 ? 1.5 : 2.4;
    const deepPadPx = compact ? (priority < 30 ? 0.8 : 1.2) : priority < 30 ? 0.35 : priority < 55 ? 0.55 : 0.8;
    const padPx = overviewPadPx + (deepPadPx - overviewPadPx) * deepT;
    // Tie the hit ring to the rendered bubble: a proportional margin so large
    // circles get a proportionally larger tap target, while the absolute floor
    // keeps the smallest dots comfortably clickable. This keeps clickable areas
    // in sync as bubbles grow with zoom.
    const margin = Math.max(padPx * unitPerPx, visual * 0.05);
    let target = Math.max(visual + margin, floorPx * unitPerPx);
    // Inset utilities sit tight at overview; keep tap rings generous without
    // changing mainland hit math.
    if (isUsInsetOrg(o)) {
      const insetClickPx = (compact ? 11.5 : 9.2) * smoothStep((3 - k) / 2.2);
      target = Math.max(target, insetClickPx * unitPerPx);
    }
    if (isMicroOrg(o)) {
      const microClickPx =
        (isDeferredMarketOrg(o) ? (compact ? 13 : 11) : compact ? 10 : 8.5) * postRevealBoostT(o, k);
      target = Math.max(target, microClickPx * unitPerPx);
    }
    return target;
  }

  function boxesOverlap(
    a: { x0: number; x1: number; y0: number; y1: number },
    b: { x0: number; x1: number; y0: number; y1: number },
  ): boolean {
    return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
  }

  function smoothStep(t: number): number {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  }

  function spiderFanScale(_k: number): number {
    // Disabled: coincident origins are now separated by the ring placement in
    // computePlacements, so there is no separate fan-out term to add at render
    // (an extra offset here would move a bubble off its solved, on-land spot).
    return 0;
  }

  function declutterBucket(k: number): number {
    // Finer buckets so bubbles re-solve their positions more often as the zoom
    // changes (rule: allow repositioning as zoom changes), and so the placement
    // radius tracks the rendered radius closely (helps guarantee no overlap).
    if (k < 2.6) return Math.round(k * 4) / 4; // 0.25 steps
    if (k < 8) return Math.round(k * 2) / 2; // 0.5 steps
    return Math.round(k);
  }

  function deepDeclutterT(k: number): number {
    return smoothStep((k - 8) / 28);
  }

  function maxDeclutterOffset(k: number): number {
    // Tight leash: declutter may nudge a bubble only around its own projected
    // location. This prevents entities from drifting to distant land just to find
    // a gap.
    const basePx = compact
      ? k < 1.25 ? 4 : k < 2.2 ? 5 : k < 4 ? 7 : k < 7 ? 9 : 11
      : k < 1.25 ? 5 : k < 2.2 ? 7 : k < 4 ? 9 : k < 7 ? 12 : 15;
    const deepPx = compact ? 14 : 20;
    return (basePx + (deepPx - basePx) * deepDeclutterT(k)) * unitPerPx;
  }

  // _dx/_dy are solved in screen-space SVG units. Dividing by k keeps the
  // visible nudge stable inside the zoomed group without mutating _x/_y.
  function declutterScale(k: number): number {
    return 1 / Math.max(k, 0.001);
  }

  // How far (screen viewBox units) a bubble center may sit from its true origin
  // while it hunts for space. Bounded at every zoom; grows only modestly so a
  // bubble never flies across the map.
  function placementRadius(bucket: number): number {
    return maxDeclutterOffset(bucket);
  }

  function orgPlacementRadius(o: Org, bucket: number): number {
    const radius = placementRadius(bucket);
    // Deferred market dots are tiny and can move a touch more, but still stay
    // close to their own origin.
    if (isDeferredMarketOrg(o)) return radius * 1.15;
    // AK/HI insets are a small projected region. Cap their travel to a modest
    // absolute amount (not a multiple of the large mainland offset) so dots fan
    // out within the inset land instead of flying out into open water.
    if (isUsInsetOrg(o)) {
      const spreadT = smoothStep((4 - bucket) / 3.2);
      return Math.min(radius, (compact ? 11 : 14) * unitPerPx * (1 + 0.15 * spreadT));
    }
    // Midwest clusters still get a small extra search, but not enough to detach
    // them from local geography.
    if (isMidwestOrg(o)) {
      const spreadT = smoothStep((6 - bucket) / 4.5);
      return radius * (1 + (compact ? 0.08 : 0.12) * spreadT);
    }
    return radius;
  }

  // Deterministic candidate offsets around an origin: the origin itself, then
  // simple rings outward up to maxRadius. Rings increase in radius so iterating
  // in order means the nearest valid spot wins. No randomness, no jitter.
  function candidatePositions(maxRadius: number, step: number): Array<[number, number]> {
    const spots: Array<[number, number]> = [[0, 0]];
    for (let ring = 1; ring * step <= maxRadius + 1e-6; ring++) {
      const radius = ring * step;
      const count = Math.max(6, Math.round((Math.PI * 2 * radius) / step));
      const phase = (ring % 2) * (Math.PI / count);
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + phase;
        spots.push([Math.cos(ang) * radius, Math.sin(ang) * radius]);
      }
    }
    return spots;
  }

  function orgRenderX(o: Org, fanScale = spiderFanScale(transform.k), declScale = declutterScale(transform.k)): number {
    return (o._x as number) + (o._dx ?? 0) * declScale + (o._rx ?? 0) * fanScale;
  }

  function orgRenderY(o: Org, fanScale = spiderFanScale(transform.k), declScale = declutterScale(transform.k)): number {
    return (o._y as number) + (o._dy ?? 0) * declScale + (o._ry ?? 0) * fanScale;
  }

  function spiderOffset(index: number, total: number, step: number): [number, number] {
    let ringStart = 0;
    let remaining = total;
    let ring = 1;
    while (true) {
      const ringCapacity = ring === 1 ? 6 : ring * 8;
      const ringCount = Math.min(remaining, ringCapacity);
      if (index < ringStart + ringCount) {
        const slot = index - ringStart;
        const angleStep = (Math.PI * 2) / ringCount;
        const angle = -Math.PI / 2 + slot * angleStep + (ring % 2 === 0 ? angleStep / 2 : 0);
        const radius = step * ring;
        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
      }
      ringStart += ringCount;
      remaining -= ringCount;
      ring += 1;
    }
  }

  function assignSpiderOffsets(): void {
    const clusters = new Map<string, Org[]>();
    for (const o of orgs) {
      o._rx = 0;
      o._ry = 0;
      if (o._x == null || o._y == null) continue;
      const key = `${Math.round(o._x / SPIDER_CLUSTER_EPSILON)}:${Math.round(o._y / SPIDER_CLUSTER_EPSILON)}`;
      const cluster = clusters.get(key);
      if (cluster) cluster.push(o);
      else clusters.set(key, [o]);
    }

    const step = SPIDER_RING_STEP_PX * unitPerPx;
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      cluster.sort((a, b) => a.ncr_id.localeCompare(b.ncr_id));
      const insetCluster = cluster.some(isUsInsetOrg);
      const midwestCluster = cluster.some(isMidwestOrg);
      const ringStep = insetCluster ? step * 1.42 : midwestCluster ? step * 1.22 : step;
      cluster.forEach((o, i) => {
        const [rx, ry] = spiderOffset(i, cluster.length, ringStep);
        o._rx = rx;
        o._ry = ry;
      });
    }
  }

  function positionOrgMarks(k = transform.k, force = false): void {
    computePlacements(k, force);
    // Render positions only depend on k (panning is handled by the group
    // transform), so skip the per-dot rewrite while k is unchanged.
    if (!force && k === orgMarkK) return;
    orgMarkK = k;
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .attr("cx", (o) => orgRenderX(o, fanScale, declScale))
      .attr("cy", (o) => orgRenderY(o, fanScale, declScale));
    gHit
      .selectAll<SVGCircleElement, Org>("circle.org-hit")
      .attr("cx", (o) => orgRenderX(o, fanScale, declScale))
      .attr("cy", (o) => orgRenderY(o, fanScale, declScale));
  }

  function isPanSourceEvent(event: Event | null | undefined): boolean {
    if (!event) return false;
    const type = event.type;
    return (
      type === "mousedown" ||
      type === "mousemove" ||
      type === "mouseup" ||
      type === "pointerdown" ||
      type === "pointermove" ||
      type === "pointerup" ||
      type === "touchstart" ||
      type === "touchmove" ||
      type === "touchend" ||
      type === "touchcancel"
    );
  }

  function isWheelEvent(event: Event | null | undefined): boolean {
    return event?.type === "wheel";
  }

  function wheelDelta(event: WheelEvent): number {
    const unit = event.deltaMode === 1 ? 0.068 : event.deltaMode ? 1 : 0.0028;
    const pinch = event.ctrlKey ? 4.5 : 1;
    let dy = -event.deltaY * unit * pinch;
    // Cap each frame so mouse-wheel momentum cannot jump several "steps" at once.
    // Pinch (ctrlKey on trackpads) gets a much higher cap so it tracks the
    // fingers smoothly instead of feeling throttled.
    const stepCap = event.ctrlKey ? (compact ? 0.24 : 0.2) : compact ? 0.085 : 0.075;
    dy = Math.sign(dy) * Math.min(Math.abs(dy), stepCap);
    // Same scroll gesture feels similar from overview through deep zoom.
    const k = Math.max(transform.k, 0.72);
    dy /= Math.pow(Math.log10(k + 9), 0.5);
    return dy / (compact ? 0.98 : 0.92);
  }

  function syncZoomGroups(): void {
    const tStr = transform.toString();
    gMap.attr("transform", tStr);
    gInsets.attr("transform", tStr);
    gOverlay.attr("transform", tStr);
    gHit.attr("transform", tStr);
  }

  function redrawWhileWheeling(): void {
    const k = transform.k;
    syncZoomGroups();
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    positionOrgMarks(k);
    gOverlay.selectAll<SVGCircleElement, Org>("circle.org").each(function (o) {
      const node = this as SVGCircleElement;
      if (node.classList.contains("hide")) return;
      const rr = renderedRadius(o, k);
      if (o._rk !== k || o._rr !== rr) {
        node.setAttribute("r", String(rr / k));
        o._rk = k;
        o._rr = rr;
      }
    });
    gHit.selectAll<SVGCircleElement, Org>("circle.org-hit").each(function (o) {
      const node = this as SVGCircleElement;
      if (node.classList.contains("hide")) return;
      const hr = hitTargetRadius(o, k);
      if (hitK !== k || o._hr !== hr) {
        node.setAttribute("r", String(hr / k));
        o._hr = hr;
      }
    });
    hitK = k;
    gLabels.style("opacity", "0.55");
  }

  function scheduleWheelRedraw(): void {
    if (wheelRedrawPending) return;
    wheelRedrawPending = true;
    requestAnimationFrame(() => {
      wheelRedrawPending = false;
      if (wheelZooming) redrawWhileWheeling();
    });
  }

  function finishWheelZoom(): void {
    wheelZooming = false;
    gLabels.style("opacity", null);
    if (zoomBoundsDirty) {
      zoomBoundsDirty = false;
      updateZoomBounds();
    }
    redraw();
  }

  function updateZoomBounds(): void {
    if (!zoomBehavior) return;
    const k = Math.max(transform.k, 0.72);
    const base = (compact ? 190 : 260) * unitPerPx;
    // Looser bounds when zoomed out so overview pans do not hit a wall immediately.
    const pad = base * Math.max(0.6, Math.min(1.85, 1.08 / Math.pow(k, 0.32)));
    zoomBehavior.extent([[0, 0], [W, H]]).translateExtent([[-pad, -pad], [W + pad, H + pad]]);
  }

  function nudgeSelectedOrgIntoView(duration = 280): void {
    if (!zoomBehavior || focusPanPending || tourRunning || userPanning || !selectedOrg) return;
    if (performance.now() - lastPanEndAt < 500) return;
    const k = transform.k;
    if (k < 8) return;
    const focused = selectedOrg;
    if (focused._sx == null || focused._sy == null) return;
    const r = renderedRadius(focused, k);
    const sideSafe = (compact ? 52 : 44) * unitPerPx + r;
    const topSafe = (compact ? 88 : 40) * unitPerPx + r;
    const bottomSafe = (compact ? 84 : 48) * unitPerPx + r;
    let dx = 0;
    let dy = 0;
    if (focused._sx < sideSafe) dx = sideSafe - focused._sx;
    else if (focused._sx > W - sideSafe) dx = W - sideSafe - focused._sx;
    if (focused._sy < topSafe) dy = topSafe - focused._sy;
    else if (focused._sy > H - bottomSafe) dy = H - bottomSafe - focused._sy;
    if (!panel.hidden) {
      const svgRect = svgNode.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const gap = (compact ? 18 : 20) * unitPerPx;
      const panelBox = {
        x0: (panelRect.left - svgRect.left) * unitPerPx - gap,
        x1: (panelRect.right - svgRect.left) * unitPerPx + gap,
        y0: (panelRect.top - svgRect.top) * unitPerPx - gap,
        y1: (panelRect.bottom - svgRect.top) * unitPerPx + gap,
      };
      const overlapsPanel =
        focused._sx + r > panelBox.x0 &&
        focused._sx - r < panelBox.x1 &&
        focused._sy + r > panelBox.y0 &&
        focused._sy - r < panelBox.y1;
      if (overlapsPanel) {
        if (compact) {
          const targetY = Math.max(topSafe, panelBox.y0 - r);
          dy = Math.min(dy, targetY - focused._sy);
        } else {
          const targetX = Math.max(sideSafe, panelBox.x0 - r);
          dx = Math.min(dx, targetX - focused._sx);
        }
      }
    }
    if (Math.abs(dx) < 0.5 * unitPerPx && Math.abs(dy) < 0.5 * unitPerPx) return;
    focusPanPending = true;
    requestAnimationFrame(() => {
      focusPanPending = false;
      animateTransform(zoomIdentity.translate(transform.x + dx, transform.y + dy).scale(k), duration);
    });
  }

  // Size the viewBox to match the element's aspect ratio so a tall phone gets a
  // tall viewBox (no letterboxed top/bottom bands where nothing rendered). The
  // base dimension stays fixed so the map's physical scale is stable.
  function measure(): void {
    const rect = svgNode.getBoundingClientRect();
    const elW = rect.width || 960;
    const elH = rect.height || 600;
    const aspect = elW / elH;
    const base = 960 / 600;
    if (aspect >= base) {
      H = 600;
      W = Math.round(600 * aspect);
    } else {
      W = 960;
      H = Math.round(960 / aspect);
    }
    unitPerPx = W / elW;
    compact = elW < 640;
    phone = elW < 450;
    radiusGen++; // unitPerPx/compact/phone may have changed — invalidate radius memo
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    updateZoomBounds();
  }

  // (Re)fit the projection to the current viewBox and push fresh coordinates to
  // the map paths and org circles. Safe to call before circles exist (init) or
  // on every resize.
  function project(): void {
    if (!nationFeature) return;
    hitK = NaN;
    invalidateOrgLayout();
    const fitPadX = (compact ? 30 : 18) * unitPerPx;
    const fitPadY = (compact ? 12 : 8) * unitPerPx;
    const territoryLane = territoryLayoutMetrics(compact, unitPerPx, W, H).laneW;
    projection.fitExtent(
      [
        [fitPadX, fitPadY],
        [W - fitPadX - territoryLane, H - fitPadY],
      ],
      nationFeature as never,
    );
    // Lock the Canada conic onto the composite's lower-48 scale/translate.
    canadaProj.scale(projection.scale()).translate(projection.translate() as [number, number]);
    if (canadaFeature) gMap.select<SVGPathElement>("path.canada").attr("d", canadaPath(canadaFeature as never));
    gMap.selectAll<SVGPathElement, unknown>("path.state").attr("d", path as never);
    gMap.select<SVGPathElement>("path.nation").attr("d", path((nationOutline ?? nationFeature) as never));
    buildLandMask();

    for (const o of orgs) {
      o._rk = undefined;
      o._dx = 0;
      o._dy = 0;
      o.map_location_rank = undefined;
      o._locXY = [];
      if (o.out_of_footprint) {
        o._x = undefined;
        o._y = undefined;
        o._frame = TERRITORY_STATES.has(o.state ?? "") ? "terr" : undefined;
        continue;
      }
      const slots = o.locations?.length ? o.locations : null;
      if (slots) {
        for (const loc of slots) {
          if (loc.lat == null || loc.lng == null) {
            o._locXY.push(null);
            continue;
          }
          const proj = loc.country === "CA" ? canadaProj : projection;
          const p = proj([loc.lng, loc.lat]);
          if (!p) {
            o._locXY.push(null);
            continue;
          }
          o._locXY.push({
            rank: loc.rank,
            x: p[0],
            y: p[1],
            frame: loc.country === "CA" ? "ca" : "us",
          });
        }
        const primary = o._locXY.find((l) => l?.rank === 1) ?? o._locXY.find(Boolean) ?? null;
        if (primary) {
          o._frame = primary.frame;
          o._x = primary.x;
          o._y = primary.y;
        } else {
          o._x = undefined;
          o._y = undefined;
        }
        continue;
      }
      if (o.lng == null || o.lat == null) {
        o._x = undefined;
        o._y = undefined;
        continue;
      }
      const proj = o.country === "CA" ? canadaProj : projection;
      const p = proj([o.lng, o.lat]);
      if (!p) {
        o._x = undefined;
        o._y = undefined;
        continue;
      }
      o._frame = o.country === "CA" ? "ca" : "us";
      o._x = p[0];
      o._y = p[1];
      o._locXY.push({ rank: 1, x: p[0], y: p[1], frame: o._frame });
    }

    layoutTerritoryInsets();
    drawTerritoryFrames();
    placeableOrgs = orgs.filter((o) => o._x != null && o._y != null);
    assignSpiderOffsets();
    positionOrgMarks(transform.k, true);
    computeLandLabels();
    for (const p of places) {
      const xy = projection([p.lng, p.lat]);
      p._x = xy ? xy[0] : undefined;
      p._y = xy ? xy[1] : undefined;
    }
  }

  // Rasterize the US + Canada silhouette into a coarse land mask in viewBox
  // coordinates. Cheap to build (~once per project/resize) and O(1) to query, so
  // the declutter solver can keep dots from drifting far out to sea. Best-effort:
  // if no 2D canvas is available the mask stays null and clamping is skipped.
  function buildLandMask(): void {
    landMask = null;
    if (!nationFeature) return;
    // ~6 viewBox units per cell: fine enough to trace the coastline, coarse
    // enough to stay tiny (a few thousand cells) and fast on iOS.
    maskScale = 6;
    maskW = Math.max(1, Math.ceil(W / maskScale));
    maskH = Math.max(1, Math.ceil(H / maskScale));
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    try {
      canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(maskW, maskH)
          : Object.assign(document.createElement("canvas"), { width: maskW, height: maskH });
    } catch {
      return;
    }
    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return;
    ctx.save();
    ctx.scale(1 / maskScale, 1 / maskScale);
    ctx.fillStyle = "#fff";
    const maskPath = geoPath(projection, ctx as CanvasRenderingContext2D);
    ctx.beginPath();
    maskPath(nationFeature as never);
    ctx.fill();
    if (canadaFeature) {
      const cPath = geoPath(canadaProj, ctx as CanvasRenderingContext2D);
      ctx.beginPath();
      cPath(canadaFeature as never);
      ctx.fill();
    }
    ctx.restore();
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, maskW, maskH).data;
    } catch {
      return;
    }
    const mask = new Uint8Array(maskW * maskH);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 40 ? 1 : 0;
    landMask = mask;
  }

  // True when (x, y) in viewBox space sits on land (or just off any edge, so
  // dots near the viewport border aren't yanked inward). Null mask => treat all
  // as land (no clamping).
  function onLand(x: number, y: number): boolean {
    if (!landMask) return true;
    const mx = Math.floor(x / maskScale);
    const my = Math.floor(y / maskScale);
    if (mx < 0 || my < 0 || mx >= maskW || my >= maskH) return true;
    return landMask[my * maskW + mx] === 1;
  }

  // Pick true origin or the nearest on-land candidate for a fallback tiny dot.
  // Does not claim collision grid space — normal bubbles keep priority.
  function findFallbackTinySlot(
    slots: Array<{ rank: 1 | 2 | 3; ox: number; oy: number; bx: number; by: number }>,
    bucket: number,
    offsets: Array<[number, number]>,
    onLandHere: (cx: number, cy: number, r: number) => boolean,
  ): { slot: (typeof slots)[0]; dx: number; dy: number } | null {
    if (!slots.length) return null;
    const tinyR = fallbackTinyRadiusPx(bucket) * unitPerPx * ORG_CONTENT_SCALE;
    for (const slot of slots) {
      if (onLandHere(slot.ox, slot.oy, tinyR)) return { slot, dx: 0, dy: 0 };
      for (const [dx, dy] of offsets) {
        const cx = slot.ox + dx;
        const cy = slot.oy + dy;
        if (onLandHere(cx, cy, tinyR)) return { slot, dx, dy };
      }
    }
    return { slot: slots[0], dx: 0, dy: 0 };
  }

  // Deterministic bubble placement for a zoom bucket. Each org has a true
  // projected origin (_x/_y); a bubble may move only within placementRadius of
  // that origin to find space. Higher-priority bubbles place first and claim the
  // best spots; lower-priority bubbles take whatever room is left. A bubble that
  // finds no valid spot is demoted to a quiet fallback dot at its true origin
  // (placementMode = fallbackTiny). Bubble placement depends only on the zoom
  // bucket — never on pan.
  //
  // _x/_y stay the true projected coordinates (used by projection math); _dx/_dy
  // are the solved screen-space nudge (divided by k at render so the origin stays
  // true). Positions here are in screen viewBox units = origin * bucket.
  function computePlacements(k = transform.k, force = false): void {
    const bucket = declutterBucket(k);
    if (!force && bucket === orgLayoutBucket) return;
    orgLayoutBucket = bucket;

    // No margin: bubbles pack edge-to-edge so they can touch but never overlap.
    // We reserve each bubble at the LARGEST radius it reaches anywhere in this
    // zoom bucket (its upper edge), so within the bucket two neighbours touch at
    // most (at the top of the bucket) and are otherwise a hair apart — never
    // overlapping, with no built-in margin.
    const bucketTop = bucket < 2.6 ? bucket + 0.125 : bucket < 8 ? bucket + 0.25 : bucket + 0.5;
    const reserveR = (o: Org): number => Math.max(renderedRadius(o, bucket), renderedRadius(o, bucketTop));
    type SlotOrigin = { rank: 1 | 2 | 3; ox: number; oy: number; bx: number; by: number };
    type Item = { o: Org; slots: SlotOrigin[]; r: number };
    const items: Item[] = [];
    for (const o of orgs) {
      o._dx = 0;
      o._dy = 0;
      o.map_location_rank = undefined;
      o.placementMode = undefined;
      o._renderFallback = false;
      if (!canDisplayOrg(o, bucket)) {
        o._placed = false;
        continue;
      }
      // Territory inset dots are positioned by layoutTerritoryInsets and always
      // shown — they don't take part in the mainland packing.
      if (o._frame === "terr") {
        o._placed = true;
        o.placementMode = "bubble";
        continue;
      }
      const slotOrigins: SlotOrigin[] = [];
      for (const loc of o._locXY ?? []) {
        if (!loc) continue;
        slotOrigins.push({
          rank: loc.rank,
          ox: loc.x * bucket,
          oy: loc.y * bucket,
          bx: loc.x,
          by: loc.y,
        });
      }
      if (!slotOrigins.length && o._x != null && o._y != null) {
        slotOrigins.push({
          rank: 1,
          ox: o._x * bucket,
          oy: o._y * bucket,
          bx: o._x,
          by: o._y,
        });
      }
      if (!slotOrigins.length) {
        o._placed = false;
        continue;
      }
      items.push({ o, slots: slotOrigins, r: reserveR(o) });
    }
    if (!items.length) return;

    // Higher visual-priority orgs place first; zero-priority roles do not affect
    // the ordering.
    items.sort((a, b) => visualPrioritySort(a.o, b.o));

    const radius = placementRadius(bucket);
    const maxR = items.reduce((m, it) => Math.max(m, it.r), 0);
    const step = Math.max(5 * unitPerPx, radius / 7);
    const offsetsByRadius = new Map<number, Array<[number, number]>>();
    const offsetsFor = (maxRadius: number): Array<[number, number]> => {
      const key = Math.round(maxRadius / unitPerPx);
      const existing = offsetsByRadius.get(key);
      if (existing) return existing;
      const offsets = candidatePositions(maxRadius, step);
      offsetsByRadius.set(key, offsets);
      return offsets;
    };

    // Spatial grid of already-placed bubbles for O(1) overlap queries.
    const cell = Math.max(2 * maxR + 2 * unitPerPx, step);
    const grid = new Map<string, Array<{ x: number; y: number; r: number }>>();
    const cellKey = (cx: number, cy: number): string =>
      Math.floor(cx / cell) + ":" + Math.floor(cy / cell);
    const fits = (cx: number, cy: number, r: number): boolean => {
      const gx = Math.floor(cx / cell);
      const gy = Math.floor(cy / cell);
      for (let ix = -1; ix <= 1; ix++) {
        for (let iy = -1; iy <= 1; iy++) {
          const arr = grid.get(gx + ix + ":" + (gy + iy));
          if (!arr) continue;
          for (const p of arr) {
            const dx = p.x - cx;
            const dy = p.y - cy;
            const min = p.r + r;
            if (dx * dx + dy * dy < min * min) return false;
          }
        }
      }
      return true;
    };
    const claim = (cx: number, cy: number, r: number): void => {
      const key = cellKey(cx, cy);
      const arr = grid.get(key);
      if (arr) arr.push({ x: cx, y: cy, r });
      else grid.set(key, [{ x: cx, y: cy, r }]);
    };
    // Stricter land test for the wide (2x) search: the center plus four points at
    // most of the bubble radius must be on land (one of four may be coastal water),
    // so a far-flung candidate that sits over the ocean is rejected. This lets the
    // search roam widely for density without stranding bubbles offshore. The mask
    // is base-space, so divide screen-space candidates by the bucket.
    const onLandHere = (cx: number, cy: number, r: number): boolean => {
      if (!onLand(cx / bucket, cy / bucket)) return false;
      const rr = r * 0.72;
      let water = 0;
      if (!onLand((cx + rr) / bucket, cy / bucket)) water++;
      if (!onLand((cx - rr) / bucket, cy / bucket)) water++;
      if (!onLand(cx / bucket, (cy + rr) / bucket)) water++;
      if (!onLand(cx / bucket, (cy - rr) / bucket)) water++;
      return water <= 1;
    };

    for (const it of items) {
      let placed = false;
      const offsets = offsetsFor(orgPlacementRadius(it.o, bucket));
      slotLoop: for (const slot of it.slots) {
        for (const [dx, dy] of offsets) {
          const cx = slot.ox + dx;
          const cy = slot.oy + dy;
          if (!onLandHere(cx, cy, it.r)) continue;
          if (!fits(cx, cy, it.r)) continue;
          it.o._dx = dx;
          it.o._dy = dy;
          it.o._x = slot.bx;
          it.o._y = slot.by;
          it.o.map_location_rank = slot.rank;
          it.o._placed = true;
          it.o.placementMode = "bubble";
          claim(cx, cy, it.r);
          placed = true;
          break slotLoop;
        }
      }
      if (!placed) {
        const land = findFallbackTinySlot(
          it.slots,
          bucket,
          offsetsFor(orgPlacementRadius(it.o, bucket)),
          onLandHere,
        );
        if (!land) {
          it.o._placed = false;
          continue;
        }
        it.o._placed = true;
        it.o.placementMode = "fallbackTiny";
        it.o._dx = land.dx;
        it.o._dy = land.dy;
        it.o._x = land.slot.bx;
        it.o._y = land.slot.by;
        it.o.map_location_rank = land.slot.rank;
      }
    }
  }

  // U.S. state + Canadian province name anchors (base coordinates), drawn faintly
  // as background context with NERC labels always taking precedence.
  function computeLandLabels(): void {
    landLabels = [];
    for (const f of stateFeatures) {
      const name = (f as { properties?: { name?: string } }).properties?.name;
      if (!name) continue;
      const c = path.centroid(f as never);
      if (!c || Number.isNaN(c[0]) || Number.isNaN(c[1])) continue;
      landLabels.push({ name, x: c[0], y: c[1], small: SMALL_STATES.has(name) });
    }
    for (const p of PROVINCE_LABELS) {
      const xy = canadaProj([p.lng, p.lat]);
      if (!xy) continue;
      landLabels.push({ name: p.name, x: xy[0], y: xy[1], small: false });
    }
  }

  let resizePending = false;
  function onResize(): void {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      measure();
      project();
      redraw();
    });
  }

  let rafPending = false;
  function scheduleRedraw(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      redraw();
    });
  }

  function redraw(): void {
    const k = transform.k;
    syncZoomGroups();
    // Recompute viewport visibility on pan as well as zoom. The previous pan-only
    // fast path translated existing labels but never admitted newly panned-in
    // organizations, so off-screen areas stayed blank until a zoom forced layout.
    gLabels.attr("transform", null);
    gPlaces.attr("transform", null);
    gLand.attr("transform", null);
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    for (const o of orgs) {
      o._renderFallback = o.placementMode === "fallbackTiny";
    }
    positionOrgMarks(k);

    const hot = hoverOrg;
    const tourActive = tourIds.size > 0;
    // While a tour runs but no step is showing (tourRunning && !tourActive) the
    // map "blanks": everything dims, nothing is labelled. That makes each role
    // reveal read clearly and idles the breathing animation (cheaper on iOS).
    // Hit radii mostly track zoom, but also follow the resolved visual radius so
    // deep-zoom panning doesn't leave stale targets.
    const hitChanged = hitK !== k;
    hitK = k;

    // Project to screen space once, drop off-screen dots, collect label candidates.
    const margin = 90;
    const candidates: Org[] = [];
    const visibleOrgs: Org[] = [];
    let shownCount = 0;
    for (const o of placeableOrgs) {
      if (o._x == null || o._y == null) {
        o._vis = false;
        continue;
      }
      const sx = transform.applyX(orgRenderX(o, fanScale, declScale));
      const sy = transform.applyY(orgRenderY(o, fanScale, declScale));
      o._sx = sx;
      o._sy = sy;
      const onScreen = sx >= -margin && sx <= W + margin && sy >= -margin && sy <= H + margin;
      // Disclosure is zoom-only: a dot shows once it found a non-overlapping spot
      // at this zoom bucket (computePlacements sets _placed), or as a fallback
      // tiny dot when placement failed. Panning never changes the set.
      const displayable = canDisplayOrg(o, k);
      const due = displayable && (o._frame === "terr" || o._placed === true);
      const forced = displayable && (hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id || tourIds.has(o.ncr_id));
      const vis = onScreen && (due || forced);
      o._vis = vis;
      if (!vis) continue;
      shownCount++;
      visibleOrgs.push(o);
    }

    for (const o of visibleOrgs) {
      const isTerr = o._frame === "terr";
      const forced = isLabelForced(o, tourActive, hot);
      if (tourActive) {
        // During a walkthrough step only the highlighted set gets labels.
        if (forced && (!isTerr || hot?.ncr_id === o.ncr_id)) candidates.push(o);
      } else if (!tourRunning && isLabelEligible(o, k, forced)) {
        // Normal map. (During a blank beat — tourRunning && !tourActive — we
        // deliberately collect no candidates so nothing is labelled.)
        candidates.push(o);
      }
    }

    candidates.sort(
      (a, b) =>
        Number(tourIds.has(b.ncr_id)) - Number(tourIds.has(a.ncr_id)) ||
        Number(selectedOrg?.ncr_id === b.ncr_id) - Number(selectedOrg?.ncr_id === a.ncr_id) ||
        labelPrioritySort(a, b) ||
        a.entity_name.localeCompare(b.entity_name),
    );
    // Cap how many candidates we even try during a tour step. Big roles (GO has
    // ~1,500) would otherwise run the placement loop thousands of times each
    // frame while panning — the main walkthrough lag on iOS.
    if (tourActive) {
      const maxConsider = compact ? 110 : 240;
      if (candidates.length > maxConsider) candidates.length = maxConsider;
    }

    type Box = { x0: number; x1: number; y0: number; y1: number };
    type LabelPlacement = { x: number; y: number; font: number; text: string; inside: boolean; centered?: boolean };
    const labelState = new Map<string, LabelPlacement>();
    const placed: Box[] = [];
    // De-dupe identical on-screen tokens only in the broad overview. Once zoomed
    // in, duplicate brands can each carry text when collision room allows.
    const usedLabels = new Set<string>();
    // Bound the animated/highlighted set so it stays cheap on iOS.
    const maxLabels = tourActive ? (compact ? 45 : 130) : labelLimit(k);
    // Keep labels from tucking under the floating topbar. Phones reserve a tall
    // band (the bar is bigger relative to the screen); desktop reserves a slim
    // one so top-row org labels don't hide behind the title chip.
    const topSafe = (compact && !tourActive ? 68 : tourActive ? 0 : 36) * unitPerPx;
    const edgeSafe = compact && !tourActive ? 5 * unitPerPx : 2 * unitPerPx;
    const labeledClusters: Array<{ x: number; y: number }> = [];
    // Phones spread labels a little at first; the inflation now fades back out as
    // you zoom in (was growing), so zoomed-in iOS fills space instead of thinning.
    const spacing = compact && !tourActive ? Math.max(1, 1.25 - Math.max(0, k - 2) * 0.12) : 1;
    // ── Label decision tree (candidates are pre-sorted most-important first) ──
    // For each org, in importance order:
    //   1. INSIDE: if its short token fits inside the bubble at a legible size,
    //      draw it there. Inside labels live within their own bubble, so they
    //      never collide and are never thinned by a neighbour — that is why a
    //      bubble big enough to hold its name always shows it.
    //   2. FLOAT: otherwise place a floating label in preferred spots (on /
    //      beside / below, never above). A floating label may
    //      not overlap an already-placed label, nor any *other* protected
    //      bubble — so a smaller org's label can never sit on a bigger org's
    //      bubble.
    //   3. THIN: identical tokens are de-duped and tight floating clusters are
    //      thinned — floating only; inside labels are exempt.
    // Bubble blockers are added only after a bubble earns a label. Orgs that draw
    // as fallback dots do not reserve bubble space.
    const bubblePad = 0;
    const bubbleBlockers: Array<{ id: string; x: number; y: number; r: number }> = [];
    const bubbleCircle = (o: Org): { x: number; y: number; r: number } | null => {
      if (o._sx == null || o._sy == null) return null;
      return { x: o._sx, y: o._sy, r: renderedRadius(o, k) + bubblePad };
    };
    const circlesOverlap = (
      a: { x: number; y: number; r: number },
      b: { x: number; y: number; r: number },
    ): boolean => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
    const boxOverlapsCircle = (box: Box, circle: { x: number; y: number; r: number }): boolean => {
      const cx = Math.max(box.x0, Math.min(circle.x, box.x1));
      const cy = Math.max(box.y0, Math.min(circle.y, box.y1));
      return (circle.x - cx) ** 2 + (circle.y - cy) ** 2 < circle.r ** 2;
    };
    const bubbleClears = (o: Org): boolean => {
      if (o._frame === "terr") return true;
      const circle = bubbleCircle(o);
      return !!circle && !bubbleBlockers.some((b) => b.id !== o.ncr_id && circlesOverlap(circle, b));
    };
    const addBubbleBlocker = (o: Org): void => {
      if (o._frame === "terr") return;
      const circle = bubbleCircle(o);
      if (circle) bubbleBlockers.push({ id: o.ncr_id, ...circle });
    };
    const clearsBubbles = (box: Box, id: string): boolean =>
      !bubbleBlockers.some((b) => b.id !== id && boxOverlapsCircle(box, b));

    const isHoverLabelTarget = (o: Org): boolean =>
      hot?.ncr_id === o.ncr_id && selectedOrg?.ncr_id !== o.ncr_id && !tourActive;

    // Hover-only labels for visible dots that did not earn persistent text. Prefer
    // inside the bubble, then centred across it; below-the-dot is a last resort.
    const tryHoverUnlabeledLabel = (o: Org): LabelPlacement | null => {
      if (o._sx == null || o._sy == null) return null;
      const sx = o._sx;
      const sy = o._sy;
      const r = renderedRadius(o, k);
      const textOptions = labelTextOptions(o, k);
      const insideChord = isMidwestOrg(o) ? 1.94 : 1.86;
      const hoverInsideMin = (compact ? 5.2 : 5.8) * unitPerPx;
      const hoverAcrossMin = (compact ? 6 : 6.5) * unitPerPx;
      const baseFont = Math.min(labelFontPx(o, k), compact ? 20 : 24) * unitPerPx;
      const labelPadX = (compact ? 4.5 : 5) * unitPerPx;
      const labelPadY = (compact ? 4 : 4.5) * unitPerPx;

      for (const text of textOptions) {
        const insideFont = Math.min(
          baseFont,
          (r * 1.74) / Math.max(1, text.length) / 0.56,
        );
        if (insideFont >= hoverInsideMin && insideFont * 0.56 * text.length <= r * insideChord) {
          return { x: sx, y: sy, font: insideFont, text, inside: true };
        }
      }

      for (const text of textOptions) {
        const acrossFont = Math.min(baseFont, (r * 2.05) / Math.max(1, text.length) / 0.58);
        if (acrossFont < hoverAcrossMin) continue;
        const w = text.length * acrossFont * 0.58;
        const h = acrossFont * 1.15;
        const box: Box = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h * 0.55, y1: sy + h * 0.45 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        return { x: sx, y: sy, font: acrossFont, text, inside: false, centered: true };
      }

      const fallbackFont = hoverAcrossMin;
      for (const text of textOptions) {
        const w = Math.max(10, text.length * fallbackFont * 0.58) + labelPadX * 2;
        const h = fallbackFont + labelPadY * 2;
        const nudge = r + fallbackFont * 0.82 + 2 * unitPerPx;
        const lx = Math.min(W - edgeSafe - w / 2, Math.max(edgeSafe + w / 2, sx));
        const ly = sy + nudge;
        const box: Box = { x0: lx - w / 2, x1: lx + w / 2, y0: ly - h * 0.7, y1: ly + h * 0.3 };
        if (box.y1 <= H - edgeSafe && box.y0 >= topSafe) {
          return { x: lx, y: ly, font: fallbackFont, text, inside: false };
        }
      }
      return { x: sx, y: sy, font: fallbackFont, text: textOptions[0], inside: false, centered: true };
    };

    let placedCount = 0;
    for (const o of candidates) {
      if (placedCount >= maxLabels) break;
      if (isHoverLabelTarget(o)) continue;
      const sx = o._sx as number;
      const sy = o._sy as number;
      const r = renderedRadius(o, k);
      const forceLabel = hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id || tourIds.has(o.ncr_id);
      const brand = tinyName(o);
      const lp = labelPriority(o);

      // 1. INSIDE — preferred, collision-free, never suppressed by neighbours.
      // The font may shrink to span the chord, but only to a readable floor. If
      // it would need to shrink past that point, the label can overflow/float
      // outside its own bubble instead.
      const insideFont = Math.min(
        labelFontPx(o, k) * unitPerPx,
        (r * 1.74) / Math.max(1, brand.length) / 0.56,
      );
      // The readable floor for an inside label relaxes toward zero as you zoom in,
      // so by max zoom every visible (now-large) bubble takes its name inside —
      // any circle on screen ends up labeled when fully zoomed in.
      const deepLabelT = smoothStep((k - 9) / 13);
      const insideMin =
        (compact ? 4.4 : 5) *
        (1 - 0.9 * deepLabelT) *
        (isMidwestOrg(o) ? 0.9 : 1) *
        (lp >= 88 ? (compact ? 0.82 : 0.78) : lp >= 68 ? 0.92 : 1) *
        // Desktop: a very short acronym (e.g. LES, CWLP, ConEd) that nearly fits
        // inside its bubble at low-mid zoom is allowed in at a slightly smaller
        // floor, so easy-to-fit short labels stop falling into a dead zone.
        (!compact && brand.length <= 5 ? 0.85 : 1) *
        unitPerPx;
      const insideChord = isMidwestOrg(o) ? 1.94 : 1.86;
      if (insideFont >= insideMin && insideFont * 0.56 * brand.length <= r * insideChord) {
        const insideDedupK = isMidwestOrg(o) ? 2.0 : 2.2;
        if ((forceLabel || k >= insideDedupK || !usedLabels.has(brand)) && bubbleClears(o)) {
          labelState.set(o.ncr_id, { x: sx, y: sy, font: insideFont, text: brand, inside: true });
          if (!forceLabel) usedLabels.add(brand);
          addBubbleBlocker(o);
          placedCount++;
        }
        continue;
      }

      // Bigger organizations can try a side/below floating label when their
      // token cannot fit inside the bubble. Once zoomed in, any visible org can
      // try for this overflow label; collision checks decide if there is room.
      const midwest = isMidwestOrg(o);
      const shortHighValue = !compact && lp >= 68 && brand.length <= 7;
      const allowFloat =
        forceLabel ||
        (lp >= 88 && k >= (compact ? 1.0 : 0.9)) ||
        (lp >= 78 && k >= (compact ? 1.15 : 1.05)) ||
        (lp >= 68 && k >= (midwest ? 1.35 : 1.45)) ||
        (shortHighValue && k >= 1.7) ||
        (lp >= 52 && k >= (midwest ? 1.75 : 1.95)) ||
        (lp >= 38 && k >= (midwest ? 2.35 : 2.55)) ||
        (lp >= 16 && k >= (midwest ? 3.0 : 3.2));
      if (!allowFloat) continue;
      // Floating labels aren't bounded by a bubble chord (unlike inside labels),
      // so cap their on-screen size to keep deep zoom from producing oversized
      // text that overpowers the map.
      const font = Math.min(labelFontPx(o, k), compact ? 20 : 24) * unitPerPx;
      const padScale = midwest ? 0.92 : 1;
      const labelPadX = (compact ? 4.5 : 5) * unitPerPx * padScale;
      const labelPadY = (compact ? 4 : 4.5) * unitPerPx * padScale;
      const h = (font + labelPadY * 2) * spacing;
      const nudge = (r + font * 0.82 + 2 * unitPerPx) * (midwest ? 1.14 : 1);
      // Sit on the dot, then to the sides, then below, then the below-diagonals.
      // Labels never go above the organization.
      const spots: Array<[number, number]> = [
        [sx, sy + font * 0.32],
        [sx + nudge, sy + font * 0.32],
        [sx - nudge, sy + font * 0.32],
        [sx, sy + nudge],
        [sx + nudge * 0.78, sy + nudge * 0.72],
        [sx - nudge * 0.78, sy + nudge * 0.72],
      ];
      if (midwest) {
        spots.push([sx, sy + nudge * 1.22], [sx + nudge * 0.55, sy + nudge * 1.05]);
      }
      const tryFloatingText = (text: string): { x: number; y: number; box: Box; text: string } | null => {
        const w = (Math.max(10, text.length * font * 0.58) + labelPadX * 2) * spacing;
        for (const [lx, ly] of spots) {
          const box: Box = { x0: lx - w / 2, x1: lx + w / 2, y0: ly - h * 0.7, y1: ly + h * 0.3 };
          if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
          if (placed.some((p) => boxesOverlap(box, p))) continue;
          if (!clearsBubbles(box, o.ncr_id)) continue;
          return { x: lx, y: ly, box, text };
        }
        if (!forceLabel) return null;
        const lx = Math.min(W - edgeSafe - w / 2, Math.max(edgeSafe + w / 2, sx));
        const ly = sy + nudge;
        const box: Box = { x0: lx - w / 2, x1: lx + w / 2, y0: ly - h * 0.7, y1: ly + h * 0.3 };
        if (box.x0 >= edgeSafe && box.x1 <= W - edgeSafe && box.y0 >= topSafe && box.y1 <= H - edgeSafe) {
          return { x: lx, y: ly, box, text };
        }
        return null;
      };
      const textOptions = labelTextOptions(o, k);
      let chosen = tryFloatingText(textOptions[0]);
      if (chosen && textOptions[1]) {
        const upgraded = tryFloatingText(textOptions[1]);
        if (upgraded) chosen = upgraded;
      } else if (!chosen && textOptions[1]) {
        chosen = tryFloatingText(textOptions[1]);
      }
      if (!chosen || !bubbleClears(o)) continue;
      placed.push(chosen.box);
      if (!forceLabel) {
        labeledClusters.push({ x: sx, y: sy });
        usedLabels.add(chosen.text);
      }
      labelState.set(o.ncr_id, { x: chosen.x, y: chosen.y, font, text: chosen.text, inside: false });
      addBubbleBlocker(o);
      placedCount++;
    }

    if (hot?._vis && hot._sx != null && hot._sy != null && isHoverLabelTarget(hot) && !labelState.has(hot.ncr_id)) {
      const hoverLabel = tryHoverUnlabeledLabel(hot);
      if (hoverLabel) labelState.set(hot.ncr_id, hoverLabel);
    }

    for (const o of visibleOrgs) {
      if (!o._vis || o._frame === "terr") continue;
      const forced = hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id || tourIds.has(o.ncr_id);
      o._renderFallback = rendersAsBackgroundDot(
        o,
        labelState.has(o.ncr_id),
        forced,
      );
      if (o._sx != null && o._sy != null) {
        o._sx = transform.applyX(orgRenderX(o, fanScale, declScale));
        o._sy = transform.applyY(orgRenderY(o, fanScale, declScale));
      }
    }

    const finalVisibleOrgs = visibleOrgs.filter((o) => o._vis);

    gOverlay.selectAll<SVGCircleElement, Org>("circle.org").each(function (o) {
      const node = this as SVGCircleElement;
      node.classList.toggle("hide", !o._vis);
      if (!o._vis) return;
      const cx = orgRenderX(o, fanScale, declScale);
      const cy = orgRenderY(o, fanScale, declScale);
      node.setAttribute("cx", String(cx));
      node.setAttribute("cy", String(cy));
      // Radius is set in transform-space (divided by the group scale). It changes
      // with zoom and, for isolated dots, with pan (the boost tracks neighbours),
      // so write only when the resolved radius actually moved — cheap, no storm.
      const rr = renderedRadius(o, k);
      if (o._rk !== k || o._rr !== rr) {
        node.setAttribute("r", String(rr / k));
        o._rk = k;
        o._rr = rr;
      }
      const labeled = labelState.has(o.ncr_id);
      const inTour = tourActive && tourIds.has(o.ncr_id);
      node.classList.toggle("labeled", labeled);
      node.classList.toggle("org-background", visualTier(o) === "background");
      node.classList.toggle("hot", hot?.ncr_id === o.ncr_id);
      node.classList.toggle("selected", selectedOrg?.ncr_id === o.ncr_id);
      // Only the labeled subset breathes (bounded count = cheap on iOS); the
      // rest of the focus set gets a static highlight. During a step everything
      // else dims; during a blank beat (tourRunning, no step) everything dims.
      node.classList.toggle("tour-flash", inTour && labeled);
      node.classList.toggle("tour-pick", inTour && !labeled);
      node.classList.toggle("tour-dim", tourRunning && !inTour);
    });

    gHit.selectAll<SVGCircleElement, Org>("circle.org-hit").each(function (o) {
      const node = this as SVGCircleElement;
      node.classList.toggle("hide", !o._vis);
      if (!o._vis) return;
      const cx = orgRenderX(o, fanScale, declScale);
      const cy = orgRenderY(o, fanScale, declScale);
      node.setAttribute("cx", String(cx));
      node.setAttribute("cy", String(cy));
      node.classList.toggle("hot", hot?.ncr_id === o.ncr_id);
      node.classList.toggle("selected", selectedOrg?.ncr_id === o.ncr_id);
      const hr = hitTargetRadius(o, k);
      if (hitChanged || o._hr !== hr) {
        node.setAttribute("r", String(hr / k));
        o._hr = hr;
      }
    });

    gLabels.selectAll<SVGTextElement, Org>("text.olabel").each(function (o) {
      const node = this as SVGTextElement;
      const state = labelState.get(o.ncr_id);
      node.classList.toggle("dim", !state);
      if (!state) return;
      node.textContent = state.text;
      node.setAttribute("x", String(state.x));
      node.setAttribute("y", String(state.y));
      node.setAttribute("font-size", String(state.font));
      node.classList.toggle("inside", state.inside);
      // Inside labels stay white on every bubble colour; longer tokens get a
      // thicker dark outline so they stay readable instead of switching to dark
      // text. Floating labels keep the stylesheet's default ink.
      if (state.inside) {
        node.style.fill = "#ffffff";
        node.style.stroke = "rgba(7, 17, 14, 0.82)";
        const len = state.text.length;
        const strokeScale = len > 13 ? 0.34 : len > 8 ? 0.3 : 0.26;
        node.style.strokeWidth = String(Math.max(2.2 * unitPerPx, state.font * strokeScale));
      } else {
        node.style.fill = "";
        node.style.stroke = "";
        node.style.strokeWidth = "";
      }
      node.classList.toggle("hover-on-dot", !!state.centered);
      node.classList.toggle("hot-label", hot?.ncr_id === o.ncr_id);
      node.classList.toggle("selected-label", selectedOrg?.ncr_id === o.ncr_id);
      node.classList.toggle("tour-flash", tourActive && !!state);
    });

    // City labels yield to NERC org labels AND bubbles: inflate every org-label
    // box and every bubble into a keep-away region so place names only land in
    // genuinely free space (important in the dense Midwest/Northeast clusters).
    const labelMargin = (compact ? 3 : 3.5) * unitPerPx;
    const placeBlockers: Box[] = placed.map((b) => ({
      x0: b.x0 - labelMargin,
      x1: b.x1 + labelMargin,
      y0: b.y0 - labelMargin,
      y1: b.y1 + labelMargin,
    }));
    for (const o of finalVisibleOrgs) {
      if (o._sx == null || o._sy == null) continue;
      const r = renderedRadius(o, k) + (compact ? 6 : 7) * unitPerPx;
      placeBlockers.push({ x0: o._sx - r, x1: o._sx + r, y0: o._sy - r, y1: o._sy + r });
    }
    // City context. Dots can appear before labels, but every city mark stays
    // visually below NERC data and city labels only fit into leftover space.
    const placeDotState = new Map<string, { x: number; y: number; r: number }>();
    const placeState = new Map<string, { x: number; y: number; font: number }>();
    if (!tourRunning) {
      for (const p of places) {
        if (p._x == null || p._y == null) continue;
        if (k < placeDotMinK(p.tier)) continue;
        const sx = transform.applyX(p._x);
        const sy = transform.applyY(p._y);
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
        placeDotState.set(p.name, { x: sx, y: sy, r: placeDotRadius(p) });
      }

      let placedPlaces = 0;
      const placeCap = placeLabelLimit(k);
      for (const p of places) {
        if (placedPlaces >= placeCap) break;
        if (p._x == null || p._y == null) continue;
        if (k < placeLabelMinK(p.tier)) continue;
        const sx = transform.applyX(p._x);
        const sy = transform.applyY(p._y);
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
        const px = (p.tier === 1 ? 13.5 : p.tier === 2 ? 12 : 10.5) * unitPerPx;
        const w = p.name.length * px * 0.66 + (compact ? 10 : 9) * unitPerPx;
        const h = px + (compact ? 8 : 7) * unitPerPx;
        const box: Box = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h * 0.6, y1: sy + h * 0.4 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        if (placeBlockers.some((q) => boxesOverlap(box, q))) continue;
        placeBlockers.push(box);
        placedPlaces++;
        placeState.set(p.name, { x: sx, y: sy + px * 0.34, font: px });
      }
    }

    gPlaces.selectAll<SVGCircleElement, Place>("circle.place-dot").each(function (p) {
      const node = this as SVGCircleElement;
      const state = placeDotState.get(p.name);
      node.classList.toggle("dim", !state);
      if (!state) return;
      node.setAttribute("cx", String(state.x));
      node.setAttribute("cy", String(state.y));
      node.setAttribute("r", String(state.r));
    });

    gPlaces.selectAll<SVGTextElement, Place>("text.place").each(function (p) {
      const node = this as SVGTextElement;
      const state = placeState.get(p.name);
      node.classList.toggle("dim", !state);
      if (!state) return;
      node.setAttribute("x", String(state.x));
      node.setAttribute("y", String(state.y));
      node.setAttribute("font-size", String(state.font));
    });

    // Land labels (state / province names): faint context that yields to NERC
    // org labels, city labels, and large NERC bubbles. Small dot bodies are not
    // blockers; otherwise the packed national view would hide every name.
    const landState = new Map<string, { x: number; y: number; font: number }>();
    if (!tourRunning) {
      const landBlockers: Box[] = [...placed];
      placeState.forEach((s, name) => {
        const cw = name.length * s.font * 0.66 + (compact ? 10 : 9) * unitPerPx;
        const ch = s.font + (compact ? 8 : 7) * unitPerPx;
        landBlockers.push({ x0: s.x - cw / 2, x1: s.x + cw / 2, y0: s.y - ch * 0.9, y1: s.y + ch * 0.1 });
      });
      for (const o of finalVisibleOrgs) {
        if (o._sx == null || o._sy == null) continue;
        const r = renderedRadius(o, k);
        // Org bubbles take precedence: a land name yields to any bubble it would
        // sit on, so state/province names fade behind the NERC data.
        if (r < (compact ? 6 : 7) * unitPerPx) continue;
        const pad = (compact ? 5.5 : 5) * unitPerPx;
        landBlockers.push({ x0: o._sx - r - pad, x1: o._sx + r + pad, y0: o._sy - r - pad, y1: o._sy + r + pad });
      }
      let placedLand = 0;
      // Thin out the orientation labels as you zoom in — by deep zoom the state
      // name has done its job and would only clutter the view.
      const deepLandT = smoothStep((k - 5) / 8);
      const landCap = Math.max(4, Math.round((compact ? 12 : 34) * (1 - 0.5 * deepLandT)));
      for (const L of landLabels) {
        if (placedLand >= landCap) break;
        if (L.small && k < 3.2) continue; // tiny states only once zoomed in
        if (!L.small && k >= 14) continue; // large state names drop out at deep zoom
        const sx = transform.applyX(L.x);
        const sy = transform.applyY(L.y);
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
        const grow = Math.max(0.85, 1.28 - Math.max(0, k - 1) * 0.06);
        const font = (L.small ? 11 : 15) * grow * unitPerPx;
        const w = L.name.length * font * 0.64 + (compact ? 10 : 9) * unitPerPx;
        const h = font + (compact ? 8 : 7) * unitPerPx;
        const box: Box = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h * 0.6, y1: sy + h * 0.4 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        if (landBlockers.some((q) => boxesOverlap(box, q))) continue;
        landBlockers.push(box);
        placedLand++;
        landState.set(L.name, { x: sx, y: sy, font });
      }
    }

    // Geographic reference labels stay secondary: the more org bubbles are on
    // screen, the more these state/province names recede so organization labels
    // remain the primary focus. They never disappear entirely (floor 0.35).
    const landDensityOpacity = Math.max(0.35, 1 - shownCount / (compact ? 90 : 240));
    gLand.selectAll<SVGTextElement, LandLabel>("text.land-label").each(function (L) {
      const node = this as SVGTextElement;
      const state = landState.get(L.name);
      node.classList.toggle("dim", !state);
      if (!state) return;
      node.setAttribute("x", String(state.x));
      node.setAttribute("y", String(state.y));
      node.setAttribute("font-size", String(state.font));
      node.style.opacity = String(landDensityOpacity);
    });

    // Territory region names ride the inset group's transform (so each label
    // tracks its offshore cluster) but keep a constant on-screen size like every
    // other label: the group already scales by k, so divide the base font by k.
    // Hidden during the walkthrough like the other ambient labels.
    // Slightly smaller at overview, easing up by mid zoom so PR/VI stay readable
    // when the Atlantic lane fills more of the screen.
    const terrFontPx =
      (compact ? 10 : 9.75) * unitPerPx * Math.min(1.08, 0.88 + smoothStep((k - 0.72) / 2.8) * 0.2);
    gInsets
      .selectAll<SVGTextElement, TerritoryBox>("text.terr-label")
      .attr("font-size", terrFontPx / Math.max(k, 0.001))
      .classed("dim", tourRunning);
    lastLabelState = labelState;
  }

  // Lay out-of-footprint territory orgs as labelled clusters of dots — no framed
  // box. Geocoded orgs keep relative geography via geoMercator fitExtent;
  // ungeocoded orgs fall into a centred grid.
  function layoutTerritoryInsets(): void {
    territoryBoxes = [];
    const terrProj = geoMercator();
    const terrPath = geoPath(terrProj);
    // The real island outline (PR/VI) from the states topojson, found by FIPS id.
    const featureFor = (code: string): unknown =>
      stateFeatures.find((f) => String((f as { id?: string | number }).id ?? "") === TERRITORY_FIPS[code]);
    const labelH = (compact ? 12 : 11) * unitPerPx + 5 * unitPerPx;
    const innerPad = 9 * unitPerPx;

    const present = new Map<string, Org[]>();
    for (const o of orgs) {
      const code = o.state;
      if (!code || !o.out_of_footprint || !TERRITORY_STATES.has(code)) continue;
      const arr = present.get(code);
      if (arr) arr.push(o);
      else present.set(code, [o]);
    }

    function boxSize(code: string): [number, number] {
      const u = unitPerPx;
      switch (code) {
        case "PR":
          // Roomier inset so Puerto Rico's many coastal entities spread out and
          // stay individually readable/clickable instead of clumping together.
          return [(compact ? 162 : 198) * u, (compact ? 122 : 144) * u];
        case "VI":
          return [(compact ? 96 : 108) * u, (compact ? 80 : 88) * u];
        default:
          return [(compact ? 74 : 84) * u, (compact ? 64 : 70) * u];
      }
    }

    function sortTerritory(list: Org[]): Org[] {
      return [...list].sort(
        (a, b) =>
          visualPrioritySort(a, b) ||
          Number(b.roles.includes("DP")) - Number(a.roles.includes("DP")) ||
          a.entity_name.localeCompare(b.entity_name),
      );
    }

    function placeInBox(
      code: string,
      label: string,
      x: number,
      y: number,
      boxW: number,
      boxH: number,
      list: Org[],
      landFeature: unknown,
    ): void {
      const geocoded = list.filter((o) => o.lat != null && o.lng != null);
      const ungeocoded = list.filter((o) => o.lat == null || o.lng == null);

      const rect: [[number, number], [number, number]] = [
        [x + innerPad, y + labelH + innerPad * 0.5],
        [x + boxW - innerPad, y + boxH - innerPad],
      ];
      // Fit to the island outline plus org coordinates so every geocoded entity
      // stays on the land shape at geographic positions.
      let landPath: string | null = null;
      let fitTarget: unknown = null;
      if (landFeature && geocoded.length) {
        fitTarget = {
          type: "FeatureCollection",
          features: [
            landFeature,
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "MultiPoint",
                coordinates: geocoded.map((o) => [o.lng as number, o.lat as number]),
              },
            },
          ],
        };
      } else if (landFeature) {
        fitTarget = landFeature;
      } else if (geocoded.length) {
        fitTarget = {
          type: "MultiPoint",
          coordinates: geocoded.map((o) => [o.lng as number, o.lat as number]),
        };
      }
      if (fitTarget) {
        terrProj.fitExtent(rect, fitTarget as never);
        if (landFeature) landPath = terrPath(landFeature as never);
      }
      if (fitTarget) {
        for (const o of geocoded) {
          const p = terrProj([o.lng as number, o.lat as number]);
          o._frame = "terr";
          o._x = p ? p[0] : x + boxW / 2;
          o._y = p ? p[1] : y + boxH / 2;
          o._dx = 0;
          o._dy = 0;
          o._rx = 0;
          o._ry = 0;
        }
      }

      if (ungeocoded.length) {
        const cols = Math.max(2, Math.round(Math.sqrt(ungeocoded.length * 1.7)));
        const cell = (compact ? 17 : 15) * unitPerPx;
        const pad = 6 * unitPerPx;
        // Centre the grid in the region so the cluster (and its label) sit where
        // the territory belongs rather than hugging a now-invisible left edge.
        const startX = x + Math.max(pad, (boxW - cols * cell) / 2) + cell * 0.5;
        ungeocoded.forEach((o, i) => {
          const c = i % cols;
          const r = Math.floor(i / cols);
          o._frame = "terr";
          o._x = startX + cell * c;
          o._y = y + labelH + pad + cell * (r + 0.5);
          o._dx = 0;
          o._dy = 0;
          o._rx = 0;
          o._ry = 0;
        });
      }

      // Anchor the region name centred above the cluster's real extent (no frame
      // to follow now), so "Puerto Rico" etc. sits right over its bubbles.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      for (const o of list) {
        if (o._x == null || o._y == null) continue;
        if (o._x < minX) minX = o._x;
        if (o._x > maxX) maxX = o._x;
        if (o._y < minY) minY = o._y;
      }
      const hasDots = Number.isFinite(minX);
      const ly = hasDots ? minY - (compact ? 11 : 10) * unitPerPx : y + labelH;
      // Keep the centred region name inside the viewBox at the overview (base
      // scale), in the reserved Atlantic lane east of the mainland footprint.
      const rawLx = hasDots ? (minX + maxX) / 2 : x + boxW / 2;
      const labelHalf = (label.length * (compact ? 11 : 10.5) * unitPerPx * 0.55) / 2;
      const edge = 4 * unitPerPx;
      const lx =
        labelHalf * 2 >= W - edge * 2
          ? W / 2
          : Math.min(W - edge - labelHalf, Math.max(edge + labelHalf, rawLx));
      territoryBoxes.push({ code, label, x, y, w: boxW, h: boxH, lx, ly, landPath });
    }

    type TerrEntry = { code: string; label: string; list: Org[]; w: number; h: number };
    const entries: TerrEntry[] = [];
    for (const code of TERRITORY_LAYOUT_ORDER) {
      const list = present.get(code);
      if (!list?.length) continue;
      const [w, h] = boxSize(code);
      entries.push({ code, label: TERRITORY_LABELS[code] ?? code, list: sortTerritory(list), w, h });
    }
    if (!entries.length) return;

    // Stack in the reserved Atlantic lane (east of CONUS). VI anchors the bottom
    // (farthest from Florida); Puerto Rico sits above it in the same lane.
    const lane = territoryLayoutMetrics(compact, unitPerPx, W, H);
    let yBottom = lane.laneBottom - lane.insetPad;
    for (const e of [...entries].reverse()) {
      yBottom -= e.h;
      const x = lane.laneLeft + Math.max(lane.insetPad, (lane.laneW - lane.insetPad * 2 - e.w) / 2);
      placeInBox(e.code, e.label, x, yBottom, e.w, e.h, e.list, featureFor(e.code));
      yBottom -= lane.stackGap;
    }
  }

  // Territory region names (base coordinates; ride the inset group's zoom
  // transform so each name tracks its offshore cluster). The framed boxes are
  // gone — territories read as labelled clusters of dots now — so this just
  // places the region name above each cluster. Font size is finalised per frame
  // in redraw (kept constant on-screen). Geometry changes only on resize, so
  // this runs from project().
  function drawTerritoryFrames(): void {
    // Real island land first (drawn under the territory dots in gOverlay), then
    // the region name on top.
    gInsets
      .selectAll<SVGPathElement, TerritoryBox>("path.terr-land")
      .data(territoryBoxes.filter((d) => d.landPath != null), (d) => (d as TerritoryBox).code)
      .join("path")
      .attr("class", "terr-land")
      .attr("d", (d) => d.landPath as string);
    gInsets
      .selectAll<SVGTextElement, TerritoryBox>("text.terr-label")
      .data(territoryBoxes, (d) => (d as TerritoryBox).code)
      .join("text")
      .attr("class", "terr-label")
      .attr("x", (d) => d.lx)
      .attr("y", (d) => d.ly)
      .text((d) => d.label);
  }

  function tally(values: Array<string | null | undefined>, fallback: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const v of values) {
      const key = v ?? fallback;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  // A titled list of count rows, sorted by count.
  function statSection(title: string, counts: Map<string, number>, labelFn: (k: string) => string): HTMLElement {
    const sec = createEl("section", "nerc-statsec");
    sec.append(createEl("h3", undefined, title));
    const list = createEl("div", "nerc-statlist");
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [key, n] of entries) {
      const row = createEl("div", "nerc-statrow");
      row.append(createEl("span", "nerc-statname", labelFn(key)), createEl("span", "nerc-statnum", String(n)));
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  function tallyRoles(orgList: Org[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const o of orgList) {
      for (const role of o.roles) {
        counts.set(role, (counts.get(role) ?? 0) + 1);
      }
    }
    return counts;
  }

  function renderStats(): void {
    const onMap = placeableOrgs.length;
    const total = orgs.length;
    const nercRegistered = orgs.filter((o) => o.nerc_registered !== false).length;
    const supplemental = orgs.filter((o) => o.nerc_registered === false).length;
    const notPlotted = total - onMap;

    const top = createEl("div", "nerc-metrics-top");
    const kpiBox = createEl("div", "nerc-kpi");
    kpiBox.append(
      createEl("span", undefined, "Organizations plotted on map"),
      createEl("strong", undefined, String(onMap)),
    );
    top.append(kpiBox);

    const noteParts = [`${total.toLocaleString()} organizations in dataset`];
    if (nercRegistered) noteParts.push(`${nercRegistered.toLocaleString()} NERC registry`);
    if (supplemental) noteParts.push(`${supplemental.toLocaleString()} supplemental (no NERC ID)`);
    if (notPlotted) noteParts.push(`${notPlotted.toLocaleString()} not plotted (missing coordinates)`);
    const note = createEl("p", "nerc-metrics-note", noteParts.join(" · "));

    metricsBody.replaceChildren(
      top,
      note,
      statSection(
        "Regional Entity",
        tally(
          orgs.flatMap((o) => (o.regions?.length ? o.regions : o.region ? [o.region] : [])),
          "No Regional Entity",
        ),
        (k) => k,
      ),
      statSection(
        "Ownership and market type",
        tally(
          orgs.map((o) => o.org_type),
          "other",
        ),
        (k) => typeLabel(k),
      ),
      statSection(
        "Geolocation confidence",
        tally(
          orgs.map((o) => o.geo_confidence),
          "Unknown",
        ),
        (k) => CONFIDENCE_LABELS[k] ?? k,
      ),
      statSection(
        "Reliability functions (organizations per role)",
        tallyRoles(orgs),
        (k) => `${k} — ${roleFullName(k)}`,
      ),
    );
  }

  function renderTooltip(o: Org): void {
    tooltip.replaceChildren();
    tooltip.append(
      createEl("div", "tt-acronym", orgAcronym(o)),
      createEl("div", "tt-name", displayName(o)),
      createEl(
        "div",
        "tt-sub",
        `${regionLabel(o)} | ${typeLabel(o.org_type)} | ${o.role_count} roles | weight ${o.weight}`,
      ),
    );
    if (o.combined_members?.length) {
      tooltip.append(
        createEl(
          "div",
          "tt-combined",
          `${o.combined_members.length + 1} NERC registrations at this location`,
        ),
      );
    }

    const chips = createEl("div", "nerc-tt-pills");
    o.roles.forEach((role) => chips.append(createRolePill(role)));
    tooltip.append(chips);
    tooltip.append(createEl("div", "tt-meta", `${locationLabel(o)} | ${confidenceLabel(o.geo_confidence)}${o.seed ? " | seed" : ""}`));
    tooltip.hidden = false;
  }

  function placeTooltip(anchorX: number, anchorY: number): void {
    const pad = 14;
    let x = anchorX + pad;
    let y = anchorY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = anchorX - rect.width - pad;
    if (y + rect.height > window.innerHeight) y = anchorY - rect.height - pad;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }

  function showTooltip(o: Org, ev: MouseEvent): void {
    const request = ++tooltipRequest;
    const x = ev.clientX;
    const y = ev.clientY;
    renderTooltip(applyOrgDetails(o));
    placeTooltip(x, y);
    if (!hasOrgDetails(o)) {
      void ensureOrgDetails(o)
        .then((fullOrg) => {
          if (request !== tooltipRequest || hoverOrg?.ncr_id !== fullOrg.ncr_id) return;
          renderTooltip(fullOrg);
          placeTooltip(x, y);
        })
        .catch(() => {});
    }
  }

  function showTooltipAt(o: Org, anchorX: number, anchorY: number): void {
    const request = ++tooltipRequest;
    renderTooltip(applyOrgDetails(o));
    placeTooltip(anchorX, anchorY);
    if (!hasOrgDetails(o)) {
      void ensureOrgDetails(o)
        .then((fullOrg) => {
          if (request !== tooltipRequest || hoverOrg?.ncr_id !== fullOrg.ncr_id) return;
          renderTooltip(fullOrg);
          placeTooltip(anchorX, anchorY);
        })
        .catch(() => {});
    }
  }

  function hideTooltip(): void {
    tooltipRequest++;
    tooltip.hidden = true;
  }

  function applyHighlights(): void {
    const hot = hoverOrg;
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .classed("hot", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected", (d) => selectedOrg?.ncr_id === d.ncr_id);

    gHit
      .selectAll<SVGCircleElement, Org>("circle.org-hit")
      .classed("hot", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected", (d) => selectedOrg?.ncr_id === d.ncr_id);

    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .classed("hot-label", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected-label", (d) => selectedOrg?.ncr_id === d.ncr_id)
      // Lift the focused label to the top of the label layer so it's never
      // hidden under a neighbour in a dense cluster. (Labels are few and only
      // the shown subset is visible, so a sticky reorder is harmless.)
      .filter((d) => hot?.ncr_id === d.ncr_id)
      .raise();
  }

  function applyTourClasses(): void {
    const active = tourIds.size > 0;
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .classed("tour-flash", (d) => active && tourIds.has(d.ncr_id))
      .classed("tour-dim", (d) => active && !tourIds.has(d.ncr_id));

    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .classed("tour-flash", (d) => active && tourIds.has(d.ncr_id));
  }

  function addDlRow(dl: HTMLDListElement, term: string, value: string | Node): void {
    const dt = createEl("dt", undefined, term);
    const dd = createEl("dd");
    if (typeof value === "string") dd.textContent = value;
    else dd.append(value);
    dl.append(dt, dd);
  }

  function renderPanel(o: Org): void {
    o = applyOrgDetails(o);
    panelBody.replaceChildren();
    panel.classList.remove("collapsed");
    const close = createEl("button", "nerc-panel-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closePanel();
    });
    // Collapse icon: shrinks the card to its title bar so it stops covering the
    // map, without losing the selection. Click again to expand.
    const collapse = createEl("button", "nerc-panel-collapse", "\u2013");
    collapse.type = "button";
    collapse.setAttribute("aria-label", "Collapse");
    collapse.setAttribute("aria-expanded", "true");
    collapse.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const collapsed = panel.classList.toggle("collapsed");
      collapse.textContent = collapsed ? "+" : "\u2013";
      collapse.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
      collapse.setAttribute("aria-expanded", String(!collapsed));
    });
    panelBody.append(close, collapse);
    const title = createEl("div", "p-title");
    title.style.setProperty("--org-color", safeColor(o.color));
    title.append(createEl("span", "p-acronym", orgAcronym(o)), createEl("h2", undefined, displayName(o)));
    panelBody.append(
      title,
      createEl("p", "p-sub", `${idLabel(o)}${o.seed ? " | seed record" : ""} | ${typeLabel(o.org_type)}`),
    );

    const dl = createEl("dl");
    const roles = createEl("div", "p-roles");
    o.roles.forEach((role) => {
      const row = createEl("div", "p-role");
      row.append(createRolePill(role), createEl("span", undefined, roleFullName(role)));
      roles.append(row);
    });
    addDlRow(dl, `Roles (${o.role_count})`, roles);
    addDlRow(dl, "Role weight", `${o.weight}${o.is_iso_rto ? " | ISO/RTO scale" : ""}`);
    addDlRow(dl, "Regional Entity", regionLabel(o));
    addDlRow(dl, "Location", o.headquarters_address ?? locationLabel(o));
    if (o.map_location_rank && o.map_location_rank > 1) {
      addDlRow(dl, "Map pin", `Alternate location (rank ${o.map_location_rank})`);
    }
    const altLocs = (o.locations ?? []).filter((l) => l.rank > 1 && l.lat != null);
    if (altLocs.length) {
      const altText = altLocs
        .map((l) => `Rank ${l.rank}: ${[l.city, l.state].filter(Boolean).join(", ") || l.headquarters_address || `${l.lat}, ${l.lng}`}`)
        .join("; ");
      addDlRow(dl, "Alternate locations", altText);
    }
    addDlRow(dl, "Location confidence", `${confidenceLabel(o.geo_confidence)}${o.geo_source ? ` | ${o.geo_source}` : ""}`);
    if (o.geo_notes) addDlRow(dl, "Notes", o.geo_notes);

    if (o.combined_members?.length) {
      if (o.map_combine_summary) {
        panelBody.append(createEl("p", "p-combined-note", o.map_combine_summary));
      }
      const list = createEl("div", "p-combined");
      for (const m of o.combined_members) {
        const row = createEl("div", "p-combined-row");
        const meta = createEl("div", "p-combined-meta");
        meta.append(createEl("span", "p-combined-id", m.ncr_id));
        if (m.region) meta.append(createEl("span", "p-combined-region", m.region));
        row.append(meta, createEl("span", "p-combined-name", memberDisplayName(m.entity_name)));
        list.append(row);
      }
      addDlRow(dl, `Also registered here (${o.combined_members.length})`, list);
      if (o.entity_name !== displayName(o)) {
        addDlRow(dl, "Primary registration", o.entity_name);
      }
    }

    const links = createEl("div", "p-links");
    if (o.lat != null && o.lng != null) {
      const map = createEl("a", undefined, "Map");
      map.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.lat},${o.lng}`)}`;
      map.target = "_blank";
      map.rel = "noopener";
      links.append(map);
    }
    const sourceUrl = safeHttpUrl(o.geo_source_url);
    if (sourceUrl) {
      const source = createEl("a", undefined, "Source");
      source.href = sourceUrl;
      source.target = "_blank";
      source.rel = "noopener";
      links.append(source);
    }
    addDlRow(dl, "Links", links);
    panelBody.append(dl);

    if (o.seed) {
      panelBody.append(
        createEl(
          "div",
          "p-seed",
          "Seed record. The NCR ID is a placeholder and role assignments are illustrative, pending ingest of the official NERC Compliance Registry.",
        ),
      );
    } else if (o.nerc_registered === false) {
      panelBody.append(
        createEl(
          "div",
          "p-seed",
          "Not in the NERC registry (no NERC ID). Roles are estimated.",
        ),
      );
    }
    panel.hidden = false;
    requestAnimationFrame(() => nudgeSelectedOrgIntoView(320));
  }

  function closePanel(): void {
    panel.hidden = true;
    selectedOrg = null;
    hoverOrg = null;
    clearOrgPointerFocus();
    invalidateOrgLayout();
    redraw();
    applyHighlights();
  }

  function closeInfo(): void {
    infoPanel.hidden = true;
  }

  function closeMetrics(): void {
    metricsPanel.hidden = true;
  }

  function closePopovers(): void {
    closePanel();
    closeInfo();
    closeMetrics();
    hideTooltip();
  }

  function animateTransform(next: ZoomTransform, duration = ZOOM_TRANSITION_MS): void {
    if (!zoomBehavior) {
      transform = next;
      redraw();
      return;
    }
    // Cancel any in-flight transition so repeated calls (or taps) never stack.
    svg.interrupt();
    if (duration <= 0) {
      svg.call(zoomBehavior.transform as never, next);
      return;
    }
    svg.transition().duration(duration).call(zoomBehavior.transform as never, next);
  }

  function homeView(duration = ZOOM_TRANSITION_MS): void {
    animateTransform(zoomIdentity, duration);
  }

  // Smooth, centred zoom step for the on-screen +/- controls. Goes through the
  // zoom behaviour (like wheel/pinch) so bounds, redraw scheduling and the
  // transition all stay consistent with a real gesture.
  function zoomByFactor(factor: number): void {
    if (!zoomBehavior) return;
    stopTour();
    svg.interrupt();
    svg
      .transition()
      .duration(220)
      .call(zoomBehavior.scaleBy as never, factor, [W / 2, H / 2]);
  }

  // Where the walkthrough opens. On phones it starts a bit further out (a calm
  // overview with margin) so the first reveals read before you zoom in.
  function tourStartView(duration: number): void {
    if (!compact) {
      homeView(duration);
      return;
    }
    const s = 0.8;
    animateTransform(zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-W / 2, -H / 2), duration);
  }

  function centerOnOrg(o: Org, duration = 225): void {
    if (o._x == null || o._y == null) return;
    // Ensure a readable zoom, but never zoom the user back out if they've
    // already zoomed in deeper.
    const scale = Math.min(MAX_ZOOM, Math.max(transform.k, o.is_iso_rto ? 3.2 : 4.2));
    const next = zoomIdentity.translate(W / 2, H / 2).scale(scale).translate(-o._x, -o._y);
    animateTransform(next, duration);
  }

  function selectOrg(o: Org, opts: { center?: boolean } = {}): void {
    stopTour();
    hoverOrg = null;
    selectedOrg = o;
    rememberOrg(o);
    invalidateOrgLayout();
    infoPanel.hidden = true;
    metricsPanel.hidden = true;
    renderPanel(o);
    if (!hasOrgDetails(o)) {
      const selectedId = o.ncr_id;
      void ensureOrgDetails(o)
        .then((fullOrg) => {
          if (selectedOrg?.ncr_id !== selectedId) return;
          selectedOrg = fullOrg;
          renderPanel(fullOrg);
          applyHighlights();
        })
        .catch(() => {});
    }
    hideTooltip();
    clearOrgPointerFocus();
    if (opts.center) centerOnOrg(o);
    else redraw();
    applyHighlights();
  }

  function raiseVisibleOrg(o: Org): void {
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .filter((d) => d.ncr_id === o.ncr_id)
      .raise();
    gHit
      .selectAll<SVGCircleElement, Org>("circle.org-hit")
      .filter((d) => d.ncr_id === o.ncr_id)
      .raise();
  }

  function wireOrgPointer(selection: ReturnType<typeof gOverlay.selectAll<SVGCircleElement, Org>>): void {
    selection
      .on("mouseenter", (ev, o) => {
        hoverOrg = o;
        rememberOrg(o);
        raiseVisibleOrg(o);
        redraw();
        showTooltip(o, ev as MouseEvent);
      })
      .on("mousemove", (ev) => placeTooltip((ev as MouseEvent).clientX, (ev as MouseEvent).clientY))
      .on("mouseleave", () => {
        hoverOrg = null;
        redraw();
        hideTooltip();
        applyHighlights();
      })
      .on("focus", function (_ev, o) {
        if (selectedOrg?.ncr_id === o.ncr_id) return;
        hoverOrg = o;
        rememberOrg(o);
        raiseVisibleOrg(o);
        redraw();
        const rect = (this as SVGCircleElement).getBoundingClientRect();
        showTooltipAt(o, rect.right, rect.top);
      })
      .on("blur", () => {
        hoverOrg = null;
        redraw();
        hideTooltip();
        applyHighlights();
      })
      .on("keydown", (ev, o) => {
        const key = (ev as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          ev.preventDefault();
          selectOrg(o);
        }
      })
      .on("click", (ev, o) => {
        (ev as MouseEvent).stopPropagation();
        const picked = nearestOrgAtPointer(ev as MouseEvent, o);
        rememberOrg(picked);
        raiseVisibleOrg(picked);
        selectOrg(picked);
      });
  }

  function updateView(opts: { stopTourFirst?: boolean } = {}): void {
    if (opts.stopTourFirst) stopTour();
    redraw();
    renderStats();
  }

  function wireControls(): void {
    const toggleTour = (): void => {
      if (tourRunning) stopTour();
      else startTour();
    };
    playBtn.addEventListener("click", toggleTour);
    fabBtn.addEventListener("click", toggleTour);

    // Opening Info/Metrics must not disturb the map view or the current selection
    // (the detail panel lives on the opposite side, so it can stay open). Only the
    // other popover is closed so the two reference popovers never stack.
    infoToggle.addEventListener("click", () => {
      stopTour();
      metricsPanel.hidden = true;
      infoPanel.hidden = !infoPanel.hidden;
    });
    metricsToggle.addEventListener("click", () => {
      stopTour();
      infoPanel.hidden = true;
      metricsPanel.hidden = !metricsPanel.hidden;
      if (!metricsPanel.hidden) renderStats();
    });
    byId<HTMLButtonElement>("nerc-info-close").addEventListener("click", closeInfo);
    byId<HTMLButtonElement>("nerc-metrics-close").addEventListener("click", closeMetrics);

    // On-screen zoom controls. These only change zoom — they never open a panel —
    // so re: changing zoom is clearly separate from the Metrics/Info popovers.
    byId<HTMLButtonElement>("nerc-zoom-in").addEventListener("click", () => zoomByFactor(1.55));
    byId<HTMLButtonElement>("nerc-zoom-out").addEventListener("click", () => zoomByFactor(1 / 1.55));
    byId<HTMLButtonElement>("nerc-zoom-home").addEventListener("click", () => {
      stopTour();
      homeView(260);
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        stopTour();
        closePopovers();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
        const step = ev.shiftKey ? 115 : 52;
        const dx = ev.key === "ArrowLeft" ? step : ev.key === "ArrowRight" ? -step : 0;
        const dy = ev.key === "ArrowUp" ? step : ev.key === "ArrowDown" ? -step : 0;
        ev.preventDefault();
        stopTour();
        animateTransform(zoomIdentity.translate(transform.x + dx, transform.y + dy).scale(transform.k), 160);
      }
    });
  }

  function revealActionButtons(): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      infoToggle.textContent = "i";
      metricsToggle.textContent = "M";
      return;
    }

    const reveal = (btn: HTMLButtonElement, frames: string[], reset: string, delay: number) => {
      btn.classList.add("nerc-letter-typing");
      let i = 0;
      const tick = (): void => {
        if (i < frames.length) {
          btn.textContent = frames[i++];
          window.setTimeout(tick, 120);
          return;
        }
        window.setTimeout(() => {
          btn.textContent = reset;
          btn.classList.remove("nerc-letter-typing");
        }, 2800);
      };
      window.setTimeout(tick, delay);
    };

    const run = () => {
      if (!document.contains(infoToggle) || !document.contains(metricsToggle)) return;
      if (infoToggle.classList.contains("nerc-letter-typing") || metricsToggle.classList.contains("nerc-letter-typing")) {
        return;
      }
      reveal(metricsToggle, ["M", "Me", "Met", "Metrics"], "M", 0);
      reveal(infoToggle, ["I", "In", "Inf", "Info"], "i", 0);
    };

    window.setTimeout(run, 480);
    window.setInterval(run, 8000);
  }

  function setupZoom(): void {
    zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.72, MAX_ZOOM])
      .clickDistance(compact ? 6 : 4)
      .tapDistance(compact ? 12 : 8)
      .wheelDelta(wheelDelta)
      // The walkthrough keeps playing while the user pans/zooms (programmatic
      // transitions have no sourceEvent). A real gesture just nudges the Stop
      // control so they know they can take over.
      .on("start", (ev) => {
        if (isPanSourceEvent(ev.sourceEvent)) userPanning = true;
        if (isWheelEvent(ev.sourceEvent)) wheelZooming = true;
        if (ev.sourceEvent && tourRunning) nudgeStopAttention();
      })
      .on("end", (ev) => {
        if (isPanSourceEvent(ev.sourceEvent)) {
          userPanning = false;
          lastPanEndAt = performance.now();
          // Pan is over: do one full redraw so labels/place/land resettle for the
          // new viewport (during the drag they were frozen and only translated).
          scheduleRedraw();
        }
        if (isWheelEvent(ev.sourceEvent)) finishWheelZoom();
      })
      .on("zoom", (ev) => {
        if (ev.sourceEvent) lastUserZoomAt = performance.now();
        const prevK = transform.k;
        transform = ev.transform;
        const kChanged = Math.abs(transform.k - prevK) > 0.001;
        if (kChanged) {
          if (wheelZooming || isWheelEvent(ev.sourceEvent)) zoomBoundsDirty = true;
          else updateZoomBounds();
        }
        if (wheelZooming || isWheelEvent(ev.sourceEvent)) {
          if (!wheelZooming) wheelZooming = true;
          scheduleWheelRedraw();
        } else {
          scheduleRedraw();
        }
      });
    updateZoomBounds();
    svg.call(zoomBehavior);
    svg.on("dblclick.zoom", null);
    svg.on("click", () => {
      closePopovers();
    });
  }

  function setPlayState(running: boolean): void {
    const label = running ? "■ Stop" : "▶ Tour";
    const aria = running ? "Stop walkthrough" : "Play walkthrough";
    for (const b of [playBtn, fabBtn]) {
      b.textContent = label;
      b.setAttribute("aria-label", aria);
      b.classList.toggle("is-running", running);
      if (!running) b.classList.remove("attention");
    }
    if (!running && attentionTimer) {
      window.clearTimeout(attentionTimer);
      attentionTimer = undefined;
    }
  }

  // The tour keeps playing while the user pans/zooms; this makes the Stop
  // control pulse for a few seconds so they know they can take over fully.
  function nudgeStopAttention(): void {
    if (!tourRunning) return;
    for (const b of [playBtn, fabBtn]) b.classList.add("attention");
    if (attentionTimer) window.clearTimeout(attentionTimer);
    attentionTimer = window.setTimeout(() => {
      for (const b of [playBtn, fabBtn]) b.classList.remove("attention");
      attentionTimer = undefined;
    }, 3200);
  }

  function stopTour(): void {
    tourTimers.forEach((timer) => window.clearTimeout(timer));
    tourTimers = [];
    svg.interrupt(); // cancel any in-flight reset transition so nothing stacks
    tourIds = new Set();
    tourRunning = false;
    invalidateOrgLayout();
    tourStatus.hidden = true;
    setPlayState(false);
    if (placeableOrgs.length) redraw();
    else applyTourClasses();
  }

  function showTourStep(label: string, match: (o: Org) => boolean, index: number, total: number): void {
    const matches = placeableOrgs.filter(match);
    tourIds = new Set(matches.map((o) => o.ncr_id));
    invalidateOrgLayout();
    tourStatus.replaceChildren(
      createEl("strong", "tour-title", label),
      createEl("span", "tour-progress", `${index} of ${total}`),
    );
    tourStatus.hidden = matches.length === 0;
    redraw();
  }

  function startTour(): void {
    stopTour();
    selectedOrg = null;
    panel.hidden = true;
    infoPanel.hidden = true;
    metricsPanel.hidden = true;
    tourRunning = true;
    setPlayState(true);

    const reduced = prefersReducedMotion();
    // Open on the overview (further out on phones) before the walkthrough runs.
    tourStartView(reduced ? 0 : compact ? 260 : 380);

    const steps = [
      { label: "ISOs and RTOs", match: (o: Org) => o.is_iso_rto },
      ...TOUR_ROLE_ORDER.map((role) => ({
        label: ROLE_TOUR_LABELS[role] ?? `${roleFullName(role)} (${role})`,
        match: (o: Org) => o.roles.includes(role),
      })),
    ].filter((step) => placeableOrgs.some(step.match));
    if (!steps.length) {
      stopTour();
      return;
    }

    // Each cycle is a short blank beat (everything dims, nothing selected) then
    // the next role reveals and dwells. Loops until the user stops it.
    const leadMs = reduced ? 250 : compact ? 650 : 850;
    const gapMs = reduced ? 200 : compact ? 460 : 560;
    const dwellMs = reduced ? 1400 : compact ? 1950 : 2500;
    let idx = 0;
    const showStep = (): void => {
      const total = steps.length;
      const step = steps[idx % total];
      showTourStep(step.label, step.match, (idx % total) + 1, total);
      idx += 1;
    };
    const cycle = (): void => {
      // Blank beat.
      tourIds = new Set();
      invalidateOrgLayout();
      tourStatus.hidden = true;
      redraw();
      tourTimers.push(window.setTimeout(showStep, gapMs));
      tourTimers.push(window.setTimeout(cycle, gapMs + dwellMs));
    };
    tourTimers.push(window.setTimeout(cycle, leadMs));
  }

  async function init(): Promise<void> {
    const [orgsPayload, topo] = await Promise.all([
      loadJson<OrgsPayload>(`${dataBase}nerc/orgs-render.json`),
      loadJson<unknown>(`${dataBase}nerc/states-10m.json`),
    ]);

    if (!Array.isArray(orgsPayload.orgs)) throw new Error("No orgs array found in NERC payload");
    orgs = orgsPayload.orgs;

    // Canada landmass (context). Non-fatal if the file is missing.
    canadaFeature = await loadJson<unknown>(`${dataBase}nerc/canada-land.json`).catch(() => null);

    const topoAny = topo as { objects: Record<string, unknown> };
    const states = feature(topo as never, topoAny.objects.states as never) as never as { features: unknown[] };
    stateFeatures = states.features.filter(
      (f) => !isExcludedTerritoryFips(String((f as { id?: string | number }).id ?? "")),
    );
    nationFeature = { type: "FeatureCollection", features: stateFeatures };
    nationOutline = mesh(topo as never, topoAny.objects.states as never, (a, b) => a === b);

    // Draw order inside the basemap group: Canada (context) → states → nation.
    if (canadaFeature) gMap.append("path").attr("class", "canada");
    gMap.selectAll("path.state").data(stateFeatures).join("path").attr("class", "state");
    gMap.append("path").attr("class", "nation");

    measure();
    project();
    placeableOrgs = orgs.filter((o) => o._x != null && o._y != null);

    gLand
      .selectAll("text.land-label")
      .data(landLabels, (d: unknown) => (d as LandLabel).name)
      .join("text")
      .attr("class", "land-label")
      .text((d) => d.name);
    // Paint weak/low-priority dots first so regulated and high-authority orgs
    // stay on top visually and for hit-testing.
    const visibleOrder = [...placeableOrgs].sort(
      (a, b) =>
        drawPriority(a, transform.k) - drawPriority(b, transform.k) ||
        visualPrioritySortAsc(a, b) ||
        a.entity_name.localeCompare(b.entity_name),
    );
    const hitOrder = visibleOrder;

    const visibleCircles = gOverlay
      .selectAll("circle.org")
      .data(visibleOrder, (o: unknown) => (o as Org).ncr_id)
      .join("circle")
      .attr(
        "class",
        (o) =>
          "org" +
          (o.geo_confidence === "ESTIMATED" || o.geo_confidence === "LOW" ? " estimated" : "") +
          (o.nerc_registered === false ? " unregistered" : ""),
      )
      .attr("fill", (o) => safeColor(o.color))
      .attr("cx", (o) => orgRenderX(o))
      .attr("cy", (o) => orgRenderY(o))
      .attr("r", (o) => renderedRadius(o, transform.k) / Math.max(transform.k, 0.001))
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (o) => `${orgAcronym(o)} ${displayName(o)}`);

    wireOrgPointer(visibleCircles as never);

    const hitCircles = gHit
      .selectAll("circle.org-hit")
      .data(hitOrder, (o: unknown) => (o as Org).ncr_id)
      .join("circle")
      .attr("class", "org-hit")
      .attr("cx", (o) => orgRenderX(o))
      .attr("cy", (o) => orgRenderY(o))
      .attr("r", (o) => hitTargetRadius(o, transform.k) / Math.max(transform.k, 0.001))
      .attr("aria-hidden", "true");

    wireOrgPointer(hitCircles as never);

    gPlaces
      .selectAll("circle.place-dot")
      .data(places, (p: unknown) => (p as Place).name)
      .join("circle")
      .attr("class", "place-dot");

    gLabels
      .selectAll("text.olabel")
      .data(visibleOrder, (o: unknown) => (o as Org).ncr_id)
      .join("text")
      .attr("class", "olabel")
      .text((o) => orgAcronym(o));

    gPlaces
      .selectAll("text.place")
      .data(places, (p: unknown) => (p as Place).name)
      .join("text")
      .attr("class", "place")
      .text((p) => p.name);

    setupZoom();
    wireControls();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    loadingEl.style.display = "none";
    updateView();
    scheduleOrgDetailsLoad();
    revealActionButtons();
    if (new URLSearchParams(location.search).has("audit")) setupAudit();
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("devView")) setupDevView();
  }

  // TEMPORARY dev-only helper (dev build or ?devView=1). Adds a small floating
  // button that copies a plain-text description of the current map view — zoom,
  // pan transform, viewport size, selected org, and the approximate geographic
  // centre — so it can be pasted straight into an AI prompt. Reads live D3 zoom
  // state on each click, so the text always reflects the latest zoom/pan/
  // selection. No effect on map behaviour; ships inert unless the flag is set.
  function setupDevView(): void {
    const btn = createEl("button", undefined, "Copy view prompt");
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy current map view as a prompt");
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "10px",
      left: "10px",
      zIndex: "9999",
      padding: "6px 10px",
      font: "12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#0b1a16",
      background: "rgba(255,255,255,0.92)",
      border: "1px solid rgba(13,23,20,0.35)",
      borderRadius: "6px",
      boxShadow: "0 4px 14px rgba(20,31,28,0.22)",
      cursor: "pointer",
    } as Partial<CSSStyleDeclaration>);

    const buildPrompt = (): string => {
      const k = transform.k;
      const rect = svgNode.getBoundingClientRect();
      const vw = Math.round(rect.width);
      const vh = Math.round(rect.height);
      // Approximate geographic centre: invert the zoom transform at the viewBox
      // centre, then invert the (mainland Albers) projection. May be null off the
      // composite — fall back to a generic phrase.
      let area = "the current map view";
      const center = transform.invert([W / 2, H / 2]);
      const lnglat = projection.invert?.(center as [number, number]);
      if (lnglat && Number.isFinite(lnglat[0]) && Number.isFinite(lnglat[1])) {
        area = `the area near ${lnglat[1].toFixed(3)}, ${lnglat[0].toFixed(3)} (lat, lng)`;
      }
      const sel = selectedOrg ? displayName(selectedOrg) : "none";
      return (
        `I am currently looking at ${area}. ` +
        `Zoom: ${k.toFixed(3)}. ` +
        `Pan/transform: x=${transform.x.toFixed(1)}, y=${transform.y.toFixed(1)}. ` +
        `Viewport: ${vw}x${vh}. ` +
        `Selected org: ${sel}. ` +
        `Please inspect this exact area.`
      );
    };

    const flash = (msg: string): void => {
      const prev = btn.textContent;
      btn.textContent = msg;
      window.setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    };

    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const text = buildPrompt();
      try {
        await navigator.clipboard.writeText(text);
        flash("Copied ✓");
      } catch {
        // Clipboard API unavailable (e.g. non-secure context): fall back to a
        // hidden textarea + execCommand so the dev helper still works.
        const ta = createEl("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.append(ta);
        ta.select();
        try {
          document.execCommand("copy");
          flash("Copied ✓");
        } catch {
          flash("Copy failed");
        }
        ta.remove();
      }
    });

    document.body.append(btn);
  }

  // Optional UX-audit harness (only when the page is loaded with ?audit=1). It
  // drives the *real* renderer and reads out per-bubble stats using the same
  // land mask / sizing / label functions the map uses, so the audit reflects
  // exactly what ships. No effect on the normal map. Removable; ships inert.
  function setupAudit(): void {
    const sampleWater = (bx: number, by: number, rBase: number): number => {
      if (rBase <= 0) return onLand(bx, by) ? 0 : 1;
      const step = Math.max(0.6, rBase / 4);
      let inDisc = 0;
      let water = 0;
      for (let yy = -rBase; yy <= rBase; yy += step) {
        for (let xx = -rBase; xx <= rBase; xx += step) {
          if (xx * xx + yy * yy > rBase * rBase) continue;
          inDisc++;
          if (!onLand(bx + xx, by + yy)) water++;
        }
      }
      return inDisc ? water / inDisc : 0;
    };
    const setZoom = (k: number, cx = W / 2, cy = H / 2): void => {
      animateTransform(zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy), 0);
    };
    (window as unknown as { __nercAudit: unknown }).__nercAudit = {
      info: () => ({ W, H, compact, unitPerPx, count: placeableOrgs.length }),
      getTransform: () => ({ x: transform.x, y: transform.y, k: transform.k }),
      project: (lng: number, lat: number) => projection([lng, lat]),
      setZoom,
      setZoomAt: (k: number, lng: number, lat: number) => {
        const p = projection([lng, lat]);
        setZoom(k, p ? p[0] : W / 2, p ? p[1] : H / 2);
      },
      audit: () => {
        const k = transform.k;
        const fanScale = spiderFanScale(k);
        const declScale = declutterScale(k);
        const vis: Array<Record<string, number | string | boolean>> = [];
        for (const o of placeableOrgs) {
          if (!o._vis || o._sx == null || o._sy == null) continue;
          const bx = orgRenderX(o, fanScale, declScale);
          const by = orgRenderY(o, fanScale, declScale);
          const rScreen = renderedRadius(o, k); // screen viewBox units
          const rBase = rScreen / k; // base-space radius (mask is base space)
          const waterFrac = o._frame === "terr" ? 0 : sampleWater(bx, by, rBase);
          const baseOffset = Math.hypot(bx - (o._x as number), by - (o._y as number));
          const st = lastLabelState?.get(o.ncr_id);
          vis.push({
            id: o.ncr_id,
            name: tinyName(o),
            frame: o._frame ?? "",
            pr: Math.round(visualPriority(o)),
            w: o.weight,
            rcss: +(rScreen / unitPerPx).toFixed(1),
            sx: +o._sx.toFixed(1),
            sy: +o._sy.toFixed(1),
            waterFrac: +waterFrac.toFixed(2),
            centerWater: !onLand(bx, by),
            baseOff: +baseOffset.toFixed(1),
            labeled: !!st,
            inside: !!st?.inside,
          });
        }
        // Severe-overlap pairs among visible dots (screen space).
        let severe = 0;
        for (let i = 0; i < vis.length; i++) {
          for (let j = i + 1; j < vis.length; j++) {
            const a = vis[i];
            const b = vis[j];
            const dx = (a.sx as number) - (b.sx as number);
            const dy = (a.sy as number) - (b.sy as number);
            const d = Math.hypot(dx, dy);
            const ra = (a.rcss as number) * unitPerPx;
            const rb = (b.rcss as number) * unitPerPx;
            if (d < (ra + rb) * 0.62) severe++;
          }
        }
        const labeled = vis.filter((v) => v.labeled);
        // Highest-priority visible dots and whether each earned a label — used to
        // confirm high-priority entities are disclosed/labeled before low ones.
        const topByPriority = [...vis]
          .sort((a, b) => (b.pr as number) - (a.pr as number))
          .slice(0, 22)
          .map((v) => `${v.name}${v.labeled ? (v.inside ? "·in" : "·fl") : "·NO"}`);
        return {
          k: +k.toFixed(2),
          W,
          H,
          compact,
          unitPerPx: +unitPerPx.toFixed(3),
          onScreenCount: placeableOrgs.filter((o) => o._sx != null && o._sx >= -90 && o._sx <= W + 90 && (o._sy as number) >= -90 && (o._sy as number) <= H + 90).length,
          visible: vis.length,
          labels: labeled.length,
          inside: labeled.filter((v) => v.inside).length,
          float: labeled.filter((v) => !v.inside).length,
          severeOverlaps: severe,
          stranded: vis.filter((v) => v.frame !== "terr" && (v.waterFrac as number) >= 0.85).length,
          centerInWater: vis.filter((v) => v.frame !== "terr" && v.centerWater).length,
          minRcss: vis.length ? Math.min(...vis.map((v) => v.rcss as number)) : 0,
          medRcss: vis.length
            ? vis.map((v) => v.rcss as number).sort((a, b) => a - b)[Math.floor(vis.length / 2)]
            : 0,
          maxBaseOff: vis.length ? Math.max(...vis.map((v) => v.baseOff as number)) : 0,
          topByPriority,
          dots: vis,
        };
      },
    };
    (window as unknown as { __nercAuditReady: boolean }).__nercAuditReady = true;
  }

  init().catch((err) => {
    console.error(err);
    loadingEl.textContent = "Could not load map data.";
  });
}
