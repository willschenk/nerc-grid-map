import { geoAlbersUsa, geoConicEqualArea, geoMercator, geoPath } from "d3-geo";
import { scaleSqrt } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import { feature } from "topojson-client";
import { ROLE_FULL_NAMES } from "../roles.mjs";
import { PLACES } from "../places.mjs";

type Place = { name: string; lat: number; lng: number; tier: number; _x?: number; _y?: number };

type Org = {
  ncr_id: string;
  entity_name: string;
  acronym: string;
  acronym_source: string | null;
  // Researched three-tier display names; null until Cursor fills org-names.json.
  // name_major entities are pinned to name_shortest at every zoom.
  name_shortest?: string | null;
  name_short?: string | null;
  name_normal?: string | null;
  name_major?: boolean;
  region: string | null;
  roles: string[];
  role_count: number;
  is_private: boolean;
  lat: number | null;
  lng: number | null;
  headquarters_address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  geo_confidence: string;
  geo_source: string | null;
  geo_source_url?: string | null;
  geo_notes: string;
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
  _rk?: number;
  // Isolation factor 0..1 (1 = no neighbours nearby), recomputed each redraw
  // from screen positions. Drives a size boost so lonely dots in sparse regions
  // read better and earn a label.
  _iso?: number;
  // Last viewBox radius actually written to the circle, so the isolation boost
  // (which changes on pan at constant zoom) can update without a per-frame storm.
  _rr?: number;
  // Last viewBox hit radius written to the invisible target. It follows the
  // resolved visual radius, not just zoom, so panning at deep zoom stays aligned.
  _hr?: number;
  // Which projection placed this org: mainland Albers ("us"), the Canada conic
  // ("ca"), or a territory inset ("terr").
  _frame?: "us" | "ca" | "terr";
};

type LandLabel = { name: string; x: number; y: number; small: boolean; _node?: SVGTextElement };
// An offshore territory's layout region. x/y/w/h bound where its cluster of dots
// is laid out; lx/ly is the anchor for the region name, centred above the dots.
type TerritoryBox = { code: string; label: string; x: number; y: number; w: number; h: number; lx: number; ly: number };

type OrgsPayload = {
  generated_at?: string;
  source_file?: string;
  count?: number;
  orgs: Org[];
};

// Viewbox dimensions. These are recomputed from the live element size so the
// viewBox aspect ratio matches the screen (no letterbox bands on tall phones).
let W = 960;
let H = 600;
const RADIUS_SCALE = scaleSqrt().domain([1, 45]).range([4, 48]);
const SPIDER_CLUSTER_EPSILON = 0.35;
const SPIDER_START_K = 4;
const SPIDER_FULL_K = 10;
const SPIDER_RING_STEP_PX = 28;
// Declutter: visible bubbles move in render space only. Lat/lng and projected
// _x/_y stay true; _dx/_dy are screen-space nudges divided by zoom at render.
const MAX_RADIUS = 48;
const MAX_ZOOM = 1200;
const AUTHORITY_ROLES = new Set(["RC", "BA", "PC", "TOP", "TO", "TSP", "TP", "RSG", "FRSG", "RRSG", "RP"]);
const PUBLIC_ROLES = new Set(["DP", "LSE", "PSE"]);
const GENERATION_ROLES = new Set(["GO", "GOP"]);

// Out-of-footprint U.S. territories: only Puerto Rico is drawn as a labelled
// inset. Other territory rows stay in the data but are intentionally hidden.
const PUERTO_RICO_STATE = "PR";

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

function typeLabel(value: string | null): string {
  return TYPE_LABELS[value ?? "other"] ?? value ?? "Other";
}

function confidenceLabel(value: string | null): string {
  const label = CONFIDENCE_LABELS[value ?? ""] ?? value ?? "Unknown";
  return `Confidence: ${label}`;
}

function locationLabel(o: Org): string {
  const place = [o.city, o.state].filter(Boolean).join(", ");
  return place || o.headquarters_address || o.country || "Location unknown";
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

  const svgNode = byId<SVGSVGElement>("nerc-svg");
  const svg = select(svgNode);
  const gMap = svg.append("g").attr("class", "map");
  // Territory inset frames ride the zoom transform (like the Alaska/Hawaii
  // insets) so their dots stay inside as you zoom.
  const gInsets = svg.append("g").attr("class", "insets");
  // City context stays below every NERC mark and label.
  const gPlaces = svg.append("g").attr("class", "places");
  const gOverlay = svg.append("g").attr("class", "overlay");
  const gHit = svg.append("g").attr("class", "hit");
  // State / province names float faintly over the dot field but below NERC org
  // labels, so geography reads without ever hiding NERC information.
  const gLand = svg.append("g").attr("class", "land");
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
  const places = PLACES as Place[];
  let selectedOrg: Org | null = null;
  let hoverOrg: Org | null = null;
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
  // Phone-sized screens get fewer labels when zoomed in (less screen real
  // estate for the same physical-size labels).
  let compact = false;
  let orgMarkK = NaN;
  let orgLayoutBucket = NaN;

  function invalidateOrgLayout(): void {
    orgMarkK = NaN;
    orgLayoutBucket = NaN;
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

  function labelText(o: Org, k: number): string {
    // Super-short token when zoomed out / tight, the shortened brand once zoomed
    // in. The full legal name only ever appears in the detail panel.
    // The biggest entities are pinned to their shortest acronym at every zoom —
    // "PJM" never grows into "PJM Interconnection" on the map.
    if (o.name_major) return tinyName(o);
    const priority = orgPriority(o);
    const midAt = priority >= 54 ? 5.8 : priority >= 32 ? 8.2 : 11.5;
    if (k < midAt) return tinyName(o);
    const mid = midName(o);
    return mid.length > (compact ? 20 : 28) ? tinyName(o) : mid;
  }

  function nonGenerationRoleCount(o: Org): number {
    return o.roles.filter((r) => !GENERATION_ROLES.has(r)).length;
  }

  function isGenerationOnly(o: Org): boolean {
    return o.roles.length > 0 && o.roles.every((r) => GENERATION_ROLES.has(r));
  }

  function orgPriority(o: Org): number {
    const nonGen = nonGenerationRoleCount(o);
    let score = o.weight * 0.9 + Math.min(o.role_count, 8) * 1.4;
    if (o.is_iso_rto) score += 34;
    if (nonGen > 0) score += 10 + nonGen * 4;
    if (o.roles.some((r) => AUTHORITY_ROLES.has(r))) score += 12;
    if (o.roles.some((r) => PUBLIC_ROLES.has(r))) score += 5;
    if (o.roles.includes("DP")) score += 18;
    if (o.roles.includes("LSE")) score += 8;
    if (o.roles.includes("PSE")) score += 4;
    if (o.roles.includes("TO") && o.roles.includes("DP")) score += 8;
    if (o.roles.includes("TOP")) score += 7;
    if (o.roles.includes("TP")) score += 5;
    if (o.org_type === "federal") score += 20;
    if (o.org_type === "municipal") score += 13;
    if (o.org_type === "cooperative") score += 7;
    if (o.org_type === "cca") score += 3;
    if (o.nerc_registered === false) score -= 6;
    if (isGenerationOnly(o)) score -= 18;
    if (o.roles.length === 0) score -= 8;
    if (/department of energy/i.test(o.entity_name)) score += 56;
    else if (/cleveland public power/i.test(o.entity_name)) score += 46;
    else if (/firstenergy/i.test(o.entity_name)) score += 38;
    if (/new york power authority/i.test(o.entity_name)) score += 70;
    else if (/pjm interconnection|long island power authority|consolidated edison|con edison/i.test(o.entity_name)) {
      score += 36;
    }
    return score;
  }

  function orgMinZoom(o: Org): number {
    if (o._frame === "terr") return 0.72;
    const priority = orgPriority(o);
    const nonGen = nonGenerationRoleCount(o);
    if (priority >= 54 || o.weight >= 30 || o.is_iso_rto) return 0.72;
    if (priority >= 42 || o.weight >= 18 || nonGen >= 4) return 1.05;
    if (priority >= 32 || nonGen >= 2) return 1.55;
    if (priority >= 24 || nonGen >= 1) return 2.3;
    if (priority >= 16) return 3.8;
    if (!isGenerationOnly(o)) return 4.8;
    return 6.8;
  }

  function dotStrength(o: Org, k: number): number {
    if (o._frame === "terr") return 1;
    const fullAt = orgMinZoom(o);
    if (fullAt <= 0.72) return 1;
    const lead = compact ? 1.25 : 1.55;
    return Math.max(0.14, smoothStep((k - (fullAt - lead)) / lead));
  }

  function orgOpacity(o: Org, k: number, labeled: boolean): number {
    if (o._frame === "terr") return 1;
    const strength = dotStrength(o, k);
    return Math.min(1, (labeled ? 0.82 : 0.26) + strength * (labeled ? 0.18 : 0.54));
  }

  function drawPriority(o: Org, k: number): number {
    return dotStrength(o, k) * 90 + orgPriority(o) + o.weight * 0.9 + o.role_count;
  }

  // Which orgs are eligible to *try* for a label at this zoom. Kept sparse at
  // low zoom (only the heaviest entities) and opened up fully once zoomed in,
  // where viewport culling keeps the on-screen candidate count small.
  function shouldTryLabel(o: Org, k: number): boolean {
    const priority = orgPriority(o);
    const nonGen = nonGenerationRoleCount(o);
    // A dot alone in empty space costs nothing to label and looks better with
    // one, so once zoomed in past the overview let isolated dots always try —
    // this is what fills the sparse Mountain-West / Plains with names.
    if (k >= 1.8 && (o._iso ?? 0) >= 0.7) return true;
    if (k < 1.25) return priority >= 54 || o.weight >= 30 || o.is_iso_rto;
    if (k < 1.8) return priority >= 42 || o.weight >= 18 || nonGen >= 4;
    if (k < 2.6) return priority >= 32 || o.weight >= 12 || nonGen >= 2;
    if (k < 3.4) return priority >= 24 || o.weight >= 8 || nonGen >= 1;
    if (k < 4.8) return priority >= 18 || o.weight >= 8 || nonGen >= 1;
    if (k < 6.8) return priority >= 16 || o.weight >= 6 || nonGen >= 1;
    if (k < 9.5) return priority >= 18 || o.weight >= 5 || nonGen >= 1;
    if (k < 12.5) return priority >= 10 || o.weight >= 3 || !isGenerationOnly(o);
    return o.weight >= 1;
  }

  // Target on-screen label size in CSS pixels (multiplied by unitPerPx before
  // it hits the SVG). Grows a little as you zoom in instead of staying flat.
  function labelFontPx(o: Org, k: number): number {
    const base = compact
      ? o.weight >= 30 ? 12 : o.weight >= 12 ? 10.75 : 9.25
      : o.weight >= 30 ? 14.5 : o.weight >= 12 ? 13 : 11.5;
    const growth = compact
      ? Math.min(1.28, 1 + Math.max(0, k - 1) * 0.055)
      : Math.min(1.55, 1 + Math.max(0, k - 1) * 0.11);
    return base * growth;
  }

  function labelLimit(k: number): number {
    const cap =
      k < 1.25 ? 160 :
      k < 1.8 ? 195 :
      k < 2.6 ? 235 :
      k < 3.4 ? 280 :
      k < 4.8 ? 330 :
      k < 6.8 ? 385 :
      440;
    // On phones, keep the overview sparse (small screen) but open up a lot as you
    // zoom in — there's screen space to fill, and the user wants iOS to feel as
    // dynamic as desktop. Multiplier ramps 0.48 -> 0.92 across the zoom range.
    if (!compact) return cap;
    const mult = 0.48 + 0.44 * smoothStep((k - 1.6) / 4.5);
    return Math.round(cap * mult);
  }

  function placeLabelLimit(k: number): number {
    if (compact) return 16;
    if (k < 1.8) return 14;
    if (k < 4.8) return 34;
    return 58;
  }

  function placeDotMinK(tier: number): number {
    return tier === 1 ? 0.72 : tier === 2 ? 1.8 : 3.6;
  }

  function placeLabelMinK(tier: number): number {
    return tier === 1 ? 0.72 : tier === 2 ? 2.4 : 4.8;
  }

  function placeDotRadius(p: Place): number {
    return (p.tier === 1 ? 2.4 : p.tier === 2 ? 2 : 1.7) * unitPerPx;
  }

  function visualRadius(o: Org, k: number): number {
    // Size principle: keep the whole field compact at the overview (so big orgs
    // are prominent but don't swamp neighbours or collide), then let dots grow
    // toward their full weight-based size as you zoom in and there's room. A
    // single zoom term scales everything; weight sets the relative size.
    const base = Math.max(2, RADIUS_SCALE(o.weight));
    const zoomT = smoothStep((k - 0.72) / 5);
    const scale = compact ? 0.32 + 0.42 * zoomT : 0.33 + 0.34 * zoomT;
    // Quieter dots (low strength = not yet "due" at this zoom) shrink a bit so
    // the important orgs read first; they fill back in as you zoom toward them.
    const strengthScale = 0.46 + dotStrength(o, k) * 0.54;
    const grown = base * scale * strengthScale;
    // Some high-priority regulated entities have few roles and therefore low
    // weight (for example PSE&G: DP + TO). Once zoomed in, lift those above the
    // small-dot floor so they are easier to see and tap without changing the
    // national overview sizing.
    const closeT = smoothStep((k - (compact ? 2.25 : 2.8)) / (compact ? 7.2 : 8.2));
    const priorityT = smoothStep((orgPriority(o) - 32) / 42);
    const lowWeightT = smoothStep((14 - Math.min(o.weight, 14)) / 14);
    const liftPx = (compact ? 15.5 : 10.5) * priorityT * (0.4 + lowWeightT * 0.6) * closeT;
    const lifted = grown + liftPx * unitPerPx;
    return Math.max((compact ? 1.8 : 1.5) * unitPerPx, lifted);
  }

  // Distance (in viewBox units) at which a dot counts as fully "isolated" — its
  // own little island of empty map. Scales with the on-screen dot size so the
  // notion of "alone" tracks how big things currently look.
  function isolationRange(): number {
    return (compact ? 34 : 46) * unitPerPx;
  }

  // Fill each visible org's _iso (0 = crowded, 1 = no neighbour within range)
  // from nearest-neighbour distance, computed once per redraw over a coarse grid.
  function computeIsolation(visible: Org[]): void {
    const range = isolationRange();
    const cell = range;
    const grid = new Map<string, Org[]>();
    for (const o of visible) {
      if (o._frame === "terr") { o._iso = 0; continue; }
      const key = Math.floor((o._sx as number) / cell) + ":" + Math.floor((o._sy as number) / cell);
      const arr = grid.get(key);
      if (arr) arr.push(o);
      else grid.set(key, [o]);
    }
    const range2 = range * range;
    for (const o of visible) {
      if (o._frame === "terr") continue;
      const sx = o._sx as number;
      const sy = o._sy as number;
      const gx = Math.floor(sx / cell);
      const gy = Math.floor(sy / cell);
      let nearest2 = range2;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get(gx + ox + ":" + (gy + oy));
          if (!arr) continue;
          for (const b of arr) {
            if (b === o) continue;
            const d2 = (b._sx! - sx) ** 2 + (b._sy! - sy) ** 2;
            if (d2 < nearest2) nearest2 = d2;
          }
        }
      }
      // 0 when a neighbour sits right on top, ramping to 1 at the isolation range.
      o._iso = smoothStep(Math.sqrt(nearest2) / range);
    }
  }

  // Extra radius multiplier for a lonely dot. Strongest when zoomed in on an
  // empty region (room to grow, nothing to collide with); gentle at overview so
  // the national picture stays calm. Generation-only dots get a smaller bump so
  // the sea of small plants doesn't balloon, but they still become clickable.
  function isolationBoost(o: Org, k: number): number {
    const iso = o._iso ?? 0;
    if (iso <= 0) return 1;
    const zoomGain = smoothStep((k - 1.4) / 3.2); // ramps in as you zoom past ~1.4
    const ceiling = (isGenerationOnly(o) ? 0.18 : 0.9) * (0.35 + zoomGain * 0.65);
    return 1 + iso * ceiling;
  }

  function generationOnlyRadiusCap(k: number): number {
    const closeT = smoothStep((k - 1.8) / 6.2);
    return (compact ? 4.6 + 1.2 * closeT : 4.8 + 1.6 * closeT) * unitPerPx;
  }

  function nonGenerationRadiusFloor(o: Org, k: number): number {
    if (nonGenerationRoleCount(o) <= 0) return 0;
    const closeT = smoothStep((k - 1.8) / 6.2);
    const marginPx = compact ? 1.05 + 1.65 * closeT : 0.9 + 1.45 * closeT;
    return generationOnlyRadiusCap(k) + marginPx * unitPerPx;
  }

  // Puerto Rico inset dots are schematic (small, uniform) rather than
  // weight-sized so they fit the cluster; everything else uses normal sizing.
  function renderedRadius(o: Org, k: number): number {
    if (o._frame === "terr") return (compact ? 5 : 4) * unitPerPx;
    const radius = visualRadius(o, k) * isolationBoost(o, k);
    if (isGenerationOnly(o)) return Math.min(radius, generationOnlyRadiusCap(k));
    return Math.max(radius, nonGenerationRadiusFloor(o, k));
  }

  function hitTargetRadius(o: Org, k: number): number {
    if (o._frame === "terr") return (compact ? 8.5 : 7) * unitPerPx;
    const visual = renderedRadius(o, k);
    const strength = dotStrength(o, k);
    const overviewFloorPx = compact
      ? o.weight <= 4 ? 9 : 12
      : strength < 0.35 ? 3.2 : o.weight <= 4 ? 4.2 : o.weight <= 8 ? 5.2 : 7;
    const deepFloorPx = compact
      ? o.weight <= 4 ? 5.5 : 6.5
      : strength < 0.35 ? 2.2 : o.weight <= 4 ? 2.6 : o.weight <= 8 ? 3.2 : 4.4;
    const deepT = smoothStep((k - 10) / 18);
    const floorPx = overviewFloorPx + (deepFloorPx - overviewFloorPx) * deepT;
    const overviewPadPx = compact ? (o.weight <= 4 ? 2.4 : 3.4) : o.weight <= 4 ? 1 : o.weight <= 8 ? 1.5 : 2.4;
    const deepPadPx = compact ? (o.weight <= 4 ? 0.8 : 1.2) : o.weight <= 4 ? 0.35 : o.weight <= 8 ? 0.55 : 0.8;
    const padPx = (overviewPadPx + (deepPadPx - overviewPadPx) * deepT) * (0.5 + strength * 0.5);
    return Math.max(visual + padPx * unitPerPx, floorPx * unitPerPx);
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

  function spiderFanScale(k: number): number {
    // Offsets are target screen-space SVG units; divide by k because circles
    // live inside the zoomed group.
    return smoothStep((k - SPIDER_START_K) / (SPIDER_FULL_K - SPIDER_START_K)) / Math.max(k, 0.001);
  }

  function declutterBucket(k: number): number {
    if (k < 2) return Math.round(k * 8) / 8;
    if (k < 6) return Math.round(k * 4) / 4;
    return Math.round(k * 2) / 2;
  }

  function deepDeclutterT(k: number): number {
    return smoothStep((k - 8) / 28);
  }

  function maxDeclutterOffset(k: number): number {
    // Tight when zoomed out so dots sit close to their true location — accept
    // more overlap/obfuscation of small orgs at the overview rather than letting
    // them drift far from where they actually are. Loosens once deeply zoomed so
    // dense clusters spread enough to tap and inspect individual entities.
    // (Land clamping separately bounds water drift.)
    const basePx = compact
      ? k < 1.25 ? 40 : k < 2.2 ? 52 : k < 4 ? 56 : k < 7 ? 42 : 30
      : k < 1.25 ? 54 : k < 2.2 ? 78 : k < 4 ? 96 : k < 7 ? 78 : 58;
    const deepPx = compact ? 88 : 176;
    return (basePx + (deepPx - basePx) * deepDeclutterT(k)) * unitPerPx;
  }

  // _dx/_dy are solved in screen-space SVG units. Dividing by k keeps the
  // visible nudge stable inside the zoomed group without mutating _x/_y.
  function declutterScale(k: number): number {
    return 1 / Math.max(k, 0.001);
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
      cluster.forEach((o, i) => {
        const [rx, ry] = spiderOffset(i, cluster.length, step);
        o._rx = rx;
        o._ry = ry;
      });
    }
  }

  function positionOrgMarks(k = transform.k, force = false): void {
    relaxDeclutter(k, force);
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

  function updateZoomBounds(): void {
    if (!zoomBehavior) return;
    const pad = (compact ? 180 : 220) * unitPerPx;
    zoomBehavior.extent([[0, 0], [W, H]]).translateExtent([[-pad, -pad], [W + pad, H + pad]]);
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
    projection.fitSize([W, H], nationFeature as never);
    // Lock the Canada conic onto the composite's lower-48 scale/translate.
    canadaProj.scale(projection.scale()).translate(projection.translate() as [number, number]);
    if (canadaFeature) gMap.select<SVGPathElement>("path.canada").attr("d", canadaPath(canadaFeature as never));
    gMap.selectAll<SVGPathElement, unknown>("path.state").attr("d", path as never);
    gMap.select<SVGPathElement>("path.nation").attr("d", path(nationFeature as never));
    buildLandMask();

    for (const o of orgs) {
      o._rk = undefined;
      o._dx = 0;
      o._dy = 0;
      if (o.out_of_footprint) {
        o._x = undefined;
        o._y = undefined;
        o._frame = o.state === PUERTO_RICO_STATE ? "terr" : undefined;
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

  // Pull a displaced point back toward its base so it ends no more than `water`
  // viewBox units past the coastline. The dot may still sit slightly offshore
  // (so coastal clusters can breathe) but never far out to sea. Returns the
  // accepted [x, y]. Walks the base→displaced segment and keeps the furthest
  // point still on land, then allows a short hop into the water beyond it.
  function clampToLand(
    baseX: number,
    baseY: number,
    x: number,
    y: number,
    water: number,
  ): [number, number] {
    if (!landMask) return [x, y];
    if (onLand(x, y)) return [x, y];
    const dx = x - baseX;
    const dy = y - baseY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) return [baseX, baseY];
    const ux = dx / dist;
    const uy = dy / dist;
    // March outward from the base, tracking the last on-land sample.
    const stepLen = maskScale * 0.75;
    let lastLand = 0;
    for (let t = 0; t <= dist; t += stepLen) {
      if (onLand(baseX + ux * t, baseY + uy * t)) lastLand = t;
    }
    // Permit a short hop into the water past the coast (the "80% into the water"
    // allowance), but never the full requested distance.
    const allowed = Math.min(dist, lastLand + water);
    return [baseX + ux * allowed, baseY + uy * allowed];
  }

  // Resolve overlaps among dots currently eligible at this zoom. This is a
  // render-space layout only: _x/_y remain the true projected coordinates used
  // by links and projection math, while _dx/_dy are the temporary screen nudge.
  function relaxDeclutter(k = transform.k, force = false): void {
    const bucket = declutterBucket(k);
    if (!force && bucket === orgLayoutBucket) return;
    orgLayoutBucket = bucket;

    const spiderScreenScale = smoothStep((bucket - SPIDER_START_K) / (SPIDER_FULL_K - SPIDER_START_K));
    type LayoutItem = {
      o: Org;
      baseX: number;
      baseY: number;
      x: number;
      y: number;
      r: number;
      mass: number;
      fixed: boolean;
    };
    const items: LayoutItem[] = [];
    for (const o of orgs) {
      o._dx = 0;
      o._dy = 0;
      if (o._x == null || o._y == null) continue;
      const baseX = o._x * bucket + (o._rx ?? 0) * spiderScreenScale;
      const baseY = o._y * bucket + (o._ry ?? 0) * spiderScreenScale;
      const priority = Math.max(0, orgPriority(o));
      const fixed = o._frame === "terr";
      const strength = dotStrength(o, bucket);
      const protectedDot = fixed || strength >= 0.68 || priority >= 32 || o.weight >= 18 || o.is_iso_rto;
      const visualR = renderedRadius(o, bucket);
      const looseT = deepDeclutterT(bucket);
      const softCollision = visualR * (0.42 + strength * 0.42);
      items.push({
        o,
        baseX,
        baseY,
        x: baseX,
        y: baseY,
        r: protectedDot ? visualR : softCollision + (visualR - softCollision) * looseT,
        mass: fixed ? 1000 : protectedDot ? 1 + priority / 18 + visualR / 14 : 0.55 + priority / 42 + strength,
        fixed,
      });
    }
    if (items.length < 2) return;

    items.sort(
      (a, b) =>
        drawPriority(b.o, bucket) - drawPriority(a.o, bucket) ||
        b.o.weight - a.o.weight ||
        b.o.role_count - a.o.role_count ||
        a.o.ncr_id.localeCompare(b.o.ncr_id),
    );

    const maxR = items.reduce((m, it) => Math.max(m, it.r), 0);
    const cell = Math.max(MAX_RADIUS * unitPerPx, maxR * 2 + 8 * unitPerPx);
    const looseT = deepDeclutterT(bucket);
    const basePasses = compact ? 32 : bucket < 2.2 ? 80 : bucket < 4 ? 54 : 34;
    const passes = Math.round(basePasses + looseT * (compact ? 22 : 34));
    const gap = (1.8 + looseT * 2.2) * unitPerPx;

    for (let pass = 0; pass < passes; pass++) {
      const grid = new Map<string, number[]>();
      for (let i = 0; i < items.length; i++) {
        const key = Math.floor(items[i].x / cell) + ":" + Math.floor(items[i].y / cell);
        const bucketItems = grid.get(key);
        if (bucketItems) bucketItems.push(i);
        else grid.set(key, [i]);
      }
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        const gx = Math.floor(a.x / cell);
        const gy = Math.floor(a.y / cell);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const bucketItems = grid.get(gx + ox + ":" + (gy + oy));
            if (!bucketItems) continue;
            for (const j of bucketItems) {
              if (j <= i) continue;
              const b = items[j];
              let dx = b.x - a.x;
              let dy = b.y - a.y;
              let d = Math.hypot(dx, dy);
              const min = a.r + b.r + gap;
              if (d >= min) continue;
              if (d < 1e-4) {
                const angle = ((i + 1) * 2.399963229728653 + (j + 1) * 0.618033988749895) % (Math.PI * 2);
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                d = 1;
              }
              const overlap = min - d;
              const totalMass = a.mass + b.mass;
              const moveA = a.fixed ? 0 : (overlap * (b.fixed ? 1 : b.mass / totalMass)) / d;
              const moveB = b.fixed ? 0 : (overlap * (a.fixed ? 1 : a.mass / totalMass)) / d;
              a.x -= dx * moveA;
              a.y -= dy * moveA;
              b.x += dx * moveB;
              b.y += dy * moveB;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }

    const cap = maxDeclutterOffset(bucket);
    // How far a dot may end up past the coastline, in viewBox units. Tight when
    // zoomed out (no 1000-mile-offshore dots), looser as you zoom in and the
    // coast itself spreads across more screen. ("80% into the water" — coastal
    // dots can sit just offshore, never far out to sea.)
    const waterBudget = (compact ? 7 : 10) + Math.max(0, bucket - 1) * 4 + looseT * (compact ? 18 : 28);
    for (const it of items) {
      if (it.fixed) continue;
      let dx = it.x - it.baseX;
      let dy = it.y - it.baseY;
      const m = Math.hypot(dx, dy);
      if (m > cap) {
        dx = (dx / m) * cap;
        dy = (dy / m) * cap;
      }
      // Clamp against the land silhouette in viewBox space. The anchor is the
      // dot's true projected location (always on/near land); the displaced point
      // adds the solved offset (positions in the solver are scaled by `bucket`).
      const anchorX = it.o._x as number;
      const anchorY = it.o._y as number;
      const [vx, vy] = clampToLand(anchorX, anchorY, anchorX + dx / bucket, anchorY + dy / bucket, waterBudget);
      it.o._dx = (vx - anchorX) * bucket;
      it.o._dy = (vy - anchorY) * bucket;
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
    const tStr = transform.toString();
    // Circles ride the zoom transform, so panning is a single group attribute
    // (GPU-composited) instead of repositioning every dot in JS each frame.
    gMap.attr("transform", tStr);
    gInsets.attr("transform", tStr);
    gOverlay.attr("transform", tStr);
    gHit.attr("transform", tStr);
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    positionOrgMarks(k);

    const hot = hoverOrg ?? selectedOrg;
    const tourActive = tourIds.size > 0;
    // While a tour runs but no step is showing (tourRunning && !tourActive) the
    // map "blanks": everything dims, nothing is labelled. That makes each role
    // reveal read clearly and idles the breathing animation (cheaper on iOS).
    // Hit radii mostly track zoom, but also follow the resolved visual radius
    // after the isolation pass so deep-zoom panning doesn't leave stale targets.
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
      const vis = sx >= -margin && sx <= W + margin && sy >= -margin && sy <= H + margin;
      o._vis = vis;
      if (!vis) continue;
      shownCount++;
      visibleOrgs.push(o);
    }

    // Local-density / isolation pass (needs every visible dot's screen position).
    // For each, the nearest visible neighbour maps to an isolation factor 0..1.
    // Lonely dots (1) get a size boost and a better shot at a label; crowded dots
    // (0) are left as-is so clusters don't bloat.
    computeIsolation(visibleOrgs);

    for (const o of visibleOrgs) {
      // Puerto Rico inset dots are identified by the territory label, so they only
      // get an individual label when hovered/selected (never in the normal flow).
      const isTerr = o._frame === "terr";
      if (tourActive) {
        // During a walkthrough step only the highlighted set gets labels.
        if ((tourIds.has(o.ncr_id) || hot?.ncr_id === o.ncr_id) && (!isTerr || hot?.ncr_id === o.ncr_id)) candidates.push(o);
      } else if (!tourRunning && (hot?.ncr_id === o.ncr_id || (!isTerr && shouldTryLabel(o, k)))) {
        // Normal map. (During a blank beat — tourRunning && !tourActive — we
        // deliberately collect no candidates so nothing is labelled.)
        candidates.push(o);
      }
    }
    if (!tourActive && !tourRunning && shownCount <= (compact ? 12 : 28)) {
      const candidateIds = new Set(candidates.map((o) => o.ncr_id));
      for (const o of visibleOrgs) {
        if (o._frame === "terr" || candidateIds.has(o.ncr_id)) continue;
        candidates.push(o);
        candidateIds.add(o.ncr_id);
      }
    }

    candidates.sort(
      (a, b) =>
        Number(tourIds.has(b.ncr_id)) - Number(tourIds.has(a.ncr_id)) ||
        Number(selectedOrg?.ncr_id === b.ncr_id) - Number(selectedOrg?.ncr_id === a.ncr_id) ||
        orgPriority(b) - orgPriority(a) ||
        b.weight - a.weight ||
        b.role_count - a.role_count ||
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
    const labelState = new Map<
      string,
      { x: number; y: number; font: number; text: string; inside: boolean }
    >();
    const placed: Box[] = [];
    // De-dupe identical on-screen tokens: when several orgs share a brand (MEAN,
    // Evergy, USACE, AEP…) only the first — highest priority, since candidates
    // are pre-sorted — gets the name, so the map never repeats a label. Nearby
    // duplicates of the same brand read as one entity anyway. (Hover/select still
    // forces its own label regardless.)
    const usedLabels = new Set<string>();
    // Bound the animated/highlighted set so it stays cheap on iOS.
    const maxLabels = tourActive ? (compact ? 45 : 130) : labelLimit(k);
    // Keep labels from tucking under the floating topbar. Phones reserve a tall
    // band (the bar is bigger relative to the screen); desktop reserves a slim
    // one so top-row org labels don't hide behind the title chip.
    const topSafe = (compact && !tourActive ? 72 : tourActive ? 0 : 44) * unitPerPx;
    const edgeSafe = compact && !tourActive ? 5 * unitPerPx : 2 * unitPerPx;
    // Phones start with a wide label-suppression radius (sparse overview) but
    // tighten it as you zoom in so more labels fill the screen — matching the
    // desktop feel. Desktop is already tight.
    const clusterRadius = (compact ? Math.max(9, 22 - Math.max(0, k - 1.6) * 4) : k < 1.25 ? 10 : 8) * unitPerPx;
    const labeledClusters: Array<{ x: number; y: number }> = [];
    // Phones spread labels a little at first; the inflation now fades back out as
    // you zoom in (was growing), so zoomed-in iOS fills space instead of thinning.
    const spacing = compact && !tourActive ? Math.max(1, 1.5 - Math.max(0, k - 2) * 0.16) : 1;
    // ── Label decision tree (candidates are pre-sorted most-important first) ──
    // For each org, in importance order:
    //   1. INSIDE: if its short token fits inside the bubble at a legible size,
    //      draw it there. Inside labels live within their own bubble, so they
    //      never collide and are never thinned by a neighbour — that is why a
    //      bubble big enough to hold its name always shows it.
    //   2. FLOAT: otherwise place a floating label in preferred spots (on /
    //      beside / below; above only as a last resort). A floating label may
    //      not overlap an already-placed label, nor any *other* protected
    //      bubble — so a smaller org's label can never sit on a bigger org's
    //      bubble.
    //   3. THIN: identical tokens are de-duped and tight floating clusters are
    //      thinned — floating only; inside labels are exempt.
    // Every visible bubble at/above protectR is a blocker (tagged by id so a
    // bubble never blocks its own label), seeded up front so the rule holds no
    // matter which labels land first.
    const protectR = (compact ? 6.5 : 5) * unitPerPx;
    const bubbleBlockers: Array<{ id: string; box: Box }> = [];
    for (const o of visibleOrgs) {
      if (o._frame === "terr" || o._sx == null || o._sy == null) continue;
      const r = renderedRadius(o, k);
      if (r < protectR) continue;
      bubbleBlockers.push({ id: o.ncr_id, box: { x0: o._sx - r, x1: o._sx + r, y0: o._sy - r, y1: o._sy + r } });
    }
    const clearsBubbles = (box: Box, id: string): boolean =>
      !bubbleBlockers.some((b) => b.id !== id && boxesOverlap(box, b.box));

    let placedCount = 0;
    for (const o of candidates) {
      if (placedCount >= maxLabels) break;
      const sx = o._sx as number;
      const sy = o._sy as number;
      const r = renderedRadius(o, k);
      const forceLabel = hot?.ncr_id === o.ncr_id;
      const brand = tinyName(o);

      // 1. INSIDE — preferred, collision-free, never suppressed by neighbours.
      // The font shrinks to span the chord (up to the normal label size); the
      // floor keeps it readable. This runs before any de-dupe/thinning so a big
      // bubble next to a labelled one still gets its own name.
      const insideFont = Math.min(
        labelFontPx(o, k) * unitPerPx,
        (r * 1.74) / Math.max(1, brand.length) / 0.56,
      );
      const insideMin = (compact ? 5.2 : 5.6) * unitPerPx;
      if (insideFont >= insideMin && insideFont * 0.56 * brand.length <= r * 1.86) {
        if (forceLabel || !usedLabels.has(brand)) {
          labelState.set(o.ncr_id, { x: sx, y: sy, font: insideFont, text: brand, inside: true });
          if (!forceLabel) usedLabels.add(brand);
          if (r < protectR) bubbleBlockers.push({ id: o.ncr_id, box: { x0: sx - r, x1: sx + r, y0: sy - r, y1: sy + r } });
          placedCount++;
        }
        continue;
      }

      // 2/3. FLOAT — de-dupe + thin tight clusters (floating labels only).
      if (
        !forceLabel &&
        (usedLabels.has(brand) ||
          labeledClusters.some((p) => (p.x - sx) ** 2 + (p.y - sy) ** 2 <= clusterRadius ** 2))
      ) {
        continue;
      }
      const text = labelText(o, k);
      const font = labelFontPx(o, k) * unitPerPx;
      const w = (Math.max(14, text.length * font * 0.56) + 5) * spacing;
      const h = (font + 5) * spacing;
      const nudge = r + font * 0.82 + 2 * unitPerPx;
      // Sit on the dot, then to the sides, then below, then the below-diagonals.
      // Above-the-bubble labels are held back on compact screens; they visually
      // detach from the mark and too often read as labels for a neighbouring dot.
      const spots = [
        [sx, sy + font * 0.32],
        [sx + nudge, sy + font * 0.32],
        [sx - nudge, sy + font * 0.32],
        [sx, sy + nudge],
        [sx + nudge * 0.78, sy + nudge * 0.72],
        [sx - nudge * 0.78, sy + nudge * 0.72],
      ];
      if (forceLabel || (!compact && k >= 3.4)) {
        spots.push(
          [sx, sy - nudge],
          [sx + nudge * 0.78, sy - nudge * 0.58],
          [sx - nudge * 0.78, sy - nudge * 0.58],
        );
      }
      let chosen: { x: number; y: number; box: Box } | null = null;
      for (const [lx, ly] of spots) {
        const box: Box = { x0: lx - w / 2, x1: lx + w / 2, y0: ly - h * 0.7, y1: ly + h * 0.3 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        if (placed.some((p) => boxesOverlap(box, p))) continue;
        if (!clearsBubbles(box, o.ncr_id)) continue;
        chosen = { x: lx, y: ly, box };
        break;
      }
      if (!chosen) continue;
      placed.push(chosen.box);
      if (!forceLabel) {
        labeledClusters.push({ x: sx, y: sy });
        usedLabels.add(brand);
      }
      labelState.set(o.ncr_id, { x: chosen.x, y: chosen.y, font, text, inside: false });
      placedCount++;
    }

    gOverlay.selectAll<SVGCircleElement, Org>("circle.org").each(function (o) {
      const node = this as SVGCircleElement;
      node.classList.toggle("hide", !o._vis);
      if (!o._vis) return;
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
      node.classList.toggle("hot", hot?.ncr_id === o.ncr_id);
      node.classList.toggle("selected", selectedOrg?.ncr_id === o.ncr_id);
      // Only the labeled subset breathes (bounded count = cheap on iOS); the
      // rest of the focus set gets a static highlight. During a step everything
      // else dims; during a blank beat (tourRunning, no step) everything dims.
      node.classList.toggle("tour-flash", inTour && labeled);
      node.classList.toggle("tour-pick", inTour && !labeled);
      node.classList.toggle("tour-dim", tourRunning && !inTour);
      node.style.setProperty(
        "--org-opacity",
        String(hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id || inTour ? 1 : orgOpacity(o, k, labeled)),
      );
    });

    gHit.selectAll<SVGCircleElement, Org>("circle.org-hit").each(function (o) {
      const node = this as SVGCircleElement;
      node.classList.toggle("hide", !o._vis);
      if (!o._vis) return;
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
      node.classList.toggle("hot-label", hot?.ncr_id === o.ncr_id);
      node.classList.toggle("selected-label", selectedOrg?.ncr_id === o.ncr_id);
      node.classList.toggle("tour-flash", tourActive && !!state);
    });

    const placeBlockers = [...placed];
    for (const o of placeableOrgs) {
      if (!o._vis || o._sx == null || o._sy == null) continue;
      const r = renderedRadius(o, k) + 2 * unitPerPx;
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
        const px = (p.tier === 1 ? 11.5 : p.tier === 2 ? 10.5 : 9.5) * unitPerPx;
        const w = p.name.length * px * 0.62 + 4;
        const h = px + 4;
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
        const cw = name.length * s.font * 0.62 + 4;
        const ch = s.font + 4;
        landBlockers.push({ x0: s.x - cw / 2, x1: s.x + cw / 2, y0: s.y - ch * 0.9, y1: s.y + ch * 0.1 });
      });
      for (const o of visibleOrgs) {
        if (!o._vis || o._sx == null || o._sy == null) continue;
        const r = renderedRadius(o, k);
        if (r < (compact ? 9 : 11) * unitPerPx) continue;
        const pad = (compact ? 3 : 2.5) * unitPerPx;
        landBlockers.push({ x0: o._sx - r - pad, x1: o._sx + r + pad, y0: o._sy - r - pad, y1: o._sy + r + pad });
      }
      let placedLand = 0;
      const landCap = compact ? 12 : 28;
      for (const L of landLabels) {
        if (placedLand >= landCap) break;
        if (L.small && k < 3.2) continue; // tiny states only once zoomed in
        const sx = transform.applyX(L.x);
        const sy = transform.applyY(L.y);
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
        const grow = Math.max(0.85, 1.28 - Math.max(0, k - 1) * 0.06);
        const font = (L.small ? 9 : 12) * grow * unitPerPx;
        const w = L.name.length * font * 0.6 + 4;
        const h = font + 4;
        const box: Box = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h * 0.6, y1: sy + h * 0.4 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        if (landBlockers.some((q) => boxesOverlap(box, q))) continue;
        landBlockers.push(box);
        placedLand++;
        landState.set(L.name, { x: sx, y: sy, font });
      }
    }

    gLand.selectAll<SVGTextElement, LandLabel>("text.land-label").each(function (L) {
      const node = this as SVGTextElement;
      const state = landState.get(L.name);
      node.classList.toggle("dim", !state);
      if (!state) return;
      node.setAttribute("x", String(state.x));
      node.setAttribute("y", String(state.y));
      node.setAttribute("font-size", String(state.font));
    });

    // Territory region names ride the inset group's transform (so each label
    // tracks its offshore cluster) but keep a constant on-screen size like every
    // other label: the group already scales by k, so divide the base font by k.
    // Hidden during the walkthrough like the other ambient labels.
    gInsets
      .selectAll<SVGTextElement, TerritoryBox>("text.terr-label")
      .attr("font-size", ((compact ? 11 : 10.5) * unitPerPx) / Math.max(k, 0.001))
      .classed("dim", tourRunning);
  }

  // Lay Puerto Rico's offshore orgs out as a labelled cluster of dots — no
  // framed box. Geocoded orgs keep relative geography via geoMercator fitExtent;
  // ungeocoded orgs fall into a centred grid. Other out-of-footprint territories
  // are intentionally hidden from the map.
  function layoutTerritoryInsets(): void {
    territoryBoxes = [];
    const terrProj = geoMercator();
    const margin = 6 * unitPerPx;
    const bottomMargin = (compact ? 64 : 8) * unitPerPx;
    const labelH = (compact ? 12 : 11) * unitPerPx + 5 * unitPerPx;
    const innerPad = 9 * unitPerPx;

    const present = new Map<string, Org[]>();
    for (const o of orgs) {
      if (!o.out_of_footprint || o.state !== PUERTO_RICO_STATE) continue;
      const arr = present.get(o.state);
      if (arr) arr.push(o);
      else present.set(o.state, [o]);
    }

    function boxSize(code: string): [number, number] {
      const u = unitPerPx;
      switch (code) {
        case "PR":
          return [(compact ? 140 : 162) * u, (compact ? 104 : 118) * u];
        default:
          return [(compact ? 74 : 84) * u, (compact ? 64 : 70) * u];
      }
    }

    function sortTerritory(list: Org[]): Org[] {
      return [...list].sort(
        (a, b) =>
          b.weight - a.weight ||
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
    ): void {
      const geocoded = list.filter((o) => o.lat != null && o.lng != null);
      const ungeocoded = list.filter((o) => o.lat == null || o.lng == null);

      if (geocoded.length) {
        terrProj.fitExtent(
          [
            [x + innerPad, y + labelH + innerPad * 0.5],
            [x + boxW - innerPad, y + boxH - innerPad],
          ],
          { type: "MultiPoint", coordinates: geocoded.map((o) => [o.lng as number, o.lat as number]) } as never,
        );
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
      // scale), where the inset is docked near the lower-right edge.
      const rawLx = hasDots ? (minX + maxX) / 2 : x + boxW / 2;
      const labelHalf = (label.length * (compact ? 11 : 10.5) * unitPerPx * 0.55) / 2;
      const edge = 4 * unitPerPx;
      const lx =
        labelHalf * 2 >= W - edge * 2
          ? W / 2
          : Math.min(W - edge - labelHalf, Math.max(edge + labelHalf, rawLx));
      territoryBoxes.push({ code, label, x, y, w: boxW, h: boxH, lx, ly });
    }

    const prList = present.get(PUERTO_RICO_STATE);
    if (prList?.length) {
      const [prW, prH] = boxSize("PR");
      const y = compact ? Math.min(H - bottomMargin - prH, H * 0.7) : H - bottomMargin - prH;
      placeInBox("PR", "Puerto Rico", W - margin - prW, y, prW, prH, sortTerritory(prList));
    }
  }

  // Territory region names (base coordinates; ride the inset group's zoom
  // transform so each name tracks its offshore cluster). The framed boxes are
  // gone — territories read as labelled clusters of dots now — so this just
  // places the region name above each cluster. Font size is finalised per frame
  // in redraw (kept constant on-screen). Geometry changes only on resize, so
  // this runs from project().
  function drawTerritoryFrames(): void {
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
          orgs.map((o) => o.region),
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
      createEl("div", "tt-name", o.entity_name),
      createEl("div", "tt-sub", `${o.region ?? "No Regional Entity"} | ${typeLabel(o.org_type)} | ${o.role_count} roles | weight ${o.weight}`),
    );

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
    renderTooltip(o);
    placeTooltip(ev.clientX, ev.clientY);
  }

  function showTooltipAt(o: Org, anchorX: number, anchorY: number): void {
    renderTooltip(o);
    placeTooltip(anchorX, anchorY);
  }

  function hideTooltip(): void {
    tooltip.hidden = true;
  }

  function applyHighlights(): void {
    const hot = hoverOrg ?? selectedOrg;
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
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
    panelBody.replaceChildren();
    const close = createEl("button", "nerc-panel-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closePanel();
    });
    panelBody.append(close);
    const title = createEl("div", "p-title");
    title.style.setProperty("--org-color", safeColor(o.color));
    title.append(createEl("span", "p-acronym", orgAcronym(o)), createEl("h2", undefined, o.entity_name));
    const idLabel = o.nerc_registered === false ? "No NERC ID" : o.ncr_id;
    panelBody.append(title, createEl("p", "p-sub", `${idLabel}${o.seed ? " | seed record" : ""} | ${typeLabel(o.org_type)}`));

    const dl = createEl("dl");
    const roles = createEl("div", "p-roles");
    o.roles.forEach((role) => {
      const row = createEl("div", "p-role");
      row.append(createRolePill(role), createEl("span", undefined, roleFullName(role)));
      roles.append(row);
    });
    addDlRow(dl, `Roles (${o.role_count})`, roles);
    addDlRow(dl, "Role weight", `${o.weight}${o.is_iso_rto ? " | ISO/RTO scale" : ""}`);
    addDlRow(dl, "Regional Entity", o.region ?? "No Regional Entity");
    addDlRow(dl, "Location", o.headquarters_address ?? locationLabel(o));
    addDlRow(dl, "Location confidence", `${confidenceLabel(o.geo_confidence)}${o.geo_source ? ` | ${o.geo_source}` : ""}`);
    if (o.geo_notes) addDlRow(dl, "Notes", o.geo_notes);

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
  }

  function closePanel(): void {
    panel.hidden = true;
    selectedOrg = null;
    invalidateOrgLayout();
    redraw();
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

  function animateTransform(next: ZoomTransform, duration = 350): void {
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

  function homeView(duration = 350): void {
    animateTransform(zoomIdentity, duration);
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

  function centerOnOrg(o: Org, duration = 450): void {
    if (o._x == null || o._y == null) return;
    // Ensure a readable zoom, but never zoom the user back out if they've
    // already zoomed in deeper.
    const scale = Math.min(MAX_ZOOM, Math.max(transform.k, o.is_iso_rto ? 3.2 : 4.2));
    const next = zoomIdentity.translate(W / 2, H / 2).scale(scale).translate(-o._x, -o._y);
    animateTransform(next, duration);
  }

  function selectOrg(o: Org, opts: { center?: boolean } = {}): void {
    stopTour();
    selectedOrg = o;
    invalidateOrgLayout();
    infoPanel.hidden = true;
    metricsPanel.hidden = true;
    renderPanel(o);
    hideTooltip();
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
        raiseVisibleOrg(o);
        redraw();
        showTooltip(o, ev as MouseEvent);
      })
      .on("mousemove", (ev) => placeTooltip((ev as MouseEvent).clientX, (ev as MouseEvent).clientY))
      .on("mouseleave", () => {
        hoverOrg = null;
        redraw();
        hideTooltip();
      })
      .on("focus", function (_ev, o) {
        hoverOrg = o;
        raiseVisibleOrg(o);
        redraw();
        const rect = (this as SVGCircleElement).getBoundingClientRect();
        showTooltipAt(o, rect.right, rect.top);
      })
      .on("blur", () => {
        hoverOrg = null;
        redraw();
        hideTooltip();
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
        raiseVisibleOrg(o);
        selectOrg(o);
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

    infoToggle.addEventListener("click", () => {
      stopTour();
      metricsPanel.hidden = true;
      panel.hidden = true;
      selectedOrg = null;
      infoPanel.hidden = !infoPanel.hidden;
      redraw();
    });
    metricsToggle.addEventListener("click", () => {
      stopTour();
      infoPanel.hidden = true;
      panel.hidden = true;
      selectedOrg = null;
      metricsPanel.hidden = !metricsPanel.hidden;
      if (!metricsPanel.hidden) renderStats();
      redraw();
    });
    byId<HTMLButtonElement>("nerc-info-close").addEventListener("click", closeInfo);
    byId<HTMLButtonElement>("nerc-metrics-close").addEventListener("click", closeMetrics);

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        stopTour();
        closePopovers();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
        const step = ev.shiftKey ? 80 : 36;
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
      // The walkthrough keeps playing while the user pans/zooms (programmatic
      // transitions have no sourceEvent). A real gesture just nudges the Stop
      // control so they know they can take over.
      .on("start", (ev) => {
        if (ev.sourceEvent && tourRunning) nudgeStopAttention();
      })
      .on("zoom", (ev) => {
        transform = ev.transform;
        scheduleRedraw();
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
    tourStartView(reduced ? 0 : compact ? 520 : 760);

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
    const base = import.meta.env.BASE_URL;
    const [orgsPayload, topo] = await Promise.all([
      loadJson<OrgsPayload>(`${base}nerc/orgs.json`),
      loadJson<unknown>(`${base}nerc/states-10m.json`),
    ]);

    if (!Array.isArray(orgsPayload.orgs)) throw new Error("No orgs array found in NERC payload");
    orgs = orgsPayload.orgs;

    // Canada landmass (context). Non-fatal if the file is missing.
    canadaFeature = await loadJson<unknown>(`${base}nerc/canada-land.json`).catch(() => null);

    const topoAny = topo as { objects: Record<string, unknown> };
    const states = feature(topo as never, topoAny.objects.states as never) as never as { features: unknown[] };
    nationFeature = feature(topo as never, topoAny.objects.nation as never) as never;
    stateFeatures = states.features;

    // Draw order inside the basemap group: Canada (context) → states → nation.
    if (canadaFeature) gMap.append("path").attr("class", "canada");
    gMap.selectAll("path.state").data(states.features).join("path").attr("class", "state");
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
        a.weight - b.weight ||
        a.role_count - b.role_count ||
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
      .attr("aria-label", (o) => `${orgAcronym(o)} ${o.entity_name}`);

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
    revealActionButtons();
  }

  init().catch((err) => {
    console.error(err);
    loadingEl.textContent = "Could not load map data.";
  });
}
