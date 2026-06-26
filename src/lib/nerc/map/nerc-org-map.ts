import { geoAlbersUsa, geoConicEqualArea, geoMercator, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { forceSimulation, forceX, forceY, type Simulation } from "d3-force";
import { quadtree } from "d3-quadtree";
import "d3-transition";
import { feature, mesh } from "topojson-client";
import { tightenMapLabel } from "../display-names.mjs";
import { PLACES } from "../places.mjs";
import { isExcludedTerritoryFips, US_INSET_STATE_CODES } from "../geography-scope.mjs";
import {
  CONFIDENCE_LABELS,
  confidenceLabel,
  displayMapLabel,
  displayName,
  idLabel,
  locationLabel,
  memberDisplayName,
  midName,
  orgAcronym,
  primaryRoles,
  regionLabel,
  roleFullName,
  safeColor,
  safeHttpUrl,
  tinyName,
  typeLabel,
} from "./org-display";

type Place = { name: string; lat: number; lng: number; tier: number; _x?: number; _y?: number };

// The curated market families that support click-to-focus mode. Each maps to a
// hub org plus a membership set (see the *_IDS sets and marketFamily below).
type MarketFamilyId = "PJM" | "MISO" | "NYISO" | "ISONE";

type Org = {
  ncr_id: string;
  entity_name: string;
  acronym: string;
  acronym_source: string | null;
  area_aliases?: string[];
  // Researched three-tier display names; null until name review fills org-names.json.
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
  // Ephemeral: background dot temporarily enlarged for hover/select/tour focus.
  _promoteBackground?: boolean;
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
  _vrPromoted?: boolean;
  // Memoized orgWidthFactor (label-aware rectangle width multiple) and the
  // (zoom, size-generation, fallback) it was computed for.
  _wf?: number;
  _wfk?: number;
  _wfGen?: number;
  _wfFallback?: boolean;
  // Last viewBox hit radius written to the invisible target. It follows the
  // resolved visual radius, not just zoom, so panning at deep zoom stays aligned.
  _hr?: number;
  // Which projection placed this org: mainland Albers ("us"), the Canada conic
  // ("ca"), or a territory inset ("terr").
  _frame?: "us" | "ca" | "terr";
  // Static memos — set once after orgs load, never change at runtime.
  _tiny?: string;       // tinyName(o)
  _mrc?: number;        // meaningfulRoleCount(o)
  _defMarket?: boolean; // isDeferredMarketOrg(o)
  _giveWay?: boolean;   // isGiveWayDot(o) — GO/GOP-only subordinate dot layer
  _toOnly?: boolean;    // isTransmissionOwnerOnly(o)
  _gridLead?: boolean;  // isGridLeadershipOrg(o)
  _topTier?: boolean;   // isTopTierOrg(o)
  _vp?: number;         // visualPriority(o)
  _lpv?: number;        // labelPriority(o)
  _sizeTier?: number;   // sizeTier(o)
  _mf?: MarketFamilyId | null; // marketFamily(o)
  _focusDist?: number;  // geo distance to its family hub (focus-mode pulse stagger)
  _focusDelay?: number; // animation-delay (s) so the focus pulse sweeps outward
  _visRank?: number;    // position in visual-priority-descending sort
  _labelRank?: number;  // position in label-priority-descending sort
  // Last-written DOM state — skip redundant attribute/class writes when unchanged.
  _wox?: number;
  _woy?: number;
  _whx?: number;
  _why?: number;
  _wasVis?: boolean;
  _hitVis?: boolean;
  _clsMask?: number;
  _hitMask?: number;
  _lw?: {
    vis: boolean;
    x: number;
    y: number;
    font: number;
    text: string;
    inside: boolean;
    centered: boolean;
    fill: string;
    stroke: string;
    strokeWidth: string;
    flags: number;
  };
};

type LandLabel = {
  name: string;
  x: number;
  y: number;
  small: boolean;
  kind: "state" | "province" | "water";
  // Interior water (rivers, lakes, bays) stays as open-space context when zoomed in;
  // open ocean / Great Lakes labels are overview-only and hide at deep zoom.
  interior?: boolean;
  _node?: SVGTextElement;
};
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

// Map geometry and disclosure constants.
// Viewbox dimensions. These are recomputed from the live element size so the
// viewBox aspect ratio matches the screen (no letterbox bands on tall phones).
let W = 960;
let H = 600;
const SPIDER_CLUSTER_EPSILON = 0.35;
const SPIDER_RING_STEP_PX = 28;
// Absolute safety ceiling (CSS px) on any bubble radius — a backstop above every
// size tier so a stacked floor/boost can never produce a runaway bubble. Per-tier
// full-zoom sizes live in tierBaseRadiusPx.
// Bubbles only ever move in render space (_dx/_dy nudges); the true projected
// _x/_y are never mutated, so geography stays exact.
const MAX_RADIUS = 68;
const MAX_ZOOM = 1600;
const ORG_CONTENT_SCALE = 0.92;
const BUBBLE_WIDTH_FACTOR = 1.08;
const BUBBLE_HEIGHT_FACTOR = 0.74;
const BUBBLE_PACKING_FACTOR = 1.1;
// Bubbles are wider than they are tall, so packing them as circles (sized to the
// width) wastes vertical space. Treat each reserved slot as an ellipse instead:
// horizontal half = packing radius, vertical half = packing radius ÷ this factor.
// Both the capacity gate and the force collide stretch the y-axis by this amount
// so rows can sit closer together — more bubbles fit on screen. The 0.9 safety
// factor keeps a little vertical breathing room (perfectly box-tight packing
// leaves rounded-corner neighbours touching) so the no-overlap backstop holds.
const BUBBLE_PACK_Y_STRETCH = (BUBBLE_WIDTH_FACTOR / BUBBLE_HEIGHT_FACTOR) * 0.9;

// Anisotropic drop-in for d3-force's forceCollide: resolves each node pair as an
// axis-aligned ELLIPSE (vertical half-extent = radius ÷ yStretch) rather than a
// circle, so wider-than-tall bubbles pack tightly on both axes. Mirrors the
// d3-force@3 collide internals (quadtree + visitAfter bounding radii); the only
// change is that y-distances are multiplied by yStretch before the circular
// overlap test and the resulting y-push is divided back out.
type CollideNode = { index?: number; x: number; y: number; vx: number; vy: number };
function forceCollideAniso<N extends CollideNode>(
  radius: (n: N) => number,
  yStretch: number,
  iterations = 1,
  strength = 1,
): ((alpha: number) => void) & { initialize: (nodes: N[]) => void } {
  let nodes: N[] = [];
  let radii: number[] = [];

  // visitAfter callback: stamp each quadtree cell with the largest radius beneath
  // it so the descent in force() can prune whole branches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function prepare(quad: any): void {
    if (quad.data) {
      quad.r = radii[quad.data.index];
      return;
    }
    quad.r = 0;
    for (let i = 0; i < 4; ++i) {
      if (quad[i] && quad[i].r > quad.r) quad.r = quad[i].r;
    }
  }

  function force(): void {
    const n = nodes.length;
    for (let k = 0; k < iterations; ++k) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tree = quadtree(nodes, (d: N) => d.x, (d: N) => d.y).visitAfter(prepare as any);
      for (let i = 0; i < n; ++i) {
        const node = nodes[i];
        const ri = radii[node.index as number];
        const ri2 = ri * ri;
        const xi = node.x + node.vx;
        const yi = node.y + node.vy;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tree.visit((quad: any, x0: number, y0: number, x1: number, y1: number): boolean | void => {
          const data = quad.data as N | undefined;
          const rj = quad.r as number;
          const r = ri + rj;
          if (data) {
            if ((data.index as number) > (node.index as number)) {
              let x = xi - data.x - data.vx;
              let y = (yi - data.y - data.vy) * yStretch; // stretch y → circular test
              let l = x * x + y * y;
              if (l < r * r) {
                if (x === 0) { x = 1e-6; l += x * x; }
                if (y === 0) { y = 1e-6; l += y * y; }
                const dist = Math.sqrt(l);
                l = ((r - dist) / dist) * strength;
                const rj2 = rj * rj;
                const m = rj2 / (ri2 + rj2);
                const md = 1 - m;
                node.vx += (x *= l) * m;
                node.vy += ((y *= l) * m) / yStretch; // un-stretch the y push
                data.vx -= x * md;
                data.vy -= (y * md) / yStretch;
              }
            }
            return;
          }
          // Prune cells that cannot reach node i (use r, the stretched bound, as a
          // safe superset of the real elliptical reach).
          return x0 > xi + r || x1 < xi - r || y0 > yi + r || y1 < yi - r;
        });
      }
    }
  }

  force.initialize = (n: N[]): void => {
    nodes = n;
    radii = new Array(n.length);
    for (const node of n) radii[node.index as number] = radius(node);
  };

  return force;
}

// Quiet dots for orgs that could not earn a non-overlapping bubble slot.
// Background-tier dots: present on the map but not yet promoted to a bubble.
const FALLBACK_TINY_RADIUS_PX = { desktop: 1.35, compact: 1.2 };
const FALLBACK_TINY_RADIUS_DEEP_PX = { desktop: 1.75, compact: 1.55 };
// D3 transition duration for programmatic zoom (tour, center-on-org, home reset).
const ZOOM_TRANSITION_MS = 175;
const AUTHORITY_ROLES = new Set(["BA", "RC", "PC"]);
const BA_RC_ROLES = new Set(["BA", "RC"]);
const MAJOR_OPERATOR_PARTNER_ROLES = new Set(["TOP", "PC", "TSP"]);
const GRID_ROLES = new Set(["TSP", "TP", "TO", "DP", "LSE"]);
const SUPPORT_ROLES = new Set(["RP", "RSG", "FRSG", "RRSG"]);
const GENERATION_ROLES = new Set(["GO", "GOP"]);
const ZERO_VISUAL_PRIORITY_ROLES = new Set(["GO", "GOP", "COP", "PSE"]);
// Give-way dots: the GO/GOP-only generator companies. They render as a
// subordinate dot layer that NEVER joins the packing/force-sim — it always
// gives way to (moves around) the real bubbles and only shows details on
// hover/click. Zoom-gated: hidden at the calm national overview, faded in as
// the user zooms into a region. Reveal-K and fade span are tunable here.
// Reveal earlier (was 4.5 / 5.0) so dots show at regional zoom, not only deep
// zoom — they fade in sub-pixel at reveal-K and grow, so an earlier gate adds
// texture without clutter and (being out of the sim) can never displace a bubble.
// Compact reveals sooner (3.0 vs 3.4 desktop) so phone users see dots after fewer
// pinch steps; the overview (k ≈ 1) stays dot-free on both layouts.
const GIVE_WAY_DOT_REVEAL_K = 3.4;
const GIVE_WAY_DOT_REVEAL_K_COMPACT = 3.0;
// Short fade so dots reach full (still small) size soon after reveal — visible and
// clickable in the regional view rather than lingering sub-pixel. Compact uses a
// tighter span so phone dots finish growing sooner after the gate opens.
const GIVE_WAY_DOT_FADE_SPAN = 0.5;
const GIVE_WAY_DOT_FADE_SPAN_COMPACT = 0.4;
// Give-way dots render larger than plain fallback-tiny dots so they read as
// clickable markers. Compact gets a hair more scale (still subordinate to pills).
const GIVE_WAY_DOT_SIZE_SCALE = 2.3;
const GIVE_WAY_DOT_SIZE_SCALE_COMPACT = 2.4;
// Extra screen-px gaps layoutDotGiveWay keeps around each dot: from every real bubble
// (so dots sit clearly OUTSIDE the organizations) and from other dots (so a cluster
// spreads out instead of stacking). Bigger = more breathing room, fewer hidden.
const GIVE_WAY_DOT_ORG_GAP_PX = 3.2;
const GIVE_WAY_DOT_DOT_GAP_PX = 3.6;
// Growth anchor for generation-only micro-orgs: how deep before their post-reveal
// size ramp begins. Kept high so they stay small at mid/deep zoom.
const GENERATION_ONLY_REVEAL_K = 50;
const GENERATION_ONLY_REVEAL_K_COMPACT = 48;
// PSE-market entities stay the deepest tier. (GO/GOP-only companies are excluded
// from the map entirely, so they have no display anchor.)
const PSE_MARKET_DISPLAY_K = 10;
const PSE_MARKET_DISPLAY_K_COMPACT = 14;
const TO_ONLY_REVEAL_K = 6.5;
const TO_ONLY_REVEAL_K_COMPACT = 7.5;
// Regional dev view and deeper: every non-generation-only org may appear.
const FULL_REGISTRY_REVEAL_K = 3.8;
const FULL_REGISTRY_REVEAL_K_COMPACT = 4.2;
const SYSTEM_OPERATOR_NAME = /\b(ISO|RTO|Independent System Operator|Interconnection|Transmission System Operator|Electric Reliability Council)\b/i;
// The actual North-American ISOs / RTOs (market + grid operators). Narrower than
// the weight-based `is_iso_rto` sizing flag — these eight are the real ones, and
// they get the animated saber outline plus an explicit panel note.
const ISO_RTO_OPERATOR_NAME =
  /PJM Interconnection|Midcontinent Independent System Operator|Southwest Power Pool|Electric Reliability Council of Texas|California Independent System Operator|ISO New England|ISO-NE|New York Independent System Operator|Ontario IESO|Independent Electricity System Operator|Alberta Electric System Operator/i;

// The MISO hub org (Midcontinent ISO) — the anchor every control-area thread
// connects to.
const MISO_HUB_ID = "NCR00826";
// MISO Local Balancing Authorities — the "control areas" that make up MISO.
// Source: MISO Tariff Attachment VV, effective October 26, 2025. The tariff
// lists 38 current LBA codes; two pairs share one map organization here:
// EAI/EES -> Entergy and MIUP/WEC -> Wisconsin Electric.
// https://docs.misoenergy.org/miso12-legalcontent/Attachment_VV_-_MAP_of_Local_Resource_Zone_Boundaries.pdf
const MISO_CONTROL_AREA_CODES = new Map<string, readonly string[]>([
  ["NCR00961", ["ALTE"]], // Alliant East
  ["NCR00962", ["ALTW"]], // Alliant West
  ["SUP-ameren-illinois", ["AMIL"]], // Ameren Illinois
  ["NCR10248", ["AMMO"]], // Ameren Missouri
  ["NCR01180", ["BREC"]], // Big Rivers Electric
  ["SUP-duke-energy-ohio-kentucky", ["CIN"]], // Cinergy
  ["NCR01083", ["CLEC"]], // Central Louisiana Electric / Cleco
  ["NCR00740", ["CONS"]], // Consumers Energy
  ["NCR01196", ["CWLD"]], // Columbia Water & Light
  ["NCR01328", ["CWLP"]], // City Water, Light & Power
  ["NCR00753", ["DECO"]], // Detroit Edison / DTE
  ["NCR00979", ["DPC"]], // Dairyland Power Cooperative
  ["NCR01234", ["EAI", "EES"]], // Entergy Arkansas / Entergy Electric System
  ["NCR11783", ["GLH"]], // GridLiance Heartland
  ["NCR00992", ["GRE"]], // Great River Energy
  ["NCR00794", ["HE"]], // Hoosier Energy
  ["NCR01254", ["HMPL"]], // Henderson Municipal Power & Light
  ["NCR00798", ["IPL"]], // Indianapolis Power & Light / AES Indiana
  ["NCR01114", ["LAFA"]], // Lafayette Utilities
  ["NCR12543", ["LAGT"]], // 1803 Electric Cooperative
  ["NCR01116", ["LEPA"]], // Louisiana Energy & Power Authority
  ["NCR01015", ["MDU"]], // Montana-Dakota Utilities
  ["NCR00824", ["MEC"]], // MidAmerican Energy
  ["NCR00818", ["MGE"]], // Madison Gas & Electric
  ["NCR00951", ["MIUP", "WEC"]], // Michigan Upper Peninsula / Wisconsin Electric
  ["NCR00674", ["MP"]], // Minnesota Power
  ["NCR00967", ["MPW"]], // Muscatine Power & Water
  ["NCR02611", ["NIPS"]], // Northern Indiana Public Service
  ["NCR01020", ["NSP"]], // Northern States Power
  ["NCR01023", ["OTP"]], // Otter Tail Power
  ["NCR00917", ["SIGE"]], // Southern Indiana Gas & Electric
  ["NCR01321", ["SIPC"]], // Southern Illinois Power Cooperative
  ["NCR01315", ["SME"]], // South Mississippi Electric / Cooperative Energy
  ["NCR01030", ["SMP"]], // Southern Minnesota Municipal Power Agency
  ["NCR01033", ["UPPC"]], // Upper Peninsula Power
  ["NCR00952", ["WPS"]], // Wisconsin Public Service
]);

// The PJM hub org (PJM Interconnection) — the anchor every PJM transmission-zone
// thread connects to.
const PJM_HUB_ID = "NCR00879";
// PJM transmission-zone codes from PJM's 2026 Network Service Peak Loads.
// Organizations receive these codes through area-aliases.json at build time, so
// the renderer does not duplicate the code-to-org mapping. WESTERN HUB is a
// pricing hub rather than an organization and remains an area interface only.
const PJM_TRANSMISSION_ZONE_CODES = new Set([
  "AECO",
  "AEP",
  "APS",
  "ATSI",
  "BGE",
  "COMED",
  "DAY",
  "DEOK",
  "DOM",
  "DPL",
  "DUQ",
  "EKPC",
  "JCPL",
  "METED",
  "OVEC",
  "PECO",
  "PENELEC",
  "PEPCO",
  "PPL",
  "PSEG",
  "RECO",
]);

// The NYISO hub org (New York Independent System Operator) — anchor for the New
// York transmission family.
const NYISO_HUB_ID = "NCR07160";
// NYISO Transmission Owners — the eight Transmission Districts that make up the
// NYISO transmission system. Source: NYISO Open Access Transmission Tariff (OATT)
// Attachment H (Transmission Owners) / NYISO Transmission District map.
// https://www.nyiso.com/transmission-owners — each is a distinct NERC TO/TOP
// registration; no area-alias codes exist for NY districts, so membership is
// curated here by ncr_id (mirrors MISO_CONTROL_AREA_CODES).
const NYISO_TO_IDS = new Set<string>([
  "NCR07028", // Central Hudson Gas & Electric
  "NCR07046", // Consolidated Edison Co of NY (Con Edison)
  "NCR07133", // Long Island Power Authority (LIPA)
  "NCR07161", // New York Power Authority (NYPA)
  "NCR07163", // Niagara Mohawk Power Corporation (National Grid)
  "NCR07181", // New York State Electric & Gas (NYSEG)
  "NCR07186", // Orange and Rockland Utilities
  "NCR07207", // Rochester Gas and Electric (RG&E)
]);

// The ISO-NE hub org (ISO New England) — anchor for the New England transmission
// family.
const ISONE_HUB_ID = "NCR07124";
// ISO New England Participating Transmission Owners (PTOs) — the transmission
// backbone utilities under the ISO-NE Transmission Operating Agreement. Source:
// ISO-NE Tariff Section II, Schedule 21 PTO service agreements / the TOA
// signatory list. https://www.iso-ne.com/participate/participant-asset-listings
// Municipal/light-department TOs are excluded: ISO-NE is the single balancing
// authority, so unlike MISO LBAs they are not separate control areas.
const ISONE_PTO_IDS = new Set<string>([
  "NCR07176", // Eversource Energy Service Company (Eversource TO registration)
  "NCR-SEED-039", // The Connecticut Light and Power Company (Eversource CT)
  "NCR07222", // United Illuminating Company (Avangrid)
  "NCR07029", // Central Maine Power Company (Avangrid)
  "NCR11171", // National Grid USA
  "NCR07159", // New England Power Company (National Grid)
  "NCR07013", // Versant Power (formerly Bangor Hydro / Emera Maine)
  "NCR07134", // Maine Electric Power Company
  "NCR12248", // The Narragansett Electric Company / Rhode Island Energy
  "NCR07228", // Vermont Transco, LLC (VELCO-managed)
  "NCR07086", // Fitchburg Gas and Electric Light Company (Unitil)
]);

// Per-family metadata the renderer keys off: the anchor hub, the svg focus class
// + member saber class that drive the dim/glow CSS, and the classification pill
// shown for a member (PJM Zone / MISO LBA / NYISO TO / ISO-NE PTO). Membership
// itself lives in marketFamily() (it needs the closure's area-alias helpers).
// Adding a family = a *_IDS set, one row here, and the matching CSS block.
interface MarketFamilyMeta {
  hubId: string;
  focusClass: string; // svg root class while this family is focused
  saberClass: string; // class on the hub's saber so it keeps family colour
  pillLabel: string; // classification pill text for a member
  pillClass: string; // tooltip pill CSS class (family colour)
  pillTitle: string; // pill tooltip / aria text
  panelTagClass: string; // detail-panel <p> wrapper class
  panelBadgeClass: string; // detail-panel badge class (family colour)
}
const MARKET_FAMILIES: Record<MarketFamilyId, MarketFamilyMeta> = {
  PJM: {
    hubId: PJM_HUB_ID,
    focusClass: "focus-pjm",
    saberClass: "pjm-saber",
    pillLabel: "PJM Zone",
    pillClass: "nerc-pjm-area-pill",
    pillTitle: "PJM Transmission Zone",
    panelTagClass: "p-pjmzone",
    panelBadgeClass: "p-pjmzone-badge",
  },
  MISO: {
    hubId: MISO_HUB_ID,
    focusClass: "focus-miso",
    saberClass: "miso-saber",
    pillLabel: "MISO LBA",
    pillClass: "nerc-miso-area-pill",
    pillTitle: "MISO Local Balancing Authority",
    panelTagClass: "p-misoca",
    panelBadgeClass: "p-misoca-badge",
  },
  NYISO: {
    hubId: NYISO_HUB_ID,
    focusClass: "focus-nyiso",
    saberClass: "nyiso-saber",
    pillLabel: "NYISO TO",
    pillClass: "nerc-nyiso-area-pill",
    pillTitle: "NYISO Transmission Owner",
    panelTagClass: "p-nyisoto",
    panelBadgeClass: "p-nyisoto-badge",
  },
  ISONE: {
    hubId: ISONE_HUB_ID,
    focusClass: "focus-isone",
    saberClass: "isone-saber",
    pillLabel: "ISO-NE PTO",
    pillClass: "nerc-isone-area-pill",
    pillTitle: "ISO New England Participating Transmission Owner",
    panelTagClass: "p-isonepto",
    panelBadgeClass: "p-isonepto-badge",
  },
};
const MARKET_FAMILY_IDS = Object.keys(MARKET_FAMILIES) as MarketFamilyId[];
const MARKET_HUB_IDS = new Set(MARKET_FAMILY_IDS.map((id) => MARKET_FAMILIES[id].hubId));

const RELIABILITY_ORG_NAME = /\b(ReliabilityFirst|Reliability (Organization|Corporation|Entity|Council|Coordinator)|Coordinating Council)\b/i;
const REGIONAL_ENTITY_NAME = /\b(NERC|SERC|WECC|MRO|NPCC|ReliabilityFirst|Texas Reliability Entity|Midwest Reliability Organization|Northeast Power Coordinating Council|Western Electricity Coordinating Council|Regional Entity)\b/i;
const FEDERAL_NAME = /\b(Power Administration|Tennessee Valley Authority|Bonneville|Western Area Power|Southwestern Power|Southeastern Power|Bureau of Reclamation|USACE|U\.S\. Army Corps)\b/i;
const PUBLIC_POWER_AUTHORITY_NAME = /\b(Power Authority|Power Administration)\b/i;
const PUBLIC_UTILITY_NAME = /\b(Public Power|Public Utility|Utility District|PUD|Municipal|City of|Town of|Electric Department|Light Department|Cooperative|Electric Membership)\b/i;

// Out-of-footprint U.S. territories rendered as labelled inset clusters (geoAlbersUsa
// cannot plot them on the mainland canvas).
// Territory insets (Puerto Rico / U.S. Virgin Islands) are disabled by product
// choice. Their orgs drop out and the Atlantic lane is reclaimed so the lower-48
// map fills the canvas width.
const SHOW_TERRITORIES = false;
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
// Out-of-footprint PR/VI inset dots use a fixed schematic radius, sized like
// ordinary small map bubbles instead of oversized island callouts.
const TERRITORY_BUBBLE_RADIUS_PX = { desktop: 4.6, compact: 5.4 };
const TERRITORY_HIT_RADIUS_PX = { desktop: 8.6, compact: 10 };

// Alaska and Hawaii plot on geoAlbersUsa's built-in lower-left/right insets.
// They share the mainland declutter path but need extra spread and tap area at
// overview zoom where the inset is tiny on screen. (PR/VI use separate offshore
// inset boxes — see layoutTerritoryInsets and geography-scope.mjs.)
function isUsInsetOrg(o: { state?: string | null }): boolean {
  return US_INSET_STATE_CODES.has(o.state ?? "");
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

// Water-body labels filling the big open ocean/lake gaps around the footprint —
// always-open space, so they give the map geographic context without ever
// crowding the data. Projected with the lower-48 albersUsa like the states.
const WATER_LABELS: Array<{ name: string; lat: number; lng: number; interior?: boolean }> = [
  // Overview-only open water + Great Lakes (hide once zoomed in).
  { name: "Gulf of Mexico", lat: 26, lng: -91 },
  { name: "Atlantic Ocean", lat: 31, lng: -75 },
  { name: "Pacific Ocean", lat: 38, lng: -125 },
  { name: "Gulf of Maine", lat: 43, lng: -67.8 },
  { name: "Lake Superior", lat: 47.7, lng: -87.7 },
  { name: "Lake Michigan", lat: 43.6, lng: -87.1 },
  { name: "Lake Huron", lat: 44.8, lng: -82.2 },
  { name: "Lake Erie", lat: 42.2, lng: -81.2 },
  { name: "Lake Ontario", lat: 43.7, lng: -77.9 },
  // Interior water — rivers, lakes, bays. Flagged interior:true so they persist as
  // open-space geographic context when the user zooms into a region (placed at a
  // representative open point; they still yield to NERC data via the open-space test).
  { name: "Mississippi River", lat: 33.4, lng: -91.1, interior: true },
  { name: "Missouri River", lat: 46.0, lng: -100.5, interior: true },
  { name: "Ohio River", lat: 38.3, lng: -86.5, interior: true },
  { name: "Colorado River", lat: 36.0, lng: -113.5, interior: true },
  { name: "Rio Grande", lat: 29.7, lng: -101.5, interior: true },
  { name: "Columbia River", lat: 45.9, lng: -119.8, interior: true },
  { name: "Snake River", lat: 43.6, lng: -114.5, interior: true },
  { name: "Arkansas River", lat: 38.0, lng: -100.5, interior: true },
  { name: "Red River", lat: 33.9, lng: -94.0, interior: true },
  { name: "Tennessee River", lat: 34.8, lng: -87.5, interior: true },
  { name: "Great Salt Lake", lat: 41.2, lng: -112.5, interior: true },
  { name: "Lake Tahoe", lat: 39.1, lng: -120.0, interior: true },
  { name: "Lake Okeechobee", lat: 26.95, lng: -80.8, interior: true },
  { name: "Lake Champlain", lat: 44.5, lng: -73.35, interior: true },
  { name: "Chesapeake Bay", lat: 38.0, lng: -76.1, interior: true },
  { name: "Long Island Sound", lat: 41.1, lng: -72.6, interior: true },
  { name: "Puget Sound", lat: 47.8, lng: -122.5, interior: true },
  { name: "San Francisco Bay", lat: 37.8, lng: -122.35, interior: true },
];

// Oversized geographic labels (big water bodies, Canadian provinces, Maine) that
// otherwise compete with the organization labels. Rendered noticeably smaller and
// quieter so NERC bubbles and short names stay the visual priority.
const QUIET_LAND_LABELS = new Set([
  "Gulf of Mexico", "Gulf of America",
  "Manitoba", "Ontario", "Québec", "Quebec",
  "New Brunswick", "Maine",
]);

// Tiny states whose centroid label would clutter the map at overview; held back
// until zoomed in. Alaska and Hawaii live in the Albers USA insets and are tiny
// on screen at national scale.
const SMALL_STATES = new Set([
  "Rhode Island", "Delaware", "Connecticut", "New Jersey", "New Hampshire",
  "Vermont", "Massachusetts", "Maryland", "District of Columbia", "Alaska", "Hawaii",
]);

// Curated label anchors for multi-island / inset states (centroids sit in open water).
const INSET_STATE_LABEL_LNG_LAT: Record<string, [number, number]> = {
  Alaska: [-152.5, 63.5],
  Hawaii: [-157.5, 20.3],
};

// City dots/names inside the AK/HI inset boxes defer until this zoom — same band as
// the inset state labels — so the tiny overview inset stays land-only until zoomed in.
const INSET_AMBIENT_CONTEXT_MIN_K = 3.2;

// Extra clearance (screen px) when fencing mainland bubbles out of AK/HI insets.
const INSET_MAINLAND_FENCE_PAD_PX = 4;

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

// Conservative text-width measurement for inside labels. The bubble inside label
// is bold (font-weight 800) Inter; estimating its width from a glyph average lets
// short bold abbreviations spill past the rounded rectangle. Measure the real
// rendered width with a canvas, cached by text (width scales linearly with font
// size, so one reference measurement covers every zoom). Falls back to the glyph
// estimate when canvas is unavailable (SSR / older browsers).
let _measureCtx: CanvasRenderingContext2D | null | undefined;
const _measureRefWidth = new Map<string, number>();
const TEXT_MEASURE_REF_PX = 100;
function measuredTextWidth(text: string, fontPx: number): number {
  if (fontPx <= 0 || !text) return 0;
  let refW = _measureRefWidth.get(text);
  if (refW == null) {
    if (_measureCtx === undefined) {
      try {
        _measureCtx = document.createElement("canvas").getContext("2d");
      } catch {
        _measureCtx = null;
      }
    }
    if (_measureCtx) {
      _measureCtx.font = `800 ${TEXT_MEASURE_REF_PX}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      refW = _measureCtx.measureText(text).width;
    } else {
      // Glyph-average fallback (matches insideLabelGlyphWidth's scale).
      refW = text.length * TEXT_MEASURE_REF_PX * (text.length > 5 ? 0.69 : 0.67);
    }
    _measureRefWidth.set(text, refW);
  }
  return (refW / TEXT_MEASURE_REF_PX) * fontPx;
}

async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

// Runtime map client: D3 state, viewport-dependent layout, and interaction wiring
// live in one mount closure. Pure display text lives in org-display.ts.
export function mountNercOrgMap(): void {
  const root = document.querySelector<HTMLElement>("[data-nerc-map]");
  if (!root || root.dataset.mounted === "true") return;
  root.dataset.mounted = "true";
  const dataBase = import.meta.env.BASE_URL;
  // Start fetching map payloads immediately so network overlaps SVG setup.
  const orgsPayloadPromise = loadJson<OrgsPayload>(`${dataBase}nerc/orgs-render.json`);
  const topoPromise = loadJson<unknown>(`${dataBase}nerc/states-10m.json`);
  const canadaPromise = loadJson<unknown>(`${dataBase}nerc/canada-land.json`).catch(() => null);

  const svgNode = byId<SVGSVGElement>("nerc-svg");
  const svg = select(svgNode);
  const gMap = svg.append("g").attr("class", "map");
  // PR/VI offshore inset frames (geoMercator boxes east of the lower 48).
  const gInsets = svg.append("g").attr("class", "insets");
  // City context stays below every NERC mark and label.
  const gPlaces = svg.append("g").attr("class", "places");
  // Area context is even quieter than city context and must paint below the
  // NERC overlay, not over it.
  const gLand = svg.append("g").attr("class", "land");
  const gOverlay = svg.append("g").attr("class", "overlay");
  // Animated orange "saber" outlines for the ISO/RTO bubbles — painted just above
  // the bubbles (so the light reads on top) but below the hit + label layers.
  const gSaber = svg.append("g").attr("class", "saber");
  const gHit = svg.append("g").attr("class", "hit");
  const gLabels = svg.append("g").attr("class", "labels");

  const tooltip = byId<HTMLElement>("nerc-tooltip");
  const rolePopover = createEl("div", "nerc-role-popover");
  rolePopover.id = "nerc-role-popover";
  rolePopover.hidden = true;
  rolePopover.setAttribute("role", "tooltip");
  rolePopover.setAttribute("aria-live", "polite");
  svgNode.parentElement?.append(rolePopover);
  const panel = byId<HTMLElement>("nerc-panel");
  const panelBody = byId<HTMLElement>("nerc-panel-body");
  // Static close/collapse buttons — siblings of the scrolling body so they stay
  // pinned to the card's top-right while the body scrolls.
  const panelCloseBtn = byId<HTMLButtonElement>("nerc-panel-close");
  const panelCollapseBtn = byId<HTMLButtonElement>("nerc-panel-collapse");
  const infoPanel = byId<HTMLElement>("nerc-info-panel");
  const metricsPanel = byId<HTMLElement>("nerc-metrics-panel");
  const playBtn = byId<HTMLButtonElement>("nerc-play-tour");
  const fabBtn = byId<HTMLButtonElement>("nerc-tour-fab");
  const metricsBody = byId<HTMLElement>("nerc-metrics-body");
  const loadingEl = byId<HTMLElement>("nerc-loading");
  const tourStatus = byId<HTMLElement>("nerc-tour-status");
  const focusStatus = byId<HTMLElement>("nerc-focus-status");
  const focusClearBtn = byId<HTMLButtonElement>("nerc-focus-clear");
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
  // PJM/MISO focus mode. `null` = normal map; "PJM"/"MISO" = that hub is the
  // centre of attention (its family lights up, everything else greys out). This is
  // the ONLY state the focus feature adds; it is deliberately limited to the two
  // market hubs (see marketFamily / the focus helpers below). Set whenever a hub
  // is selected, cleared on background-click / Escape / the Clear control.
  let activeFocusGroup: MarketFamilyId | null = null;
  // Last PJM/MISO subarea clicked while its hub focus is active — visual emphasis
  // only; the detail panel stays anchored to the parent hub.
  let focusedSubareaOrg: Org | null = null;
  let userPanning = false;
  let lastPanEndAt = 0;
  let wheelZooming = false;
  let zoomBoundsDirty = false;
  let wheelRedrawPending = false;
  let focusPanPending = false;
  // True while a selection is being framed by centerOnOrg (focus-hub click), so the
  // gentler edge-nudge below stands down and the two pans never fight.
  let centerSelection = false;
  let tourIds = new Set<string>();
  let tourTimers: number[] = [];
  // Tour mode is on (button shows Stop) even between steps / during the reset.
  let tourRunning = false;
  let tourNoticeTimer: number | undefined;
  // Cache for hit-circle radii: they only change with zoom, so skip the
  // per-redraw setAttribute storm during a tour (transform is static).
  let hitK = NaN;
  let nationFeature: unknown = null;
  let nationOutline: unknown = null;
  let canadaFeature: unknown = null;
  let stateFeatures: unknown[] = [];
  // Screen-space bounds of the geoAlbersUsa AK/HI inset silhouettes (recomputed on
  // every project()). Used to keep mainland packing out of the insets and AK/HI
  // utilities inside their home inset.
  let akInsetBounds: [[number, number], [number, number]] | null = null;
  let hiInsetBounds: [[number, number], [number, number]] | null = null;
  // Low-res land masks in viewBox space, rebuilt on every project(). Separate US
  // and Canada silhouettes so mainland orgs cannot drift across the border.
  let landMask: Uint8Array | null = null;
  let usLandMask: Uint8Array | null = null;
  let caLandMask: Uint8Array | null = null;
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
  // Phones enlarge bubbles for readability/tap, but a touch less than before so a few
  // more organizations fit on screen at the default (home) overview. Tap targets keep
  // their own comfortable floors in hitTargetRadius, so selection stays easy.
  const phoneSizeScale = (): number => (phone ? 1.1 : 1);
  let orgMarkK = NaN;
  let orgLayoutBucket = NaN;
  // Live force-simulation layout state (see computePlacements). The sim owns each
  // disclosed bubble's screen-space offset (_dx/_dy); it animates while warm and
  // is reheated when the zoom bucket changes.
  type SimNode = {
    o: Org;
    hx: number; // home (true projected) x in screen-at-bucket space — for _dx
    hy: number;
    tx: number; // anchor TARGET: the nearest non-overlapping on-land slot the gate
    ty: number; // found within the geographic leash (close to home, never flung away)
    r: number; // reserved radius (visual + half gap)
    anchor: number; // positional-force strength toward the target slot
    cap: number; // max wander distance from the target slot
    frame: LandFrame;
    x: number;
    y: number;
    vx: number;
    vy: number;
  };
  let orgSim: Simulation<SimNode, undefined> | null = null;
  let simNodes: SimNode[] = [];
  let simBucket = NaN;
  // Last computed label placement, used for hover radius/class updates without
  // recomputing the full label pass.
  let lastLabelState: Map<string, { x: number; y: number; font: number; text: string; inside: boolean }> | null = null;
  let tooltipRequest = 0;
  let rolePopoverTimer: number | undefined;

  function invalidateOrgLayout(): void {
    orgMarkK = NaN;
    orgLayoutBucket = NaN;
    orgSim?.stop();
    simNodes = [];
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
    // Project each org to screen space LIVE rather than reading cached o._sx/_sy:
    // the wheel/animated-zoom fast path updates the group transform without rerunning
    // the redraw loop that refreshes _sx/_sy, so the cache can lag the actual bubble
    // position right after a zoom — which would mis-resolve clicks (e.g. a subarea
    // click landing on the zoomed-in parent hub). Clicks are infrequent, so the
    // per-pick reprojection is cheap.
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    const sxOf = (o: Org) => transform.applyX(orgRenderX(o, fanScale, declScale));
    const syOf = (o: Org) => transform.applyY(orgRenderY(o, fanScale, declScale));
    let best: Org | null = null;
    // Rank by how deep the pointer is INSIDE each bubble relative to that bubble's
    // own size (normalized distance), not raw distance to centre. In a dense
    // cluster this picks the dot you actually clicked into rather than a larger
    // neighbour whose centre happens to be nearer. A pointer inside a drawn
    // bubble always beats one only inside the padded hit ring.
    let bestNorm = Number.POSITIVE_INFINITY;
    let bestInVisual = false;
    let bestVisual = Number.POSITIVE_INFINITY;
    let bestD2 = Number.POSITIVE_INFINITY;
    // Tolerance (in viewBox units) for treating two bubble radii as "the same
    // size" before falling back to normalized distance / draw priority.
    const radiusTol = 0.75 * unitPerPx;
    for (const o of placeableOrgs) {
      if (!o._vis || o._x == null || o._y == null) continue;
      const dx = sxOf(o) - point.x;
      const dy = syOf(o) - point.y;
      const d2 = dx * dx + dy * dy;
      if (!orgHitContainsOffset(o, k, dx, dy)) continue;
      const visual = renderedRadius(o, k);
      const inVisual = orgBubbleContainsOffset(o, k, dx, dy, visual);
      // Pills compete only inside their visible geometry — padded hit alone must
      // never beat a nearby dot the pointer is actually on.
      if (!isDotOrg(o) && !inVisual) continue;
      const pillVsPill = best !== null && !isDotOrg(o) && !isDotOrg(best);
      const focusBoost = pillVsPill
        ? (hoverOrg?.ncr_id === o.ncr_id ? 5000 : 0) +
          (selectedOrg?.ncr_id === o.ncr_id && activeFocusGroup == null ? 5000 : 0)
        : 0;
      const tourBoost = tourIds.has(o.ncr_id) ? 4000 : 0;
      const norm = orgHitNormDistance(o, k, dx, dy);
      if (best === null) {
        best = o;
        bestNorm = norm;
        bestInVisual = inVisual;
        bestVisual = visual;
        bestD2 = d2;
        continue;
      }
      // Selection order in dense clusters:
      //   1. Pointer inside a drawn bubble beats one only in the padded hit ring.
      //   2. Two overlapping drawn bubbles: smaller (innermost) wins — a dot under a
      //      larger neighbour stays selectable when clicked on directly.
      //   3. Two dots: nearest centre wins (no hover/selected stickiness).
      //   4. Pills only reach this loop when inVisual; dots win from hit ring alone
      //      when the pointer is outside every competing pill body.
      //   5. Pill-vs-pill ties fall back to normalized distance, then draw priority
      //      (hover/selected/tour boosts apply only here, never over a clear dot).
      let better: boolean;
      if (inVisual !== bestInVisual) {
        better = inVisual;
      } else if (inVisual && visual < bestVisual - radiusTol) {
        better = true; // innermost (smaller) drawn bubble wins
      } else if (inVisual && visual > bestVisual + radiusTol) {
        better = false; // keep the tighter bubble already chosen
      } else if (isDotOrg(o) && isDotOrg(best)) {
        // Two dots: nearest centre, no focus stickiness — hover flips instantly.
        better = d2 < bestD2;
      } else {
        const bestFocusBoost =
          pillVsPill
            ? (hoverOrg?.ncr_id === best.ncr_id ? 5000 : 0) +
              (selectedOrg?.ncr_id === best.ncr_id && activeFocusGroup == null ? 5000 : 0)
            : 0;
        const bestTourBoost = tourIds.has(best.ncr_id) ? 4000 : 0;
        better =
          norm < bestNorm - 0.02 ||
          (Math.abs(norm - bestNorm) <= 0.02 &&
            drawPriority(o, k) + focusBoost + tourBoost >
              drawPriority(best, k) + bestFocusBoost + bestTourBoost);
      }
      if (better) {
        best = o;
        bestNorm = norm;
        bestInVisual = inVisual;
        bestVisual = visual;
        bestD2 = d2;
      }
    }
    // Nothing passed the hit test — hand back the caller's fallback org.
    if (best === null) return fallback;
    // Honour the hit target the pointer landed on — especially background dots
    // whose visual radius is tiny but whose padded target is easy to tap.
    if (
      fallback._vis &&
      fallback._x != null &&
      fallback._y != null &&
      (fallback.placementMode === "fallbackTiny" || fallback._promoteBackground)
    ) {
      const fdx = sxOf(fallback) - point.x;
      const fdy = syOf(fallback) - point.y;
      if (orgHitContainsOffset(fallback, k, fdx, fdy)) {
        if (best.ncr_id === fallback.ncr_id) return fallback;
        const d2fb = fdx * fdx + fdy * fdy;
        const d2best = (sxOf(best) - point.x) ** 2 + (syOf(best) - point.y) ** 2;
        const visBest = renderedRadius(best, k);
        const bestInsideVis = orgBubbleContainsOffset(
          best,
          k,
          sxOf(best) - point.x,
          syOf(best) - point.y,
          visBest,
        );
        // Keep the tapped tiny dot unless the pointer is clearly inside another
        // bubble's drawn circle and nearer that neighbour's centre.
        if (!bestInsideVis || d2fb <= d2best) return fallback;
      }
    }
    return best;
  }

  function colorFor(role: string): string {
    const el = document.querySelector(`.nerc-role-def[data-role="${CSS.escape(role)}"] .nerc-dot`) as HTMLElement | null;
    return el ? getComputedStyle(el).backgroundColor : "#777";
  }

  function createRolePill(role: string, full = false, interactive = true): HTMLSpanElement {
    const pill = createEl("span", "nerc-rolepill", full ? `${role} - ${roleFullName(role)}` : role);
    const fullName = roleFullName(role);
    pill.title = fullName;
    pill.style.backgroundColor = colorFor(role);
    if (interactive) {
      pill.dataset.role = role;
      pill.tabIndex = 0;
      pill.setAttribute("role", "button");
      pill.setAttribute("aria-label", `${role}: ${fullName}`);
      pill.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showRolePopover(role, pill);
      });
      pill.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        showRolePopover(role, pill);
      });
    }
    return pill;
  }

  function createAreaPill(label: string, className: string, title: string): HTMLSpanElement {
    const pill = createEl("span", `nerc-rolepill ${className}`, label);
    pill.title = title;
    return pill;
  }

  // Disclosure text: placement tries compact labels first and only admits longer
  // labels after zoom gives them enough room.
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
    const midTight = tightenMapLabel(mid, compact ? 12 : 14);
    // Keep the longer "mid" brand only when it is genuinely short; otherwise stay
    // with the compact token so a long name never dominates its neighbours.
    if (midTight === tiny || midTight.length > (compact ? 12 : 14)) return [tiny];
    return [tiny, midTight];
  }

  function hasAnyRole(o: Org, roles: Set<string>): boolean {
    return o.roles.some((r) => roles.has(r));
  }

  function meaningfulRoleCount(o: Org): number {
    if (o._mrc != null) return o._mrc;
    return (o._mrc = o.roles.filter((r) => !ZERO_VISUAL_PRIORITY_ROLES.has(r)).length);
  }

  function isOnlyMeaningfulRole(o: Org, role: string): boolean {
    const roles = o.roles.filter((r) => !ZERO_VISUAL_PRIORITY_ROLES.has(r));
    return roles.length === 1 && roles[0] === role;
  }

  function isGenerationOnly(o: Org): boolean {
    return o.roles.length > 0 && o.roles.every((r) => GENERATION_ROLES.has(r));
  }

  // The give-way dot layer: GO/GOP-only generator companies. These are kept out
  // of the placement/force-sim entirely (see canDisplayOrgBase) and drawn as a
  // subordinate dot layer that gives way to — and never moves or hides — any real
  // bubble. Memoized; roles are static so this never changes at runtime.
  function isGiveWayDot(o: Org): boolean {
    if (o._giveWay != null) return o._giveWay;
    return (o._giveWay = isGenerationOnly(o));
  }

  /** Fallback / give-way orgs drawn as circular dots (not label pills). */
  function isDotOrg(o: Org): boolean {
    return !!o._renderFallback || isGiveWayDot(o);
  }

  function giveWayDotRevealK(): number {
    return compact ? GIVE_WAY_DOT_REVEAL_K_COMPACT : GIVE_WAY_DOT_REVEAL_K;
  }

  function giveWayDotFadeSpan(): number {
    return compact ? GIVE_WAY_DOT_FADE_SPAN_COMPACT : GIVE_WAY_DOT_FADE_SPAN;
  }

  function giveWayDotSizeScale(): number {
    return compact ? GIVE_WAY_DOT_SIZE_SCALE_COMPACT : GIVE_WAY_DOT_SIZE_SCALE;
  }

  // 0–1 fade-in for the dot layer: 0 below reveal-K, ramping to 1 over the fade
  // span so dots grow in as the user zooms into a region instead of popping.
  function dotDisclosureT(k: number): number {
    return smoothStep((k - giveWayDotRevealK()) / giveWayDotFadeSpan());
  }

  // PSE-only (or PSE with other zero-priority roles like GO/GOP) — no grid/reliability
  // roles. Kept separate from isGenerationOnly so PSE+TO etc. stay prominent.
  function isPseMarketOnly(o: Org): boolean {
    return o.roles.includes("PSE") && meaningfulRoleCount(o) === 0;
  }

  // GO/GOP-only and PSE-market orgs disclose at the same deep zoom tier.
  function isDeferredMarketOrg(o: Org): boolean {
    if (o._defMarket != null) return o._defMarket;
    return (o._defMarket = isGenerationOnly(o) || isPseMarketOnly(o));
  }

  function isTransmissionOwnerOnly(o: Org): boolean {
    if (o._toOnly != null) return o._toOnly;
    // Federal and reliability orgs often carry GO/GOP alongside TO; don't shrink
    // them to the transmission-owner floor when the data marks them as agencies.
    if (o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) return (o._toOnly = false);
    if (RELIABILITY_ORG_NAME.test(o.entity_name)) return (o._toOnly = false);
    if (PUBLIC_POWER_AUTHORITY_NAME.test(o.entity_name)) return (o._toOnly = false);
    return (o._toOnly = isOnlyMeaningfulRole(o, "TO"));
  }

  function generationOnlyRevealK(): number {
    return compact ? GENERATION_ONLY_REVEAL_K_COMPACT : GENERATION_ONLY_REVEAL_K;
  }

  function transmissionOwnerOnlyRevealK(): number {
    return compact ? TO_ONLY_REVEAL_K_COMPACT : TO_ONLY_REVEAL_K;
  }

  function fullRegistryRevealK(): number {
    return compact ? FULL_REGISTRY_REVEAL_K_COMPACT : FULL_REGISTRY_REVEAL_K;
  }

  // Supplemental AK/HI utilities defer until zoom makes the Albers inset large
  // enough to read; land geometry and state labels still show as context.
  function insetOrgRevealK(o: Org): number {
    if (!isUsInsetOrg(o) || o.nerc_registered !== false) return 0;
    const pri = visualPriority(o);
    const w = o.weight ?? 0;
    if (pri >= 35 || w >= 14) return compact ? 1.75 : 1.45;
    return compact ? 2.55 : 2.15;
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

  // Progressive zoom tiers. Every non-GO org is eligible to appear by ~k 1.0–1.35
  // (as a bubble or background dot); higher-priority orgs promote earlier.
  function overviewRevealK(o: Org): number {
    if (isTopTierOrg(o)) return 0;
    const pri = visualPriority(o);
    const w = o.weight ?? 0;
    if (isGridLeadershipOrg(o) || pri >= 50 || labelPriority(o) >= 68) return 0;
    if (pri >= 42) return w >= 12 ? (compact ? 0.24 : 0.16) : compact ? 0.44 : 0.34;
    if (pri >= 28) return compact ? 0.46 : 0.36;
    if (pri >= 18) return compact ? 0.56 : 0.46;
    return compact ? 0.76 : 0.62;
  }

  function isOuterOverviewZoom(k: number): boolean {
    return declutterBucket(k) <= 0.75;
  }

  function isHomeOverviewZoom(k: number): boolean {
    return declutterBucket(k) <= 1;
  }

  function isAuthorityColorOrg(o: Org): boolean {
    return hasAnyRole(o, AUTHORITY_ROLES);
  }

  function isOuterOverviewMajor(o: Org): boolean {
    if (isDeferredMarketOrg(o) || isTransmissionOwnerOnly(o)) return false;
    if (isAuthorityColorOrg(o)) return true;
    if (isTopTierOrg(o)) return true;
    const lp = labelPriority(o);
    const vp = visualPriority(o);
    const weight = o.weight ?? 0;
    if (isGridLeadershipOrg(o) && lp >= 72 && weight >= 14) return true;
    if (lp >= 78 && weight >= 14) return true;
    if (vp >= 82 && weight >= 18) return true;
    if ((o.is_iso_rto || o.org_type === "ISO_RTO" || RELIABILITY_ORG_NAME.test(o.entity_name)) && weight >= 10) return true;
    if ((o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) && weight >= 18) return true;
    return false;
  }

  function isNationalFillZoom(k: number): boolean {
    return declutterBucket(k) <= 1;
  }

  function isNationalFillOrg(o: Org): boolean {
    if (isOuterOverviewMajor(o)) return true;
    if (isDeferredMarketOrg(o) || isTransmissionOwnerOnly(o)) return false;
    if (o.is_private || o.org_type === "merchant") return false;
    const lp = labelPriority(o);
    const vp = visualPriority(o);
    const weight = o.weight ?? 0;
    if (isGridLeadershipOrg(o) && weight >= 6) return true;
    if (lp >= 66 && weight >= 7) return true;
    if (lp >= 50 && weight >= 8) return true;
    if (vp >= 48 && weight >= 9) return true;
    if (o.name_major && weight >= 10) return true;
    if (typePriority(o) >= 66 && weight >= 10) return true;
    if (meaningfulRoleCount(o) >= 2 && weight >= 10 && typePriority(o) >= 42) return true;
    return false;
  }

  // The normal, zoom-driven eligibility rule. This is what drives PLACEMENT
  // (computePlacements / the force sim) — focus mode deliberately does NOT widen it,
  // so the selected family's overlay sub-areas never enter the shared packing and
  // therefore never push the gray background organizations around.
  function canDisplayOrgBase(o: Org, k: number): boolean {
    // Give-way dots (GO/GOP-only) never enter PLACEMENT: returning false here keeps
    // them out of computePlacements' eligible set and the force-sim, so they can
    // never displace or hide a real bubble. They are drawn separately as a
    // subordinate dot layer (see the dot-branch in redraw + layoutDotGiveWay),
    // which is what makes them always give way to the rest of the map.
    if (isGiveWayDot(o)) return false;
    // The real ISOs/RTOs are headline orgs: always eligible at every zoom so they
    // are visible whenever their area is on screen (incl. the zoomed-out overview).
    if (isIsoRtoOperator(o)) return true;
    if (isUsInsetOrg(o) && k < insetOrgRevealK(o)) return false;
    // The fully zoomed-out view is a major-org overview: smaller eligible orgs
    // wait until the next zoom bucket so they do not take slots from high-ranked
    // regulated entities.
    if (isOuterOverviewZoom(k) && !isOuterOverviewMajor(o)) return false;
    // The first zoom-in buckets should feel full without turning into a low-ranked
    // local-utility scatter. Admit a broader but still regulated/grid-significant
    // tier before the normal progressive reveal takes over.
    if (!isOuterOverviewZoom(k) && isNationalFillZoom(k) && !isNationalFillOrg(o)) return false;
    if (k >= fullRegistryRevealK()) return true;
    if (isTopTierOrg(o)) return true;
    if (isTransmissionOwnerOnly(o)) return k >= transmissionOwnerOnlyRevealK();
    if (isDeferredMarketOrg(o)) return k >= pseMarketDisplayK();
    return k >= overviewRevealK(o);
  }

  // Visibility rule used by the renderer. In focus mode every PJM/MISO family member
  // is shown as a priority overlay even if the base zoom rules would hide it — but
  // placement still uses canDisplayOrgBase, so these overlay members ride on top of
  // the static background instead of joining (and disturbing) its layout.
  function canDisplayOrg(o: Org, k: number): boolean {
    return canDisplayOrgBase(o, k) || isFocusMember(o);
  }

  // 0–1 ramp: how fully an org promotes from background dot to readable bubble.
  // Higher labelPriority promotes earlier; low tiers stay tiny until mid/deep zoom.
  function bubbleDisclosureT(o: Org, k: number): number {
    if (isTopTierOrg(o)) return 1;
    if (k >= fullRegistryRevealK()) return 1;
    if (isDeferredMarketOrg(o)) {
      const start = microOrgRevealK(o);
      if (k < start) return 0;
      return smoothStep((k - start) / (compact ? 4 : 3));
    }
    const lp = labelPriority(o);
    // Floors raised so lower-rank orgs render less tiny at overview (a gentler size
    // contrast) and clear the inside-label gate sooner — so MORE bubbles show when
    // zoomed out, then fill in further on zoom.
    if (lp >= 88) return 1;
    if (lp >= 78) return 0.52 + 0.48 * smoothStep((k - 0.55) / (compact ? 0.95 : 0.8));
    if (lp >= 68) return 0.46 + 0.54 * smoothStep((k - 0.72) / (compact ? 1.1 : 0.95));
    if (lp >= 52) return 0.44 + 0.56 * smoothStep((k - 0.82) / (compact ? 1.25 : 1.1));
    if (lp >= 38) return 0.34 + 0.66 * smoothStep((k - 0.92) / (compact ? 1.35 : 1.15));
    if (lp >= 16) return 0.22 + 0.78 * smoothStep((k - 1.45) / (compact ? 1.85 : 1.65));
    return 0.16 + 0.84 * smoothStep((k - 1.9) / (compact ? 2.4 : 2.2));
  }

  // Disclosure tier for rendering: background dot → small bubble → full bubble (+ label).
  function disclosureTier(o: Org, k: number, hasLabel: boolean): "background" | "small" | "bubble" | "labeled" {
    if (o.placementMode === "fallbackTiny" && o._promoteBackground) {
      return hasLabel ? "labeled" : "bubble";
    }
    if (o.placementMode === "fallbackTiny" || o._renderFallback) return "background";
    if (hasLabel) return "labeled";
    const t = bubbleDisclosureT(o, k);
    if (t < 0.58) return "small";
    return "bubble";
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
    if (o._vp != null) return o._vp;
    let v: number;
    if (isDeferredMarketOrg(o)) v = 6;
    else if (isTransmissionOwnerOnly(o)) v = 8;
    else if (isMajorSystemOperator(o)) v = 100;
    else {
      const score =
        Math.max(rolePriority(o), typePriority(o), dataProminenceScore(o)) + multiRoleBonus(o);
      v = Math.max(10, Math.min(100, score));
    }
    return (o._vp = v);
  }

  // Label-specific priority: ISO/RTO and grid authority lead; merchant and
  // deferred-market orgs trail. Used for label eligibility, ordering, and tiers.
  function labelPriority(o: Org): number {
    if (o._lpv != null) return o._lpv;
    let v: number;
    if (isDeferredMarketOrg(o)) v = 2;
    else if (isTransmissionOwnerOnly(o)) v = 10;
    else if (o.is_iso_rto || o.org_type === "ISO_RTO" || SYSTEM_OPERATOR_NAME.test(o.entity_name)) v = 98;
    else if (isMajorSystemOperator(o)) v = 96;
    else if (o.roles.includes("RC")) v = 92;
    else if (o.roles.includes("BA")) v = 88;
    else if (o.roles.includes("PC")) v = 85;
    else if (o.roles.includes("TOP")) v = 82;
    else if (o.roles.includes("TSP")) v = 80;
    else if (o.roles.includes("TP")) v = 78;
    else if (REGIONAL_ENTITY_NAME.test(o.entity_name) || RELIABILITY_ORG_NAME.test(o.entity_name)) v = 74;
    else if (o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) v = 72;
    else if (o.org_type === "IOU" || PUBLIC_POWER_AUTHORITY_NAME.test(o.entity_name)) v = 68;
    else if (o.name_major && o.weight >= 20) v = 64;
    else if (hasAnyRole(o, GRID_ROLES)) v = 52;
    else if (o.org_type === "municipal" || o.org_type === "cooperative" || PUBLIC_UTILITY_NAME.test(o.entity_name)) v = 38;
    else if (o.org_type === "cca") v = 34;
    else if (hasAnyRole(o, SUPPORT_ROLES)) v = 40;
    else if (o.org_type === "merchant") v = 16;
    else v = 24;
    return (o._lpv = v);
  }

  function isGridLeadershipOrg(o: Org): boolean {
    if (o._gridLead != null) return o._gridLead;
    return (o._gridLead =
      isMajorSystemOperator(o) ||
      hasAnyRole(o, AUTHORITY_ROLES) ||
      o.roles.includes("TOP") ||
      o.roles.includes("TSP") ||
      o.is_iso_rto ||
      o.org_type === "federal" ||
      FEDERAL_NAME.test(o.entity_name) ||
      RELIABILITY_ORG_NAME.test(o.entity_name));
  }

  // Largest grid entities — always eligible and always placed at every zoom.
  function isTopTierOrg(o: Org): boolean {
    if (o._topTier != null) return o._topTier;
    if (isGenerationOnly(o) || isDeferredMarketOrg(o) || isTransmissionOwnerOnly(o)) return (o._topTier = false);
    const w = o.weight ?? 0;
    if (o.is_iso_rto || isMajorSystemOperator(o)) return (o._topTier = true);
    if (w >= 28) return (o._topTier = true);
    if (o.name_major && w >= 18) return (o._topTier = true);
    if (isGridLeadershipOrg(o) && w >= 22) return (o._topTier = true);
    return (o._topTier = false);
  }


  function visualPrioritySort(a: Org, b: Org): number {
    return (
      Number(isTopTierOrg(b)) - Number(isTopTierOrg(a)) ||
      visualPriority(b) - visualPriority(a) ||
      labelPriority(b) - labelPriority(a) ||
      (b.weight ?? 0) - (a.weight ?? 0) ||
      rolePriority(b) - rolePriority(a) ||
      typePriority(b) - typePriority(a) ||
      meaningfulRoleCount(b) - meaningfulRoleCount(a) ||
      a.ncr_id.localeCompare(b.ncr_id)
    );
  }

  function outerOverviewPlacementScore(o: Org): number {
    const weight = Math.max(0, o.weight ?? 0);
    const regulated =
      isAuthorityColorOrg(o) ||
      labelPriority(o) >= 52 ||
      typePriority(o) >= 66 ||
      isGridLeadershipOrg(o);
    return (
      (isAuthorityColorOrg(o) ? 180000 : 0) +
      (isTopTierOrg(o) ? 70000 : 0) +
      (regulated && weight >= 10 ? 20000 : 0) +
      Math.min(weight, 45) * 420 +
      visualPriority(o) * 60 +
      labelPriority(o) * 35 +
      typePriority(o) * 18 +
      rolePriority(o) * 12 +
      meaningfulRoleCount(o) * 140
    );
  }

  function outerOverviewPlacementSort(a: Org, b: Org): number {
    return (
      outerOverviewPlacementScore(b) - outerOverviewPlacementScore(a) ||
      visualPrioritySort(a, b)
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

  // Pre-compute stable integer sort ranks once after orgs load so that hot-path
  // per-frame sorts (computePlacements, label candidates) compare integers instead
  // of invoking the full multi-comparator chains on every element pair.
  function computeStaticRanks(): void {
    const byVisual = [...orgs].sort(visualPrioritySort);
    byVisual.forEach((o, i) => { o._visRank = i; });
    const byLabel = [...orgs].sort(
      (a, b) => labelPrioritySort(a, b) || a.entity_name.localeCompare(b.entity_name),
    );
    byLabel.forEach((o, i) => { o._labelRank = i; });
  }

  function drawPriority(o: Org, _k: number): number {
    if (o._promoteBackground) {
      return visualPriority(o) + meaningfulRoleCount(o) * 2 + 500;
    }
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

  function promotedBackgroundRadius(o: Org, k: number): number {
    const tiny = fallbackTinyRadiusPx(k) * unitPerPx * ORG_CONTENT_SCALE;
    const cap = Math.min(
      visualRadius(o, k),
      (compact ? 9.5 : 12) * unitPerPx * ORG_CONTENT_SCALE,
    );
    return Math.min(cap, Math.max(tiny * 2.4, tiny + (compact ? 5.5 : 6.5) * unitPerPx));
  }

  function isBackgroundPromoted(o: Org, forced: boolean): boolean {
    return forced && o.placementMode === "fallbackTiny";
  }

  // True when the org should draw as a tiny dot this frame (placement failed).
  function rendersAsBackgroundDot(o: Org, hasLabel: boolean, forced: boolean): boolean {
    if (o._frame === "terr" || o.placementMode !== "fallbackTiny") return false;
    if (forced || hasLabel) return false;
    return true;
  }

  // Label eligibility is independent of bubble visibility. Fallback dots never
  // label unless forced; major orgs label early; low-priority orgs defer.
  function isLabelForced(o: Org, tourActive: boolean, hot: Org | null): boolean {
    if (hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id) return true;
    if (tourActive && tourIds.has(o.ncr_id)) return true;
    return false;
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
      ? priority >= 80 ? 9.7 : priority >= 50 ? 8.4 : 6.6
      : priority >= 80 ? 13 : priority >= 50 ? 11.3 : 9.2;
    // Explicit zoom scaling: keep national-view labels subdued, then grow text
    // steadily as the user moves into regional and local views.
    const zoomFontScale =
      (compact ? 0.74 : 0.68) +
      (compact ? 0.24 : 0.3) * smoothStep((k - 0.7) / 2.2) +
      (compact ? 0.34 : 0.42) * smoothStep((k - 3.2) / 7.5);
    const overviewReadabilityBoost =
      1 +
      (compact ? 0.1 : 0.22) *
        (1 - smoothStep((k - 1) / 0.55));
    // Mid/high-zoom readability: an extra ramp that kicks in past the overview so
    // labels keep getting bigger (and more legible) the further you zoom in. The
    // inside-label path still clamps to the bubble chord and long names fall back
    // to the short token, so this never causes overflow.
    const midHighBoost = 1 + 0.58 * smoothStep((k - 1.8) / (compact ? 6 : 7));
    const growth = compact
      ? Math.min(2.55, (1 + Math.max(0, k - 1) * 0.06) * midHighBoost)
      : Math.min(2.85, (1 + Math.max(0, k - 1) * 0.08) * midHighBoost);
    const microLabelBoost = 1 + (isDeferredMarketOrg(o) ? (compact ? 1.05 : 0.85) : 0.55) * postRevealBoostT(o, k);
    // Once the user has intentionally zoomed in (k~3+), smaller organizations'
    // labels grow an extra bit so they read easily. This does NOT change when a
    // dot is disclosed (that is overviewRevealK/canDisplayOrg) — it only enlarges
    // the text of dots already on screen. Top-tier (>=80) labels are left alone
    // since they're already prominent (and being trimmed above).
    const smallOrgCloseBoost =
      priority >= 80 ? 1 : 1 + (priority < 50 ? 0.28 : 0.16) * smoothStep((k - 3) / 4);
    // Narrow phones: scale every label up so names stay readable on a small handset.
    return (
      base *
      zoomFontScale *
      overviewReadabilityBoost *
      growth *
      microLabelBoost *
      smallOrgCloseBoost *
      phoneSizeScale() *
      ORG_CONTENT_SCALE
    );
  }

  // ── Inside-label fit (the disclosure gate) ─────────────────────────────────
  // A bubble is shown ONLY when its short name fits legibly inside it. That makes
  // "every visible bubble is labeled and readable" a structural guarantee instead
  // of a best-effort label pass. computePlacements (which org earns a slot) and
  // redraw (drawing the label) both call these, so they agree exactly.

  // Smallest legible inside-label font in viewBox units for this org at zoom k.
  function insideLabelMinFont(o: Org, k: number, brandLen: number): number {
    const lp = labelPriority(o);
    const deepLabelT = smoothStep((k - 7) / 11);
    return (
      6 *
      (1 - 0.9 * deepLabelT) *
      (isMidwestOrg(o) ? 0.9 : 1) *
      (lp >= 88 ? 0.94 : lp >= 68 ? 0.97 : 1) *
      (brandLen <= 4 ? (compact ? 0.92 : 0.9) : !compact && brandLen <= 5 ? 0.96 : 1) *
      unitPerPx
    );
  }

  function insideLabelGlyphWidth(brandLen: number): number {
    // The map labels are bold, mostly-uppercase abbreviations. Their measured
    // width in the UI font averages about two-thirds of an em per character;
    // using a normal-body-text estimate here lets short labels visibly spill
    // beyond the rounded rectangle even though the disclosure gate says they fit.
    return brandLen > 5 ? 0.69 : 0.67;
  }

  // The inside-label font a bubble of radius r would use for its short name. The
  // font is now HEIGHT-driven only (capped to the bubble height); horizontal room
  // is no longer a constraint here because the rectangle WIDENS to fit the label
  // (see orgBubbleHalfExtents). brandLen is kept for call-site compatibility.
  function insideLabelFont(o: Org, k: number, r: number, _brandLen: number): number {
    return Math.min(labelFontPx(o, k) * unitPerPx, r * BUBBLE_HEIGHT_FACTOR * 1.2);
  }

  // THE disclosure gate: is o's short name legible inside its bubble at k? Width
  // is NOT a gate anymore — a wide label widens the rectangle, and whether the
  // widened rectangle can actually be placed without overlap is decided by the
  // capacity gate in computePlacements. Here we only reject when the label would
  // be smaller than the readable floor.
  function labelFitsInside(o: Org, k: number): boolean {
    if (o._frame === "terr") return true;
    const brand = tinyName(o);
    if (!brand) return false;
    const r = visualRadius(o, k);
    const font = insideLabelFont(o, k, r, brand.length);
    return font >= insideLabelMinFont(o, k, brand.length);
  }

  // White label ink with a length-aware dark halo — keeps long names readable
  // without a heavy outline that reads as black clutter over the map.
  function orgLabelInk(
    state: { text: string; font: number; inside: boolean },
    emphasis: "normal" | "hot" | "selected",
  ): { fill: string; stroke: string; strokeWidth: number } {
    const len = state.text.length;
    const scale = state.inside
      ? len > 13
        ? 0.32
        : len > 8
          ? 0.28
          : 0.24
      : len > 18
        ? 0.26
        : len > 12
          ? 0.23
          : len > 7
            ? 0.21
            : 0.19;
    const minPx = state.inside ? (compact ? 1.95 : 1.9) : compact ? 2.3 : 2.2;
    let strokeWidth = Math.max(minPx * unitPerPx, state.font * scale);
    if (state.inside && state.font < 8.5 * unitPerPx) strokeWidth *= 1.05;
    if (emphasis === "selected") strokeWidth *= 1.14;
    else if (emphasis === "hot") strokeWidth *= 1.08;
    const alpha =
      emphasis === "selected" ? 0.96 : emphasis === "hot" ? 0.92 : state.inside ? 0.84 : 0.88;
    return { fill: "#ffffff", stroke: `rgba(7, 17, 14, ${alpha})`, strokeWidth };
  }

  function placeLabelLimit(k: number): number {
    // Background city context. Desktop carries more of it for a higher-resolution
    // backdrop; city names still yield to NERC org labels/bubbles via blockers,
    // so they never crowd out the data. Mobile stays modest (small screen).
    // Caps are generous; the open-space test does the real limiting, so these only
    // bound the work, not the look. More city names fill the open gaps now.
    // Phones keep the overview calm — only a few big metros for orientation — and
    // admit more city context as the user zooms in (where there is room for it).
    if (compact) return k < 2.2 ? 5 : k < 5 ? 11 : 18;
    if (k < 1.8) return 40;
    if (k < 4.8) return 72;
    return 130;
  }

  function placeDotMinK(tier: number): number {
    return tier === 1 ? 0.72 : tier === 2 ? 1.4 : 2.6;
  }

  function placeLabelMinK(tier: number): number {
    // Tier-2 includes the isolated Mountain-West / Northern cities that fill the
    // big open gaps, so let them appear right from the national view.
    return tier === 1 ? 0.72 : tier === 2 ? 0.9 : 2.7;
  }

  function placeDotRadius(p: Place): number {
    return (p.tier === 1 ? 2.8 : p.tier === 2 ? 2.3 : 1.9) * unitPerPx;
  }

  // ── Standardized role/type SIZE TIER (1..6) ────────────────────────────────
  // The single source of truth for bubble HEIGHT. Two orgs in the same tier draw
  // at the same height at the same zoom; text length may widen them horizontally
  // but never changes their tier. Tier is role/type driven only — never ncr_id,
  // entity_name length, city, state, or geography.
  //   6 Headline grid operators / reliability bodies (ISO/RTO, NERC/REs, RC, federal)
  //   5 Grid authorities (BA, PC)
  //   4 Transmission / planning operators (TOP, TSP, TP)
  //   3 Major utilities / wires companies (TO+DP, TO+LSE, DP+LSE, IOU)
  //   2 Local utilities / supporting entities (DP-only, TO-only, muni/co-op, RP/RSG…)
  //   1 Market / generation / minor supplemental entities (PSE/merchant, GO/GOP)
  function sizeTier(o: Org): number {
    if (o._sizeTier != null) return o._sizeTier;
    let t: number;
    if (isDeferredMarketOrg(o)) {
      t = 1;
    } else {
      const roles = o.roles;
      const isIso =
        o.is_iso_rto || o.org_type === "ISO_RTO" || isIsoRtoOperator(o) || isMajorSystemOperator(o);
      const isReliabilityBody =
        RELIABILITY_ORG_NAME.test(o.entity_name) || REGIONAL_ENTITY_NAME.test(o.entity_name);
      const isFederal = o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name);
      // Only federal GRID AUTHORITIES (BPA/TVA/WAPA/SWPA/SEPA — they carry a BA/RC
      // role or substantial weight) earn the headline tier. A federal GENERATION
      // owner like the Army Corps districts or the Bureau of Reclamation registers
      // only GO/GOP/TO — functionally a generator, so it must be sized by its
      // roles (below) instead of outranking far larger multi-role utilities.
      const isFederalGridAuthority =
        isFederal && (roles.includes("BA") || roles.includes("RC") || (o.weight ?? 0) >= 18);
      if (isIso || isReliabilityBody || roles.includes("RC") || isFederalGridAuthority) {
        t = 6;
      } else if (roles.includes("BA") || roles.includes("PC")) {
        t = 5;
      } else if (roles.includes("TOP") || roles.includes("TSP") || roles.includes("TP")) {
        t = 4;
      } else if (
        (roles.includes("TO") && (roles.includes("DP") || roles.includes("LSE"))) ||
        (roles.includes("DP") && roles.includes("LSE")) ||
        o.org_type === "IOU"
      ) {
        t = 3;
      } else if (
        roles.includes("DP") ||
        roles.includes("TO") ||
        o.org_type === "municipal" ||
        o.org_type === "cooperative" ||
        hasAnyRole(o, SUPPORT_ROLES)
      ) {
        t = 2;
      } else {
        t = 1;
      }
    }
    return (o._sizeTier = t);
  }

  function sizeTierLabel(o: Org): string {
    if (isIsoRtoOperator(o)) return "ISO/RTO operator";
    if (RELIABILITY_ORG_NAME.test(o.entity_name) || REGIONAL_ENTITY_NAME.test(o.entity_name)) {
      return "Reliability organization";
    }
    if (o.org_type === "federal" || FEDERAL_NAME.test(o.entity_name)) return "Federal power authority";
    const strongestRole = primaryRoles(o)[0];
    if (strongestRole) return roleFullName(strongestRole);
    return typeLabel(o.org_type);
  }

  // Standardized full-zoom radius (CSS px) for a size tier. Monotonic, no
  // weight/priority continuous curve — equal tiers get equal radii. Lower tiers
  // are deliberately larger than the old curve so a promoted low-rank bubble is
  // still readable/clickable.
  function tierBaseRadiusPx(tier: number, isCompact: boolean, _isPhone: boolean): number {
    const desktop: Record<number, number> = { 6: 40, 5: 32, 4: 26, 3: 21, 2: 17, 1: 13 };
    const mobile: Record<number, number> = { 6: 22, 5: 19, 4: 16, 3: 13.5, 2: 11, 1: 9 };
    const table = isCompact ? mobile : desktop;
    return table[tier] ?? table[1];
  }

  function visualRadius(o: Org, k: number): number {
    // Height is standardized by size tier; zoom, compact/phone scaling, the
    // disclosure ramp, and readability floors are the only modifiers. No
    // weight/priority continuous boosts (those made equal-tier orgs differ).
    const tier = sizeTier(o);
    const tierT = (tier - 1) / 5; // 0 (tier 1) .. 1 (tier 6)
    const topTier = isTopTierOrg(o);
    const minPx = compact ? 4.4 : 6.2;
    // Standardized full-zoom target radius for this tier.
    const fullPx = tierBaseRadiusPx(tier, compact, phone);
    const zoomT = smoothStep((k - 0.72) / (compact ? 3.5 : 12));
    // Overview: shrink the largest tiers at the outermost bucket so more high-rank
    // authority orgs fit before smaller orgs enter on the next bucket; ramp back
    // to full as soon as the user zooms in.
    const outerTopScaleT = smoothStep((k - 0.75) / (compact ? 0.22 : 0.2));
    const topOverviewScale = compact ? 0.4 + 0.26 * outerTopScaleT : 0.4 + 0.48 * outerTopScaleT;
    const overviewScale = tier >= 5 ? topOverviewScale : compact ? 0.56 : 0.72;
    const basePx = fullPx * (overviewScale + (1 - overviewScale) * zoomT);
    // A tier-scaled deep-zoom lift so zooming all the way in grows the pills
    // noticeably larger — the user wants bigger pills at deep zoom. Still
    // tier-scaled so the tiers never fully converge to one size.
    const deepGrowPx = (compact ? 5.5 : 11) * smoothStep((k - 3) / 16) * (0.4 + 0.6 * tierT);
    const capPx = fullPx + deepGrowPx + (compact ? 3 : 4);
    // Deep-zoom readability floor: once zoomed right in, no visible bubble stays
    // tiny — every one reaches a legible floor (placement re-solves per bucket so
    // this never reintroduces overlap). Compact stays gentler so more pills fit
    // in the narrow phone band.
    const deepMinPx = (compact ? 7.8 : 12) * smoothStep((k - 6) / 14) * (0.55 + 0.45 * tierT);
    // Overview floor for AK/HI inset dots.
    const insetOverviewMinPx = isUsInsetOrg(o) ? (compact ? 6.4 : 7) * smoothStep((2.8 - k) / 2) : 0;
    const topTierOverviewMinPx =
      tier >= 6 ? (compact ? 10.5 : 13.5) * (1 - smoothStep((k - 1.25) / 2.75)) : 0;
    const postRevealT = postRevealBoostT(o, k);
    const postRevealPx =
      postRevealT *
      (isDeferredMarketOrg(o) ? (compact ? 12 : 15) : isTransmissionOwnerOnly(o) ? (compact ? 7 : 9) : 0);
    const microRevealMinPx =
      postRevealT * (isDeferredMarketOrg(o) ? (compact ? 9 : 11) : compact ? 6.5 : 7.5);
    const targetPx = Math.max(
      minPx,
      deepMinPx,
      insetOverviewMinPx,
      topTierOverviewMinPx,
      microRevealMinPx,
      Math.min(capPx, basePx + deepGrowPx + postRevealPx),
    );
    const discloseT = tier >= 6 || topTier ? 1 : bubbleDisclosureT(o, k);
    const scaledPx = (minPx + (targetPx - minPx) * discloseT) * phoneSizeScale() * ORG_CONTENT_SCALE;
    const overviewFloorPx = isHomeOverviewZoom(k) ? (compact ? 4.8 * phoneSizeScale() : 8.8) : 0;
    const outerCapPx =
      isHomeOverviewZoom(k) && isNationalFillOrg(o) ? (compact ? 12.2 : 16.2) : capPx;
    return (
      Math.min(MAX_RADIUS, Math.max(minPx, overviewFloorPx, Math.min(outerCapPx, scaledPx))) * unitPerPx
    );
  }

  // Puerto Rico / U.S. Virgin Islands inset dots are schematic (uniform, not
  // priority-based) so they fit the offshore cluster without dwarfing mainland orgs.
  function territoryBubbleRadiusPx(): number {
    return compact ? TERRITORY_BUBBLE_RADIUS_PX.compact : TERRITORY_BUBBLE_RADIUS_PX.desktop;
  }

  function territoryHitRadiusPx(): number {
    return compact ? TERRITORY_HIT_RADIUS_PX.compact : TERRITORY_HIT_RADIUS_PX.desktop;
  }

  function renderedRadius(o: Org, k: number): number {
    if (o._frame === "terr") return territoryBubbleRadiusPx() * unitPerPx;
    const fallback = !!o._renderFallback;
    const promoted = !!o._promoteBackground;
    // Memoize: visualRadius is heavy and called many times per org per frame.
    // The result only depends on (o, k, unitPerPx, compact); radiusGen folds in
    // the latter two, so panning (constant k) reuses the cached value.
    if (o._vrk === k && o._vrGen === radiusGen && o._vr != null && o._vrFallback === fallback && o._vrPromoted === promoted) {
      return o._vr;
    }
    const v = promoted
      ? promotedBackgroundRadius(o, k)
      : fallback
        ? (() => {
            const gwFade = isGiveWayDot(o) ? dotDisclosureT(k) * giveWayDotSizeScale() : 1;
            let r = fallbackTinyRadiusPx(k) * unitPerPx * ORG_CONTENT_SCALE * gwFade;
            // Compact give-way dots: floor the visible radius so early-fade dots
            // read as clickable specks, not sub-pixel noise (tap ring unchanged).
            if (isGiveWayDot(o) && compact && !promoted) {
              const minVis = 2.1 * unitPerPx * ORG_CONTENT_SCALE * dotDisclosureT(k);
              r = Math.max(r, minVis);
            }
            return r;
          })()
        : visualRadius(o, k);
    o._vr = v;
    o._vrk = k;
    o._vrGen = radiusGen;
    o._vrFallback = fallback;
    o._vrPromoted = promoted;
    return v;
  }

  function hitTargetRadius(o: Org, k: number): number {
    if (o._frame === "terr") return territoryHitRadiusPx() * unitPerPx;
    if (o._renderFallback) {
      const visual = bubblePackingRadius(renderedRadius(o, k));
      // Give-way dots get a slightly larger tap/hover ring so the tiny markers stay
      // easy to select; dot-vs-dot ties resolve by nearest centre (see
      // nearestOrgAtPointer), so the bigger ring never makes close dots ambiguous.
      const floor = isGiveWayDot(o)
        ? phone
          ? 22
          : compact
            ? 20
            : 15
        : compact
          ? 18
          : 12;
      return Math.max(visual + 2 * unitPerPx, floor * unitPerPx);
    }
    // Every shown bubble is fully placed, so tap targets track the visible radius
    // plus a small pad and a floor — no per-dot reveal strength to fold in. Uses
    // the org-aware packing radius so the hit ring covers the widened rectangle.
    const visual = orgPackingRadius(o, k);
    const priority = visualPriority(o);
    // Floors keep even modest mid-priority utilities (e.g. western irrigation /
    // municipal districts like TID, IID, LADWP) comfortably clickable when their
    // bubble is small at the overview.
    // Tap-target floors are kept independent of the (smaller) visual radius so a
    // tiny bubble still gets a comfortable hit ring. On narrow phones they are
    // scaled up further via phoneSizeScale so small orgs stay easy to select.
    const tapScale = phoneSizeScale();
    const overviewFloorPx = (compact
      ? priority < 30 ? 18 : 18.5
      : priority < 30 ? 12 : priority < 55 ? 12.5 : 13.5) * tapScale;
    const deepFloorPx = (compact
      ? priority < 30 ? 7.8 : 9
      : priority < 30 ? 2.8 : priority < 55 ? 3.4 : 4.4) * tapScale;
    const deepT = smoothStep((k - 10) / 18);
    const floorPx = Math.max(compact ? 18 : 12, overviewFloorPx + (deepFloorPx - overviewFloorPx) * deepT);
    const overviewPadPx = compact ? (priority < 30 ? 2.4 : 3.4) : priority < 30 ? 1 : priority < 55 ? 1.5 : 2.4;
    const deepPadPx = compact ? (priority < 30 ? 0.8 : 1.2) : priority < 30 ? 0.35 : priority < 55 ? 0.55 : 0.8;
    const padPx = overviewPadPx + (deepPadPx - overviewPadPx) * deepT;
    // Tie the hit ring to the rendered bubble: a proportional margin so large
    // circles get a proportionally larger tap target, while the absolute floor
    // keeps the smallest dots comfortably clickable. This keeps clickable areas
    // in sync as bubbles grow with zoom.
    // Hug the rendered pill a little tighter (was 0.05) so a big pill's hit ring
    // does not blanket the give-way dots packed around it — each dot keeps an
    // exclusive zone where only its own ring is under the pointer.
    const margin = Math.max(padPx * unitPerPx, visual * 0.035);
    let target = Math.max(visual + margin, floorPx * unitPerPx);
    // Low-priority orgs gain clickability as they promote through mid/deep zoom.
    const discloseT = bubbleDisclosureT(o, k);
    if (discloseT < 0.85 && visualPriority(o) < 45) {
      const promoteClickPx = (compact ? 9 : 7) * (1 - discloseT) * smoothStep((k - 1.5) / 3);
      target = Math.max(target, (floorPx + promoteClickPx) * unitPerPx);
    }
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

  function spiderFanScale(k: number): number {
    // Fan coincident HQ clusters apart through mid/regional zoom; placement and
    // render both use _rx/_ry so packed positions match what is drawn.
    return 1 - smoothStep((k - 0.85) / 9);
  }

  function placementOrigin(o: Org, bucket: number): { ox: number; oy: number } {
    const fan = spiderFanScale(bucket);
    return {
      ox: ((o._x as number) + (o._rx ?? 0) * fan) * bucket,
      oy: ((o._y as number) + (o._ry ?? 0) * fan) * bucket,
    };
  }

  function packGapPx(bucket: number): number {
    // The non-overlap solver was reserving a visible moat around every bubble:
    // reserveR adds half the gap and fits() adds the gap again. Keep just enough
    // clearance to avoid overlap, so bubbles pack edge-to-edge and more of them
    // fit while the field reads fuller.
    const overviewT = 1 - smoothStep((bucket - 0.9) / 3.2);
    const overviewPx = compact ? 0.22 : 0.32;
    const deepPx = compact ? 0.55 : 0.68;
    return (overviewPx + (deepPx - overviewPx) * (1 - overviewT)) * unitPerPx;
  }

  function declutterBucket(k: number): number {
    // Finer buckets so bubbles re-solve their positions more often as the zoom
    // changes (rule: allow repositioning as zoom changes), and so the placement
    // radius tracks the rendered radius closely (helps guarantee no overlap).
    if (k < 2.6) return Math.round(k * 4) / 4; // 0.25 steps
    if (k < 8) return Math.round(k * 2) / 2; // 0.5 steps
    return Math.round(k);
  }

  // 0 at national overview, 1 at deep zoom — gently shrinks the placement leash.
  function declutterZoomT(k: number): number {
    return smoothStep((k - 0.85) / 18);
  }

  function maxDeclutterOffset(k: number): number {
    // Substantial freedom at every zoom step; regional/deep buckets get an extra
    // local-fill allowance so eligible orgs can use nearby whitespace instead of
    // disappearing from roomy views.
    const t = declutterZoomT(k);
    const overviewPx = compact ? 58 : 84;
    const deepPx = compact ? 40 : 58;
    // Extra room to pull eligible-but-held-back orgs into nearby whitespace once
    // the user has zoomed into a region — more pills fill the deep view. Fades
    // out at very deep zoom so geography stays honest.
    const regionalFillPx =
      (compact ? 32 : 48) *
      smoothStep((k - 3.5) / 5.5) *
      (1 - smoothStep((k - 20) / 20));
    return (overviewPx + (deepPx - overviewPx) * t + regionalFillPx) * unitPerPx;
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
      const insetCluster = cluster.some(isUsInsetOrg);
      const midwestCluster = cluster.some(isMidwestOrg);
      const ringStep = insetCluster ? step * 1.42 : midwestCluster ? step * 1.22 : step * (spiderFanScale(transform.k) > 0.4 ? 1.38 : 1);
      cluster.forEach((o, i) => {
        const [rx, ry] = spiderOffset(i, cluster.length, ringStep);
        o._rx = rx;
        o._ry = ry;
      });
    }
  }

  // Horizontal padding (per side) reserved inside the rectangle so the inside
  // label never touches the rounded edge.
  function insideLabelPadX(): number {
    return (compact ? 5 : 6) * unitPerPx;
  }
  // SVG bold text renders a little wider than the canvas measurement; pad the
  // measured width so the label never spills.
  const INSIDE_LABEL_SAFETY = 1.12;

  // Per-org WIDTH multiple of the radius. Returns BUBBLE_WIDTH_FACTOR unless the
  // org's inside label needs more horizontal room, in which case it grows so the
  // measured label width + padding fits. Computed from the full-units rendered
  // radius (the same radius the label font is derived from), so the resulting
  // factor is scale-invariant: callers can apply it to a radius in any units.
  function orgWidthFactor(o: Org, k: number): number {
    const fallback = !!o._renderFallback;
    if (o._wfk === k && o._wfGen === radiusGen && o._wf != null && o._wfFallback === fallback) {
      return o._wf;
    }
    let factor = BUBBLE_WIDTH_FACTOR;
    const brand = o._frame === "terr" || fallback ? "" : tinyName(o);
    if (brand) {
      const rFull = renderedRadius(o, k);
      if (rFull > 0) {
        const font = insideLabelFont(o, k, rFull, brand.length);
        const text = displayMapLabel(o, brand);
        const needHw = (measuredTextWidth(text, font) * INSIDE_LABEL_SAFETY) / 2 + insideLabelPadX();
        factor = Math.max(BUBBLE_WIDTH_FACTOR, needHw / rFull);
      }
    }
    o._wf = factor;
    o._wfk = k;
    o._wfGen = radiusGen;
    o._wfFallback = fallback;
    return factor;
  }

  // The SINGLE SOURCE OF TRUTH for an org's rectangle extents. Height stays
  // tier-driven (BUBBLE_HEIGHT_FACTOR · r); width is whichever is larger of the
  // base width and the room the inside label needs.
  function orgBubbleHalfExtents(
    o: Org,
    k: number,
    r = renderedRadius(o, k),
  ): { hw: number; hh: number } {
    // Give-way / fallback dots are ACTUAL circles — equal half-extents and a
    // full-radius corner (see setOrgBoxSize) so they render round, not as pills.
    if (o._renderFallback) return { hw: r, hh: r };
    return { hw: r * orgWidthFactor(o, k), hh: r * BUBBLE_HEIGHT_FACTOR };
  }

  function orgBubbleContainsOffset(o: Org, k: number, dx: number, dy: number, r: number): boolean {
    const { hw, hh } = orgBubbleHalfExtents(o, k, r);
    return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
  }

  // The force solver is circular, so reserve the wider half-extent to preserve
  // the no-overlap invariant after circles become rounded rectangles. This
  // factor encloses the 44%-radius rounded corners without reserving a square's
  // full diagonal.
  function bubblePackingRadius(r: number): number {
    return r * BUBBLE_PACKING_FACTOR;
  }

  // Org-aware packing radius: a bounding circle big enough to reserve the WIDENED
  // rectangle (so wide labels reserve enough horizontal room in the capacity gate,
  // the force collide, hover targets, and the overlap backstop). Matches
  // bubblePackingRadius exactly for un-widened bubbles.
  function orgPackingRadius(o: Org, k: number, r = renderedRadius(o, k)): number {
    const { hw, hh } = orgBubbleHalfExtents(o, k, r);
    return Math.max(hw, hh) * (BUBBLE_PACKING_FACTOR / BUBBLE_WIDTH_FACTOR);
  }

  function setOrgBoxPosition(node: SVGRectElement, cx: number, cy: number): void {
    const w = Number(node.getAttribute("width") || 0);
    const h = Number(node.getAttribute("height") || 0);
    node.setAttribute("x", String(cx - w / 2));
    node.setAttribute("y", String(cy - h / 2));
  }

  // Preserve the current center while changing size so hover/zoom never makes a
  // rectangle jump. Position stays in x/y so the tour's CSS scale pulse composes
  // safely instead of replacing an SVG translate.
  function setOrgBoxSize(node: SVGRectElement, o: Org, k: number, r: number): void {
    const oldW = Number(node.getAttribute("width") || 0);
    const oldH = Number(node.getAttribute("height") || 0);
    const cx = Number(node.getAttribute("x") || 0) + oldW / 2;
    const cy = Number(node.getAttribute("y") || 0) + oldH / 2;
    const { hw, hh } = orgBubbleHalfExtents(o, k, r);
    const w = 2 * hw;
    const h = 2 * hh;
    node.setAttribute("x", String(cx - w / 2));
    node.setAttribute("y", String(cy - h / 2));
    node.setAttribute("width", String(w));
    node.setAttribute("height", String(h));
    // Fallback dots are perfect circles (rx = half the side); pills keep the 0.44
    // rounded-rectangle corner.
    node.setAttribute("rx", String(Math.min(w, h) * (o._renderFallback ? 0.5 : 0.44)));
  }

  // Half-extents (CSS px / viewBox units) of an org's invisible HIT target. The
  // tap/hover region tracks the VISIBLE shape: a tight rounded rectangle hugging
  // the pill (visible extents + the ring pad), not a bounding circle whose radius
  // would track the pill's half-WIDTH and balloon high above/below a wide pill —
  // swallowing clicks meant for the dots packed around it. Fallback / give-way
  // dots are real circles, so they keep the exact circular target as before.
  function hitHalfExtents(o: Org, k: number): { hw: number; hh: number } {
    const hitR = hitTargetRadius(o, k);
    if (o._renderFallback) return { hw: hitR, hh: hitR };
    const r = renderedRadius(o, k);
    const { hw, hh } = orgBubbleHalfExtents(o, k, r);
    // Pad beyond the visible rectangle, taken from the same circular hit radius so
    // the floors / zoom interpolation / micro+inset boosts all carry over unchanged.
    const pad = Math.max(0, hitR - orgPackingRadius(o, k, r));
    return { hw: hw + pad, hh: hh + pad };
  }

  /** True when (dx, dy) from org centre sits inside the padded hit target. */
  function orgHitContainsOffset(o: Org, k: number, dx: number, dy: number): boolean {
    if (o._renderFallback) {
      const hitR = hitTargetRadius(o, k);
      return dx * dx + dy * dy <= hitR * hitR;
    }
    const { hw, hh } = hitHalfExtents(o, k);
    return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
  }

  /** 0 at centre, 1 on the hit boundary — circular for dots, AABB-normalized for pills. */
  function orgHitNormDistance(o: Org, k: number, dx: number, dy: number): number {
    if (o._renderFallback) {
      const hitR = hitTargetRadius(o, k);
      return hitR > 0 ? (dx * dx + dy * dy) / (hitR * hitR) : Number.POSITIVE_INFINITY;
    }
    const { hw, hh } = hitHalfExtents(o, k);
    if (hw <= 0 || hh <= 0) return Number.POSITIVE_INFINITY;
    const nx = dx / hw;
    const ny = dy / hh;
    return nx * nx + ny * ny;
  }

  // Size an invisible hit RECT (center-preserving, like setOrgBoxSize). Sized in
  // transform space (÷ k) because the hit layer lives inside the zoomed group.
  function setHitBoxSize(node: SVGRectElement, o: Org, k: number): void {
    const oldW = Number(node.getAttribute("width") || 0);
    const oldH = Number(node.getAttribute("height") || 0);
    const cx = Number(node.getAttribute("x") || 0) + oldW / 2;
    const cy = Number(node.getAttribute("y") || 0) + oldH / 2;
    const safeK = Math.max(k, 0.001);
    const { hw, hh } = hitHalfExtents(o, k);
    const w = (2 * hw) / safeK;
    const h = (2 * hh) / safeK;
    node.setAttribute("x", String(cx - w / 2));
    node.setAttribute("y", String(cy - h / 2));
    node.setAttribute("width", String(w));
    node.setAttribute("height", String(h));
    node.setAttribute("rx", String(Math.min(w, h) * (o._renderFallback ? 0.5 : 0.44)));
  }

  // The real ISOs/RTOs (see ISO_RTO_OPERATOR_NAME) — these get the saber
  // outline and an explicit "ISO/RTO" note in their detail panel.
  function isIsoRtoOperator(o: Org): boolean {
    return ISO_RTO_OPERATOR_NAME.test(o.entity_name);
  }

  function isMisoControlArea(o: Org): boolean {
    return MISO_CONTROL_AREA_CODES.has(o.ncr_id);
  }
  function isNyisoTransmissionOwner(o: Org): boolean {
    return NYISO_TO_IDS.has(o.ncr_id);
  }
  function isIsoneTransmissionOwner(o: Org): boolean {
    return ISONE_PTO_IDS.has(o.ncr_id);
  }
  // True when `o` is a non-hub member of the given family (drives the membership
  // pill/badge). Uses each family's own predicate rather than marketFamily so a
  // dual-market utility (PJM zone AND MISO LBA) shows BOTH tags; the hub shows the
  // ISO/RTO badge instead, so it is excluded here.
  function isFamilyMemberOf(o: Org, id: MarketFamilyId): boolean {
    if (isMarketHub(o)) return false;
    switch (id) {
      case "PJM":
        return isPjmZone(o);
      case "MISO":
        return isMisoControlArea(o);
      case "NYISO":
        return isNyisoTransmissionOwner(o);
      case "ISONE":
        return isIsoneTransmissionOwner(o);
    }
  }

  // The market hubs that anchor a regional family (PJM, MISO, NYISO, ISO-NE).
  function isMarketHub(o: Org): boolean {
    return MARKET_HUB_IDS.has(o.ncr_id);
  }

  // Regional-family affiliation, the single source of truth for focus mode.
  // Derived ONLY from existing, curated membership metadata (PJM transmission-zone
  // codes via area_aliases; MISO LBA codes; NYISO/ISO-NE transmission-owner id
  // sets), plus the hubs themselves. An org with no clear membership stays neutral
  // (null) — we never force an org into a family.
  function marketFamily(o: Org): MarketFamilyId | null {
    if (o._mf !== undefined) return o._mf;
    let v: MarketFamilyId | null = null;
    if (o.ncr_id === PJM_HUB_ID || isPjmZone(o)) v = "PJM";
    else if (o.ncr_id === MISO_HUB_ID || isMisoControlArea(o)) v = "MISO";
    else if (o.ncr_id === NYISO_HUB_ID || isNyisoTransmissionOwner(o)) v = "NYISO";
    else if (o.ncr_id === ISONE_HUB_ID || isIsoneTransmissionOwner(o)) v = "ISONE";
    return (o._mf = v);
  }

  // ── Market focus mode ────────────────────────────────────────────────────────
  // Clicking a market hub (PJM, MISO, NYISO, ISO-NE) calms the map around that
  // choice: the hub becomes the brightest object, its members light up a beat later
  // as the pulse reaches them, and everything else greys out. The relationship is
  // read straight from the curated membership (marketFamily) — the hub plus its PJM
  // transmission zones / MISO LBAs / NYISO Transmission Owners / ISO-NE PTOs. The
  // focus surface is intentionally limited to these curated families.
  function isFocusParent(o: Org): boolean {
    return activeFocusGroup != null && isMarketHub(o) && marketFamily(o) === activeFocusGroup;
  }
  function isFocusRelated(o: Org): boolean {
    return activeFocusGroup != null && !isMarketHub(o) && marketFamily(o) === activeFocusGroup;
  }
  function isFocusMember(o: Org): boolean {
    return activeFocusGroup != null && marketFamily(o) === activeFocusGroup;
  }

  // When a PJM/MISO family is focused, subarea clicks still keep family focus
  // active, but the detail panel belongs to the clicked subarea.
  function panelOrgForSelection(o: Org): Org {
    return o;
  }

  // Give every related member a staggered animation delay so the orange pulse
  // visibly sweeps OUTWARD from the hub (nearer members light up first). Distance
  // is geographic (lat/lng) so the ordering is stable across pan/zoom; the parent
  // keeps delay 0 and always fires first.
  function assignFocusDelays(group: MarketFamilyId): void {
    const hub = orgById(MARKET_FAMILIES[group].hubId);
    const members = placeableOrgs.filter((o) => !isMarketHub(o) && marketFamily(o) === group);
    let maxD = 0;
    const hlat = hub?.lat ?? 0;
    const hlng = hub?.lng ?? 0;
    for (const o of members) {
      const d = hub ? Math.hypot((o.lat ?? hlat) - hlat, (o.lng ?? hlng) - hlng) : 0;
      o._focusDist = d;
      if (d > maxD) maxD = d;
    }
    const span = 0.85; // seconds the wave takes to reach the farthest member
    for (const o of members) {
      o._focusDelay = 0.12 + (maxD > 0 ? (o._focusDist ?? 0) / maxD : 0) * span;
    }
  }

  function showFocusStatus(group: MarketFamilyId): void {
    // Status chip is intentionally hidden. Focus still clears via background
    // click / Escape / selecting another org. (group kept for the API.)
    void group;
    focusStatus.hidden = true;
  }
  function hideFocusStatus(): void {
    focusStatus.hidden = true;
  }

  function setFocusGroup(group: MarketFamilyId): void {
    if (activeFocusGroup === group) return;
    // Switching straight from one family to the other (PJM ⇄ MISO): re-solve so the
    // previous family's screen-space nudges are dropped and nothing is left
    // displaced. Entering focus from the normal map does NOT invalidate — the
    // background packing is identical with or without focus (overlay sub-areas never
    // join it), so the gray background stays perfectly fixed when focus turns on.
    const switchingFamily = activeFocusGroup != null;
    activeFocusGroup = group;
    assignFocusDelays(group);
    showFocusStatus(group);
    if (switchingFamily) invalidateOrgLayout();
    raiseFocusMembers();
  }

  // Lift the whole focused family (bubbles, sabers, hit targets, labels) to the top
  // of their layers so a sub-area always paints ABOVE the grayed-out inactive map.
  function raiseFocusMembers(): void {
    if (activeFocusGroup == null) return;
    const inFamily = (d: Org) => marketFamily(d) === activeFocusGroup;
    gOverlay.selectAll<SVGRectElement, Org>("rect.org").filter(inFamily).raise();
    gSaber.selectAll<SVGRectElement, Org>("rect.org-saber").filter(inFamily).raise();
    gHit.selectAll<SVGRectElement, Org>("rect.org-hit").filter(inFamily).raise();
    gLabels.selectAll<SVGTextElement, Org>("text.olabel").filter(inFamily).raise();
  }

  function clearFocus(): boolean {
    if (activeFocusGroup == null) return false;
    activeFocusGroup = null;
    hideFocusStatus();
    // Re-solve so the family drops back to normal visibility/collision/opacity and
    // the rest of the map returns to its standard layout.
    invalidateOrgLayout();
    return true;
  }

  // Toggle the svg-root focus classes that drive the family dimming + parent/related
  // glows. Cheap; called from every redraw + applyHighlights. (There is no longer a
  // radiating ring overlay — the relationship reads from the glow alone.)
  function syncFocusState(): void {
    const on = activeFocusGroup != null;
    svg.classed("focus-mode", on);
    for (const id of MARKET_FAMILY_IDS) {
      svg.classed(MARKET_FAMILIES[id].focusClass, activeFocusGroup === id);
    }
  }


  // Keep each saber ring matched to its bubble: same center and rounded-rect
  // shape, sitting a hair outside the fill edge. Only a handful of always-visible
  // ISO/RTO bubbles carry one, so resyncing them all per zoom frame is cheap.
  // (Panning rides the group transform, so this only needs to track size/center
  // changes, which are driven by k.)
  const SABER_OUTSET = 1.6; // screen px the ring sits beyond the bubble edge
  function syncSabers(k = transform.k): void {
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    const out = SABER_OUTSET / k;
    gSaber.selectAll<SVGRectElement, Org>("rect.org-saber").each(function (o) {
      const node = this as SVGRectElement;
      // Defensive: never leave a ring floating without its bubble.
      node.classList.toggle("hide", o._vis === false);
      const cx = orgRenderX(o, fanScale, declScale);
      const cy = orgRenderY(o, fanScale, declScale);
      const { hw, hh } = orgBubbleHalfExtents(o, k, renderedRadius(o, k) / k);
      const w = 2 * hw + 2 * out;
      const h = 2 * hh + 2 * out;
      node.setAttribute("x", String(cx - w / 2));
      node.setAttribute("y", String(cy - h / 2));
      node.setAttribute("width", String(w));
      node.setAttribute("height", String(h));
      node.setAttribute("rx", String(Math.min(w, h) * 0.44));
    });
  }

  // RTO hub lookup (MISO, PJM, …) by ncr_id. Cached once the org payload loads.
  let orgByIdCache: Map<string, Org> | null = null;
  function orgById(id: string): Org | null {
    if (!orgByIdCache) orgByIdCache = new Map(orgs.map((o) => [o.ncr_id, o]));
    return orgByIdCache.get(id) ?? null;
  }
  function isPjmZone(o: Org): boolean {
    return o.area_aliases?.some((code) => PJM_TRANSMISSION_ZONE_CODES.has(code)) ?? false;
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
      .selectAll<SVGRectElement, Org>("rect.org")
      .each(function (o) {
        setOrgBoxPosition(
          this as SVGRectElement,
          orgRenderX(o, fanScale, declScale),
          orgRenderY(o, fanScale, declScale),
        );
      });
    gHit
      .selectAll<SVGRectElement, Org>("rect.org-hit")
      .each(function (o) {
        setOrgBoxPosition(
          this as SVGRectElement,
          orgRenderX(o, fanScale, declScale),
          orgRenderY(o, fanScale, declScale),
        );
      });
    syncSabers(k);
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
    gSaber.attr("transform", tStr);
    gHit.attr("transform", tStr);
  }

  function redrawWhileWheeling(): void {
    const k = transform.k;
    syncZoomGroups();
    positionOrgMarks(k);
    gOverlay.selectAll<SVGRectElement, Org>("rect.org").each(function (o) {
      const node = this as SVGRectElement;
      if (node.classList.contains("hide")) return;
      const rr = renderedRadius(o, k);
      if (o._rk !== k || o._rr !== rr) {
        setOrgBoxSize(node, o, k, rr / k);
        o._rk = k;
        o._rr = rr;
      }
    });
    gHit.selectAll<SVGRectElement, Org>("rect.org-hit").each(function (o) {
      const node = this as SVGRectElement;
      if (node.classList.contains("hide")) return;
      const hr = hitTargetRadius(o, k);
      if (hitK !== k || o._hr !== hr) {
        setHitBoxSize(node, o, k);
        o._hr = hr;
      }
    });
    hitK = k;
    // Keep the focus rings glued to the hub during the wheel gesture too (the full
    // redraw loop that normally re-centres them does not run while wheeling).
    syncFocusState();
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

  function nudgeSelectedOrgIntoView(duration = 300): void {
    if (centerSelection) return; // a focus-hub click is framing this pick itself
    if (!zoomBehavior || focusPanPending || tourRunning || userPanning || !selectedOrg) return;
    if (performance.now() - lastPanEndAt < 220) return; // don't yank right after a manual pan
    const k = transform.k;
    const focused = selectedOrg;
    if (focused._sx == null || focused._sy == null) return;
    const r = renderedRadius(focused, k);
    const sx = focused._sx;
    const sy = focused._sy;
    // 1) Comfortable framing margins so a pick near a corner/edge eases inward
    //    instead of hugging the rim.
    const mL = (compact ? 38 : 52) * unitPerPx + r;
    const mR = (compact ? 38 : 52) * unitPerPx + r;
    const mT = (compact ? 92 : 60) * unitPerPx + r;
    const mB = (compact ? 60 : 46) * unitPerPx + r;
    let dx = 0;
    let dy = 0;
    if (sx < mL) dx = mL - sx;
    else if (sx > W - mR) dx = (W - mR) - sx;
    if (sy < mT) dy = mT - sy;
    else if (sy > H - mB) dy = (H - mB) - sy;
    // 2) Lift the pick out from behind the detail card only when it would actually
    //    land under it (rect-aware: a bottom-left pick on desktop, where the card is
    //    bottom-right, is left alone). Clearing upward keeps the move small.
    const card = panelRectVB();
    if (card) {
      const padX = 8 * unitPerPx;
      const padY = (compact ? 10 : 12) * unitPerPx + r;
      const px = sx + dx;
      const py = sy + dy;
      if (px > card.left - padX && px < card.right + padX && py > card.top - padY) {
        dy += card.top - padY - py;
      }
    }
    // 3) Cap the move so a single selection never makes the map leap.
    const cap = H * (compact ? 0.46 : 0.5);
    dx = Math.max(-cap, Math.min(cap, dx));
    dy = Math.max(-cap, Math.min(cap, dy));
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
  // Projection and land masks.
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
    const territoryLane = SHOW_TERRITORIES ? territoryLayoutMetrics(compact, unitPerPx, W, H).laneW : 0;
    // With the territory lane reclaimed, keep a small ocean margin on each side of
    // the lower-48 (desktop) so the coastal water labels — Pacific / Atlantic —
    // have open sea to sit in and frame the map, instead of the coast jamming the
    // canvas edge. The phone already has ample ocean above/below its narrow band.
    const oceanInset = SHOW_TERRITORIES || compact ? 0 : 52 * unitPerPx;
    projection.fitExtent(
      [
        [fitPadX + oceanInset, fitPadY],
        [W - fitPadX - territoryLane - oceanInset, H - fitPadY],
      ],
      nationFeature as never,
    );
    // Lock the Canada conic onto the composite's lower-48 scale/translate.
    canadaProj.scale(projection.scale()).translate(projection.translate() as [number, number]);
    if (canadaFeature) gMap.select<SVGPathElement>("path.canada").attr("d", canadaPath(canadaFeature as never));
    gMap.selectAll<SVGPathElement, unknown>("path.state").attr("d", path as never);
    gMap.select<SVGPathElement>("path.nation").attr("d", path((nationOutline ?? nationFeature) as never));
    syncInsetBounds();
    buildLandMask();

    for (const o of orgs) {
      o._rk = undefined;
      o._dx = 0;
      o._dy = 0;
      if (o.out_of_footprint) {
        o._x = undefined;
        o._y = undefined;
        o._frame = TERRITORY_STATES.has(o.state ?? "") ? "terr" : undefined;
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

  // Rasterize a land silhouette into a coarse mask. Best-effort: null if no canvas.
  function rasterizeLandMask(
    draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
  ): Uint8Array | null {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    try {
      canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(maskW, maskH)
          : Object.assign(document.createElement("canvas"), { width: maskW, height: maskH });
    } catch {
      return null;
    }
    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return null;
    ctx.save();
    ctx.scale(1 / maskScale, 1 / maskScale);
    ctx.fillStyle = "#fff";
    draw(ctx);
    ctx.restore();
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, maskW, maskH).data;
    } catch {
      return null;
    }
    const mask = new Uint8Array(maskW * maskH);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 40 ? 1 : 0;
    return mask;
  }

  function syncInsetBounds(): void {
    akInsetBounds = null;
    hiInsetBounds = null;
    for (const f of stateFeatures) {
      const name = (f as { properties?: { name?: string } }).properties?.name;
      if (name !== "Alaska" && name !== "Hawaii") continue;
      const b = path.bounds(f as never) as [[number, number], [number, number]];
      if (name === "Alaska") akInsetBounds = b;
      else hiInsetBounds = b;
    }
  }

  function pointInInsetBounds(
    x: number,
    y: number,
    bounds: [[number, number], [number, number]] | null,
    pad = 0,
  ): boolean {
    if (!bounds) return false;
    return (
      x >= bounds[0][0] - pad &&
      x <= bounds[1][0] + pad &&
      y >= bounds[0][1] - pad &&
      y <= bounds[1][1] + pad
    );
  }

  function insetMainlandFencePad(): number {
    return INSET_MAINLAND_FENCE_PAD_PX * unitPerPx;
  }

  function pointInAnyInset(x: number, y: number, pad = 0): boolean {
    return (
      pointInInsetBounds(x, y, akInsetBounds, pad) || pointInInsetBounds(x, y, hiInsetBounds, pad)
    );
  }

  function placeInUsInsetViewBox(x: number, y: number): boolean {
    return pointInAnyInset(x, y);
  }

  function insetHomeForOrg(o: Org, x: number, y: number): boolean {
    if (o.state === "AK") return pointInInsetBounds(x, y, akInsetBounds);
    if (o.state === "HI") return pointInInsetBounds(x, y, hiInsetBounds);
    return false;
  }

  function buildLandMask(): void {
    landMask = null;
    usLandMask = null;
    caLandMask = null;
    if (!nationFeature) return;
    maskScale = 6;
    maskW = Math.max(1, Math.ceil(W / maskScale));
    maskH = Math.max(1, Math.ceil(H / maskScale));
    usLandMask = rasterizeLandMask((ctx) => {
      const p = geoPath(projection, ctx as CanvasRenderingContext2D);
      ctx.beginPath();
      p(nationFeature as never);
      ctx.fill();
    });
    if (canadaFeature) {
      caLandMask = rasterizeLandMask((ctx) => {
        const p = geoPath(canadaProj, ctx as CanvasRenderingContext2D);
        ctx.beginPath();
        p(canadaFeature as never);
        ctx.fill();
      });
      landMask = rasterizeLandMask((ctx) => {
        const pUs = geoPath(projection, ctx as CanvasRenderingContext2D);
        ctx.beginPath();
        pUs(nationFeature as never);
        ctx.fill();
        const pCa = geoPath(canadaProj, ctx as CanvasRenderingContext2D);
        ctx.beginPath();
        pCa(canadaFeature as never);
        ctx.fill();
      });
    } else {
      landMask = usLandMask;
    }
  }

  type LandFrame = "us" | "ca";

  function landMaskForFrame(frame: LandFrame | "terr" | undefined): Uint8Array | null {
    if (frame === "ca") return caLandMask ?? landMask;
    return usLandMask ?? landMask;
  }

  function orgLandFrame(o: Org, slotFrame?: LandFrame): LandFrame {
    if (slotFrame) return slotFrame;
    return o._frame === "ca" ? "ca" : "us";
  }

  // Frame-aware land query. lenientBorder=true keeps legacy audit behaviour at edges.
  function onLandForFrame(
    x: number,
    y: number,
    frame: LandFrame | "terr" | undefined,
    lenientBorder: boolean,
  ): boolean {
    if (frame === "terr") return true;
    const mask = landMaskForFrame(frame);
    if (!mask) return true;
    const mx = Math.floor(x / maskScale);
    const my = Math.floor(y / maskScale);
    if (mx < 0 || my < 0 || mx >= maskW || my >= maskH) return lenientBorder;
    return mask[my * maskW + mx] === 1;
  }

  // Validate a candidate bubble center in screen bucket space.
  function placementLandValid(
    cx: number,
    cy: number,
    r: number,
    bucket: number,
    frame: LandFrame | "terr",
    tiny: boolean,
    o?: Org,
  ): boolean {
    if (frame === "terr") return true;
    const bx = cx / bucket;
    const by = cy / bucket;
    if (o) {
      if (isUsInsetOrg(o)) {
        if (!insetHomeForOrg(o, bx, by)) return false;
      } else if (pointInAnyInset(bx, by, insetMainlandFencePad())) {
        return false;
      }
    }
    if (!onLandForFrame(bx, by, frame, false)) return false;
    if (tiny) return true;
    const rr = r / bucket;
    const cardinals: Array<[number, number]> = [
      [bx + rr * 0.75, by],
      [bx - rr * 0.75, by],
      [bx, by + rr * 0.75],
      [bx, by - rr * 0.75],
    ];
    for (const [x, y] of cardinals) {
      if (!onLandForFrame(x, y, frame, false)) return false;
    }
    if (rr > 8 * unitPerPx) {
      const rd = rr * 0.52;
      for (const [dx, dy] of [[rd, rd], [-rd, rd], [rd, -rd], [-rd, -rd]] as const) {
        if (!onLandForFrame(bx + dx, by + dy, frame, false)) return false;
      }
    }
    return true;
  }

  function bubbleScreenCenter(o: Org, bucket: number): { cx: number; cy: number } {
    const { ox, oy } = placementOrigin(o, bucket);
    return {
      cx: ox + (o._dx ?? 0),
      cy: oy + (o._dy ?? 0),
    };
  }

  // Mid-frame safety: a bubble placed at the zoom bucket is re-checked against the
  // land mask at the live zoom. If it can no longer sit legally, hide it rather
  // than show it unlabeled — placement re-solves on the next bucket change.
  // The PJM / NYISO / ISO-NE cluster is unavoidably tight in the Northeast. When
  // they crowd, spread them the way the user asked: lift NYISO and ISO-NE up,
  // give that pair a clean left/right gap, and drop PJM down below them. Runs
  // before the overlap guard so the rest of the field defers to these positions.
  function separateNeIsos(vis: Org[], k: number): void {
    let pjm: Org | undefined, ny: Org | undefined, ne: Org | undefined;
    for (const o of vis) {
      if (o.ncr_id === "NCR00879") pjm = o;
      else if (o.ncr_id === "NCR07160") ny = o;
      else if (o.ncr_id === "NCR07124") ne = o;
    }
    if (!ny || !ne || ny._sx == null || ny._sy == null || ne._sx == null || ne._sy == null) return;
    const half = (o: Org) => orgBubbleHalfExtents(o, k);
    const GAP = 6;
    const shift = (o: Org, dx: number, dy: number): void => {
      o._dx = (o._dx ?? 0) + dx;
      o._dy = (o._dy ?? 0) + dy;
      o._sx = (o._sx as number) + dx;
      o._sy = (o._sy as number) + dy;
    };

    // Give NYISO and ISO-NE a deterministic horizontal gap. Unlike the former
    // "close" test, this only changes offsets while the requested gap is absent,
    // so repeated animation redraws cannot walk the pair off the top of the map.
    const hny = half(ny), hne = half(ne);
    const nyLeftOfNe = (ny._sx as number) <= (ne._sx as number);
    const left = nyLeftOfNe ? ny : ne;
    const right = nyLeftOfNe ? ne : ny;
    const hLeft = nyLeftOfNe ? hny : hne;
    const hRight = nyLeftOfNe ? hne : hny;
    const horizontalNeed =
      hLeft.hw + hRight.hw + GAP - ((right._sx as number) - (left._sx as number));
    if (horizontalNeed > 0) {
      shift(left, -horizontalNeed / 2, 0);
      shift(right, horizontalNeed / 2, 0);
    }

    // When PJM crowds the pair, move NYISO and ISO-NE up a little and PJM down,
    // preserving geography while creating the requested vertical separation.
    if (pjm && pjm._sx != null && pjm._sy != null) {
      const hp = half(pjm);
      const pairLeft = Math.min((ny._sx as number) - hny.hw, (ne._sx as number) - hne.hw);
      const pairRight = Math.max((ny._sx as number) + hny.hw, (ne._sx as number) + hne.hw);
      const pjmLeft = (pjm._sx as number) - hp.hw;
      const pjmRight = (pjm._sx as number) + hp.hw;
      const overlapsHorizontally = pjmRight + GAP > pairLeft && pjmLeft - GAP < pairRight;
      const pairBottom = Math.max((ny._sy as number) + hny.hh, (ne._sy as number) + hne.hh);
      const pjmTop = (pjm._sy as number) - hp.hh;
      const verticalNeed = pairBottom + GAP - pjmTop;
      if (overlapsHorizontally && verticalNeed > 0) {
        const lift = verticalNeed * 0.4;
        shift(ny, 0, -lift);
        shift(ne, 0, -lift);
        shift(pjm, 0, verticalNeed - lift);
      }
    }
  }

  // Final render-time guarantee that no two bubble rectangles visibly overlap.
  // The capacity gate aims for this upstream, but co-located/duplicate records and
  // forced reveals can still collide; this is the backstop. Walk most-important
  // first (ISOs/RTOs, then visual rank), keep a screen-space grid of accepted
  // boxes, and hide any lower-priority bubble that would overlap one already kept.
  // ISOs/RTOs and the hovered/selected/tour focus are never hidden.
  function resolveBubbleOverlaps(cands: Org[], k: number): void {
    type BubbleBox = {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      cx: number;
      cy: number;
      coreX: number;
      coreY: number;
      corner: number;
    };
    const bubbleBox = (cx: number, cy: number, hw: number, hh: number): BubbleBox => {
      // SVG rounded rects are a core rectangle expanded by a circular corner.
      // Keeping that decomposition lets the backstop distinguish harmless
      // overlapping bounding-box corners from an actual painted intersection.
      const corner = Math.min(hw, hh) * 0.88;
      return {
        x0: cx - hw,
        y0: cy - hh,
        x1: cx + hw,
        y1: cy + hh,
        cx,
        cy,
        coreX: hw - corner,
        coreY: hh - corner,
        corner,
      };
    };
    const roundedBoxesOverlap = (a: BubbleBox, b: BubbleBox): boolean => {
      const dx = Math.max(0, Math.abs(a.cx - b.cx) - a.coreX - b.coreX);
      const dy = Math.max(0, Math.abs(a.cy - b.cy) - a.coreY - b.coreY);
      // A fractional-pixel buffer avoids anti-aliased edge blending while still
      // allowing rounded bounding-box corners to occupy the same empty space.
      return Math.hypot(dx, dy) < a.corner + b.corner + 0.35;
    };
    const order = [...cands].sort((a, b) => {
      const ia = isIsoRtoOperator(a) ? 0 : 1;
      const ib = isIsoRtoOperator(b) ? 0 : 1;
      return ia - ib || (a._visRank ?? 0) - (b._visRank ?? 0);
    });
    let maxExt = 8;
    for (const o of cands) {
      const { hw, hh } = orgBubbleHalfExtents(o, k);
      if (hw > maxExt) maxExt = hw;
      if (hh > maxExt) maxExt = hh;
    }
    const cell = 2 * maxExt + 4;
    // Two independent collision grids. `grid` is the normal map. `focusGrid` holds
    // only the selected PJM/MISO family: family members collide against each other
    // (so they never stack), but are invisible to `grid` — they may freely sit over
    // the grayed-out inactive bubbles as a priority overlay, and inactive bubbles
    // are likewise not dropped just because a family member lands on them.
    const grid = new Map<string, BubbleBox[]>();
    const focusGrid = new Map<string, BubbleBox[]>();
    const hits = (b: BubbleBox, g: Map<string, BubbleBox[]>): boolean => {
      const gx = Math.floor((b.x0 + b.x1) / 2 / cell);
      const gy = Math.floor((b.y0 + b.y1) / 2 / cell);
      for (let ix = -1; ix <= 1; ix++)
        for (let iy = -1; iy <= 1; iy++) {
          const arr = g.get(`${gx + ix}:${gy + iy}`);
          if (!arr) continue;
          for (const q of arr) {
            if (roundedBoxesOverlap(b, q)) return true;
          }
        }
      return false;
    };
    const keep = (b: BubbleBox, g: Map<string, BubbleBox[]>): void => {
      const key = `${Math.floor((b.x0 + b.x1) / 2 / cell)}:${Math.floor((b.y0 + b.y1) / 2 / cell)}`;
      const arr = g.get(key);
      if (arr) arr.push(b);
      else g.set(key, [b]);
    };
    // Sum the minimum-translation push that separates box b from every accepted
    // box it overlaps (push along the shallower axis, away from each neighbour).
    const pushOut = (b: BubbleBox, g: Map<string, BubbleBox[]>): { x: number; y: number } | null => {
      const gx = Math.floor((b.x0 + b.x1) / 2 / cell);
      const gy = Math.floor((b.y0 + b.y1) / 2 / cell);
      let px = 0, py = 0, any = false;
      for (let ix = -1; ix <= 1; ix++)
        for (let iy = -1; iy <= 1; iy++) {
          const arr = g.get(`${gx + ix}:${gy + iy}`);
          if (!arr) continue;
          for (const q of arr) {
            if (!roundedBoxesOverlap(b, q)) continue;
            const ox = Math.min(b.x1, q.x1) - Math.max(b.x0, q.x0);
            const oy = Math.min(b.y1, q.y1) - Math.max(b.y0, q.y0);
            any = true;
            const bcx = (b.x0 + b.x1) / 2, bcy = (b.y0 + b.y1) / 2;
            const qcx = (q.x0 + q.x1) / 2, qcy = (q.y0 + q.y1) / 2;
            if (ox < oy) px += (bcx >= qcx ? 1 : -1) * (ox + 3);
            else py += (bcy >= qcy ? 1 : -1) * (oy + 3);
          }
        }
      return any ? { x: px, y: py } : null;
    };
    for (const o of order) {
      if (o._sx == null || o._sy == null) continue;
      const focusMember = isFocusMember(o);
      // TWO COLLISION CLASSES in focus mode:
      //   • Focus family members pack ONLY against each other (focusGrid). They are
      //     invisible to — and never tested against — the gray background, so a
      //     sub-area may freely sit over inactive orgs and the background never moves
      //     or hides to make room for it.
      //   • Everyone else packs against the normal grid exactly as in normal mode;
      //     the focus overlay is not in that grid, so background↔background
      //     resolution is unchanged.
      const g = focusMember ? focusGrid : grid;
      const { hw, hh } = orgBubbleHalfExtents(o, k);
      let b = bubbleBox(o._sx, o._sy, hw, hh);
      // Headliners (real ISO/RTO incl. the focus hub) and the selected/hovered/tour
      // bubble are never dropped — they nudge as needed and always stay.
      const neverHide =
        isIsoRtoOperator(o) ||
        selectedOrg?.ncr_id === o.ncr_id ||
        hoverOrg?.ncr_id === o.ncr_id ||
        tourIds.has(o.ncr_id);
      if (hits(b, g)) {
        // An ordinary background bubble that overlaps a kept neighbour is dropped.
        if (!neverHide && !focusMember) {
          o._vis = false;
          continue;
        }
        // Nudge clear of already-kept neighbours in the SAME class. The screen shift
        // is folded into the declutter offset so the bubble, its hit target, and its
        // saber all render at the nudged spot.
        let sx = o._sx, sy = o._sy;
        // Family members get more iterations so a dense sub-area cluster (e.g. all
        // of PJM's zones) can fully separate; others keep the cheaper budget.
        const iters = focusMember ? 48 : 24;
        let separated = false;
        for (let iter = 0; iter < iters; iter++) {
          const push = pushOut(b, g);
          if (!push) {
            separated = true;
            break;
          }
          // Damp the step so two mutually-overlapping bubbles converge to a gap
          // instead of oscillating past each other in a tight cluster.
          sx += push.x * 0.6;
          sy += push.y * 0.6;
          b = bubbleBox(sx, sy, hw, hh);
        }
        // A focus sub-area that could not find a gap is hidden rather than left
        // stacked (lowest-priority first, since `order` is priority-sorted) — every
        // shown sub-area stays readable. Headliners hold their ground regardless.
        if (focusMember && !neverHide && !separated) {
          o._vis = false;
          continue;
        }
        o._dx = (o._dx ?? 0) + (sx - o._sx);
        o._dy = (o._dy ?? 0) + (sy - o._sy);
        o._sx = sx;
        o._sy = sy;
      }
      keep(b, g);
    }
  }

  // One-directional give-way for the GO/GOP dot layer. Each visible dot is nudged
  // to the NEAREST open spot that clears every nearby real bubble, within a short
  // leash; the bubbles themselves are obstacles only and are never moved. A dot
  // that is boxed in (no clear spot within the leash) gives way by hiding. Works
  // in the same zoomed-viewBox screen space as resolveBubbleOverlaps (_sx/_sy),
  // writing the result back into the dot's _dx/_dy render offset.
  function layoutDotGiveWay(dots: Org[], obstacles: Org[], k: number): void {
    if (!dots.length) return;
    const fanScale = spiderFanScale(k);
    const declScale = declutterScale(k);
    // Build a spatial grid of the real visible bubbles (their final positions).
    // Bubbles paint as wide rounded RECTANGLES, so model each as its half-extents
    // (hw, hh) and clear the dot from that box — a circle test would let a dot touch
    // a rect corner. maxExt sizes the grid cells / neighbour search.
    type Ob = { x: number; y: number; hw: number; hh: number };
    let maxExt = 4 * unitPerPx;
    const obs: Ob[] = [];
    for (const o of obstacles) {
      if (o._sx == null || o._sy == null) continue;
      const { hw, hh } = orgBubbleHalfExtents(o, k);
      obs.push({ x: o._sx, y: o._sy, hw, hh });
      if (hw > maxExt) maxExt = hw;
      if (hh > maxExt) maxExt = hh;
    }
    const cell = 2 * maxExt + 4 * unitPerPx;
    const grid = new Map<string, Ob[]>();
    for (const o of obs) {
      const key = Math.floor(o.x / cell) + ":" + Math.floor(o.y / cell);
      const arr = grid.get(key);
      if (arr) arr.push(o);
      else grid.set(key, [o]);
    }
    const clears = (x: number, y: number, rd: number): boolean => {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      for (let ix = -1; ix <= 1; ix++)
        for (let iy = -1; iy <= 1; iy++) {
          const arr = grid.get(gx + ix + ":" + (gy + iy));
          if (!arr) continue;
          for (const o of arr) {
            if (Math.abs(o.x - x) < o.hw + rd && Math.abs(o.y - y) < o.hh + rd) return false;
          }
        }
      return true;
    };
    // Second grid of already-placed DOTS so each new dot also gives way to its peers
    // (the cluster spreads out instead of stacking). Cheap: a few hundred dots max.
    type Dot = { x: number; y: number; r: number };
    const dotCell = Math.max(cell, 12 * unitPerPx);
    const dotGrid = new Map<string, Dot[]>();
    const dotGap = GIVE_WAY_DOT_DOT_GAP_PX * unitPerPx;
    const addDot = (x: number, y: number, r: number) => {
      const key = Math.floor(x / dotCell) + ":" + Math.floor(y / dotCell);
      const arr = dotGrid.get(key);
      if (arr) arr.push({ x, y, r });
      else dotGrid.set(key, [{ x, y, r }]);
    };
    const clearsDots = (x: number, y: number, r: number): boolean => {
      const gx = Math.floor(x / dotCell);
      const gy = Math.floor(y / dotCell);
      for (let ix = -1; ix <= 1; ix++)
        for (let iy = -1; iy <= 1; iy++) {
          const arr = dotGrid.get(gx + ix + ":" + (gy + iy));
          if (!arr) continue;
          for (const o of arr) {
            const min = o.r + r + dotGap;
            const dx = o.x - x, dy = o.y - y;
            if (dx * dx + dy * dy < min * min) return false;
          }
        }
      return true;
    };
    const orgGap = GIVE_WAY_DOT_ORG_GAP_PX * unitPerPx;
    const step = 2 * unitPerPx;
    // Leash scales with the biggest nearby bubble so a dot can escape even a large
    // deep-zoom rectangle, with a comfortable floor for the common regional case.
    // Compact leash is shorter than desktop but roomy enough that dots find open
    // slots instead of hiding — raised from 40 so phone maps show more dots at the
    // same early reveal-K without enlarging the drawn specks.
    const leash = Math.max((compact ? 48 : 56) * unitPerPx, maxExt + (compact ? 22 : 26) * unitPerPx);
    for (const d of dots) {
      // Remember last frame's offset BEFORE resetting — used for hysteresis so the
      // dot keeps its previous slot instead of hopping to an equivalent one.
      const prevDx = d._dx ?? 0;
      const prevDy = d._dy ?? 0;
      d._dx = 0;
      d._dy = 0;
      const hx = transform.applyX(orgRenderX(d, fanScale, declScale));
      const hy = transform.applyY(orgRenderY(d, fanScale, declScale));
      d._sx = hx;
      d._sy = hy;
      const dotR = renderedRadius(d, k);
      // A hovered/selected/toured dot is promoted to the front — it leads the
      // interaction, so it stays put rather than dodging out from under the cursor.
      if (d._promoteBackground) {
        addDot(hx, hy, dotR);
        continue;
      }
      // A dot in the OCEAN never makes sense — convert a screen candidate back to
      // base/projection space and require it sit on the dot's land silhouette.
      const frame = orgLandFrame(d);
      const onLand = (x: number, y: number) =>
        onLandForFrame(transform.invertX(x), transform.invertY(y), frame, false);
      // Clearance a candidate spot must satisfy: ON LAND, outside every bubble by
      // orgGap, and clear of every dot already placed this frame by dotGap.
      const rdOrg = dotR + orgGap;
      const ok = (x: number, y: number) =>
        onLand(x, y) && clears(x, y, rdOrg) && clearsDots(x, y, dotR);
      const apply = (cx: number, cy: number) => {
        d._dx = cx - hx;
        d._dy = cy - hy;
        d._sx = cx;
        d._sy = cy;
        addDot(cx, cy, dotR);
      };
      // 1) Home is the true location — snap back whenever it is clear and on land.
      if (ok(hx, hy)) {
        addDot(hx, hy, dotR);
        continue;
      }
      // 2) HYSTERESIS — keep last frame's slot if it is still valid. This is what
      // stops the dots jumping/flickering between equivalent slots as the bubbles
      // jiggle while the force sim settles.
      if ((prevDx || prevDy) && ok(hx + prevDx, hy + prevDy)) {
        apply(hx + prevDx, hy + prevDy);
        continue;
      }
      // 3) Ring-search outward for the nearest clear, on-land slot. Bias the angular
      // scan toward last frame's direction so the new slot stays close to the old
      // one (smaller, smoother moves) instead of snapping to a far equivalent.
      const prevAng = prevDx || prevDy ? Math.atan2(prevDy, prevDx) : 0;
      let placed = false;
      for (let rad = step; rad <= leash && !placed; rad += step) {
        const cnt = Math.max(8, Math.round((2 * Math.PI * rad) / step));
        for (let i = 0; i < cnt; i++) {
          // 0, -1, +1, -2, +2 … steps out from prevAng so near-previous angles win.
          const off = ((i + 1) >> 1) * (i % 2 === 0 ? 1 : -1);
          const ang = prevAng + (off / cnt) * 2 * Math.PI;
          const cx = hx + Math.cos(ang) * rad;
          const cy = hy + Math.sin(ang) * rad;
          if (!ok(cx, cy)) continue;
          apply(cx, cy);
          placed = true;
          break;
        }
      }
      // Boxed in by larger neighbours: give way by hiding rather than overlapping.
      if (!placed) d._vis = false;
    }
  }

  function guardVisiblePlacement(o: Org, k: number, forced: boolean): void {
    if (forced || o._frame === "terr" || !o._placed || isTopTierOrg(o) || isIsoRtoOperator(o)) return;
    const bucket = declutterBucket(k);
    const frame = orgLandFrame(o);
    const r = orgPackingRadius(o, k);
    const { cx, cy } = bubbleScreenCenter(o, bucket);
    if (placementLandValid(cx, cy, r, bucket, frame, false, o)) return;
    o._placed = false;
    o.placementMode = undefined;
    o._vis = false;
  }

  // Positional-force strength: how firmly a bubble is pulled back to its true
  // projected location. Big/important orgs hold their geography tightly; small
  // orgs get a slack leash so they drift to fill open space and weave around the
  // larger bubbles that overshadow their spot (the "more freedom for small orgs"
  // rule, now continuous instead of a discrete ring leash).
  function orgAnchorStrength(o: Org): number {
    // Pull toward the space-filling target slot. Firm enough to hold the filled
    // layout steady (collide handles separation); big orgs hold a touch firmer.
    if (isTopTierOrg(o)) return 0.5;
    const bigT = Math.max(
      smoothStep((visualPriority(o) - 12) / 72),
      smoothStep(((o.weight ?? 0) - 6) / 38),
    );
    return 0.32 + 0.16 * bigT;
  }

  // Bubble layout is a LIVE, BOUNDED force simulation. Disclosed bubbles (those
  // that pass the label-fit gate) become nodes packed in screen-at-bucket space:
  //   • forceCollide spreads them so they fill the open space and never overlap;
  //   • a size-scaled positional force anchors each near its true location.
  // The sim ticks (animating) only while warm and is reheated when the zoom
  // bucket changes — so PANNING never moves a bubble (the group transform does
  // that), but ZOOMING makes the whole field flow and re-settle. Each tick caps
  // wander distance and clamps to the correct land silhouette. _x/_y stay the
  // true projected coordinates; _dx/_dy are the live offset (÷k at render).
  function computePlacements(k = transform.k, force = false): void {
    const bucket = declutterBucket(k);
    if (!force && bucket === orgLayoutBucket) return;
    orgLayoutBucket = bucket;

    const gap = packGapPx(bucket);
    const capBase = maxDeclutterOffset(bucket);
    // Reserve each bubble at the LARGEST radius it reaches within this zoom
    // bucket (its upper edge), so a bubble drawn at the live k — which can sit
    // above the bucket value — is never larger than its reserved slot. Without
    // this, big bubbles drawn mid-bucket overlap their neighbours. Find the exact
    // ceiling: the largest k that still maps to this bucket.
    let bucketTop = bucket;
    while (declutterBucket(bucketTop + 0.02) === bucket) bucketTop += 0.02;
    const reserveR = (o: Org): number =>
      orgPackingRadius(o, bucketTop) + gap * 0.5;

    // Gather orgs eligible at this zoom (label fits inside), most-important first.
    const eligible: Org[] = [];
    for (const o of orgs) {
      o.placementMode = undefined;
      o._renderFallback = false;
      // Territory inset dots are positioned by layoutTerritoryInsets and always
      // shown — they don't take part in the mainland force packing.
      if (o._frame === "terr") {
        o._placed = true;
        o.placementMode = "bubble";
        continue;
      }
      // Use the BASE rule (not the focus-widened one): focus overlay sub-areas must
      // stay out of the force sim so they never displace the static gray background.
      // They are still forced visible in redraw and separated only against their own
      // family in resolveBubbleOverlaps.
      if (
        o._x == null ||
        o._y == null ||
        !canDisplayOrgBase(o, bucket) ||
        !labelFitsInside(o, bucket)
      ) {
        o._placed = false;
        o._dx = 0;
        o._dy = 0;
        continue;
      }
      eligible.push(o);
    }
    const baseSort =
      (isNationalFillZoom(bucket) || bucket <= 1.5)
        ? outerOverviewPlacementSort
        : (a: Org, b: Org) => (a._visRank ?? 0) - (b._visRank ?? 0);
    // The real ISOs/RTOs are the headline orgs — admit them to the capacity gate
    // first so they always claim their home slot (otherwise a denser neighbour can
    // crowd one out, as happened to MISO near Indianapolis).
    eligible.sort((a, b) => {
      const ia = isIsoRtoOperator(a) ? 0 : 1;
      const ib = isIsoRtoOperator(b) ? 0 : 1;
      return ia - ib || baseSort(a, b);
    });

    // CAPACITY GATE: a spatial grid greedily admits each eligible org (highest
    // priority first) only if a non-overlapping, on-land slot exists near its true
    // location; the rest are held back. This bounds the count to what actually
    // fits, so the force sim below can lay the admitted set out WITHOUT overlap
    // even on a small screen (otherwise everything would show and overlap). It
    // also gives a good non-overlapping seed position for newly-shown bubbles.
    const maxR = eligible.reduce((m, o) => Math.max(m, reserveR(o)), 4 * unitPerPx);
    const cell = 2 * maxR + 2 * unitPerPx;
    const grid = new Map<string, Array<{ x: number; y: number; r: number }>>();
    const fits = (cx: number, cy: number, r: number): boolean => {
      const gx = Math.floor(cx / cell);
      const gy = Math.floor(cy / cell);
      for (let ix = -1; ix <= 1; ix++)
        for (let iy = -1; iy <= 1; iy++) {
          const arr = grid.get(gx + ix + ":" + (gy + iy));
          if (!arr) continue;
          for (const p of arr) {
            const ddx = p.x - cx;
            // Stretch y to match the elliptical bubble slot: rows pack closer than
            // columns, mirroring forceCollideAniso so the gate and the sim agree.
            const ddy = (p.y - cy) * BUBBLE_PACK_Y_STRETCH;
            const min = p.r + r + gap;
            if (ddx * ddx + ddy * ddy < min * min) return false;
          }
        }
      return true;
    };
    const claim = (cx: number, cy: number, r: number): void => {
      const key = Math.floor(cx / cell) + ":" + Math.floor(cy / cell);
      const arr = grid.get(key);
      if (arr) arr.push({ x: cx, y: cy, r });
      else grid.set(key, [{ x: cx, y: cy, r }]);
    };

    const step = Math.max(2 * unitPerPx, capBase / 12);
    const prevById = new Map(simNodes.map((n) => [n.o.ncr_id, n]));
    const nodes: SimNode[] = [];
    for (const o of eligible) {
      const { ox, oy } = placementOrigin(o, bucket);
      const frame = orgLandFrame(o);
      const r = reserveR(o);
      const anchor = orgAnchorStrength(o);
      // GEOGRAPHIC LEASH: a bubble may shift only a small multiple of its OWN
      // radius from home — just enough to dodge its neighbours, never to teleport
      // across the map to backfill an empty region. If no near-home slot is free
      // the org is HELD BACK (not flung away) and revealed later: zooming in spreads
      // the neighbourhood apart (screen-at-bucket positions scale with the zoom
      // bucket while radii saturate), opening a near-home slot so the org appears
      // where it truly is. Small/low-rank orgs get a little more room to weave
      // around the big anchors overshadowing their spot; top-tier anchors barely
      // move and hold the geography. (Was a wide capBase·reach search that filled
      // gaps by displacing orgs hundreds of map-miles — the user: "not at the
      // expense of moving an organization 500 miles away".)
      const bigT = Math.max(
        smoothStep((visualPriority(o) - 12) / 72),
        smoothStep(((o.weight ?? 0) - 6) / 38),
      );
      // Compact keeps a tighter leash: a phone squeezes the whole US into a narrow
      // band, so a bubble's radius is a big fraction of the screen and the same
      // radius-multiple would shove it much farther in real geography.
      const outerMajor = isOuterOverviewZoom(bucket) && isOuterOverviewMajor(o);
      const regionalLeashT = smoothStep((bucket - 3.5) / 5.5);
      const leashR = isIsoRtoOperator(o)
        ? // ISOs/RTOs must always be shown AND never overlap, so give them enough
          // room to slide apart when two sit close (e.g. NYISO and ISO-NE).
          (compact ? 2.4 : 3.0)
        : outerMajor
          ? isTopTierOrg(o)
            ? (compact ? 0.85 : 1.2)
            : (compact ? 1.45 : 2.0)
          : isTopTierOrg(o)
            ? (compact ? 0.6 : 0.8)
            : (compact ? 1.1 : 1.7) +
              (compact ? 1.25 : 2.25) * (1 - bigT) +
              (compact ? 1.05 : 1.4) * regionalLeashT * (1 - 0.45 * bigT);
      const leash = Math.min(capBase, r * leashR);
      // Ring-search outward from home for the NEAREST non-overlapping on-land slot
      // within the leash; admit the org there and anchor the sim to that slot.
      // Nearest-first keeps each bubble as close to its true location as possible.
      let slotX = ox;
      let slotY = oy;
      let placed = false;
      for (let rad = 0; rad <= leash && !placed; rad += step) {
        const cnt = rad < step ? 1 : Math.max(6, Math.round((2 * Math.PI * rad) / step));
        for (let i = 0; i < cnt; i++) {
          const ang = (i / cnt) * 2 * Math.PI + (Math.round(rad / step) % 2) * (Math.PI / cnt);
          const cx = ox + Math.cos(ang) * rad;
          const cy = oy + Math.sin(ang) * rad;
          if (!placementLandValid(cx, cy, r, bucket, frame, false, o)) continue;
          if (!fits(cx, cy, r)) continue;
          claim(cx, cy, r);
          slotX = cx;
          slotY = cy;
          placed = true;
          break;
        }
      }
      if (!placed) {
        o._placed = false;
        o._dx = 0;
        o._dy = 0;
        continue;
      }
      o._placed = true;
      o.placementMode = "bubble";
      const prev = prevById.get(o.ncr_id);
      // Continuing bubbles flow from where they are now into their new slot (smooth
      // zoom motion); newly-shown bubbles appear at their slot and settle. A tiny
      // deterministic nudge breaks exact ties so coincident bubbles can separate.
      nodes.push({
        o,
        hx: ox,
        hy: oy,
        tx: slotX,
        ty: slotY,
        r,
        anchor,
        cap: capBase * 1.3,
        frame,
        x: prev ? ox + (o._dx ?? 0) : slotX + (Math.cos(o._visRank ?? 0) * r) / 8,
        y: prev ? oy + (o._dy ?? 0) : slotY + (Math.sin(o._visRank ?? 0) * r) / 8,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
      });
    }

    simNodes = nodes;
    simBucket = bucket;
    if (!nodes.length) {
      orgSim?.stop();
      return;
    }

    if (!orgSim) {
      orgSim = forceSimulation<SimNode>()
        // Some momentum so bubbles glide into place (the "cool to navigate" feel),
        // but enough damping that they settle onto the filled slots quickly.
        .velocityDecay(0.5)
        .alphaMin(0.02)
        .on("tick", onSimTick);
      orgSim.stop();
    }
    orgSim.nodes(nodes);
    // Collide (full strength) guarantees no overlap; the positional force pulls
    // each bubble to its space-filling target slot. Both agree (the slot is
    // non-overlapping), so the field settles filled AND clean.
    orgSim.force("collide", forceCollideAniso<SimNode>((n) => n.r, BUBBLE_PACK_Y_STRETCH, 5, 1));
    orgSim.force("x", forceX<SimNode>((n) => n.tx).strength((n) => n.anchor));
    orgSim.force("y", forceY<SimNode>((n) => n.ty).strength((n) => n.anchor));
    // Reheat with energy then settle snappily (~1.1s) onto the filled slot layout
    // — fast enough to feel responsive while zooming, slow enough to read as flow.
    orgSim.alphaDecay(0.05).alpha(0.95).restart();
  }

  // Sim tick: cap each node's wander from its target slot, keep it on the correct
  // land mass, publish the offset as _dx/_dy, and request a redraw to animate.
  function onSimTick(): void {
    const bucket = simBucket;
    for (const n of simNodes) {
      // Cap wander from the target slot (hard, but rare — a runaway backstop).
      const dx = n.x - n.tx;
      const dy = n.y - n.ty;
      const off = Math.hypot(dx, dy);
      if (off > n.cap) {
        const s = n.cap / off;
        n.x = n.tx + dx * s;
        n.y = n.ty + dy * s;
        n.vx *= 0.5;
        n.vy *= 0.5;
      }
      // Soft land-keep: the target slot is on-land and the anchor holds bubbles
      // near it, so if collide nudges one offshore just steer its velocity back
      // toward the slot — a gentle pull, NOT a hard reposition (hard-resetting the
      // position each tick fought collide and reintroduced overlap at crowded
      // coastlines). Coastal bubbles may sit slightly offshore; that's fine.
      if (!onLandForFrame(n.x / bucket, n.y / bucket, n.frame, true)) {
        n.vx += (n.tx - n.x) * 0.18;
        n.vy += (n.ty - n.y) * 0.18;
      } else if (
        (isUsInsetOrg(n.o) && !insetHomeForOrg(n.o, n.x / bucket, n.y / bucket)) ||
        (!isUsInsetOrg(n.o) && pointInAnyInset(n.x / bucket, n.y / bucket, insetMainlandFencePad()))
      ) {
        n.vx += (n.tx - n.x) * 0.34;
        n.vy += (n.ty - n.y) * 0.34;
      }
      n.o._dx = n.x - n.hx;
      n.o._dy = n.y - n.hy;
    }
    scheduleRedraw();
  }

  // U.S. state + Canadian province name anchors (base coordinates), drawn faintly
  // as background context with NERC labels always taking precedence.
  function computeLandLabels(): void {
    landLabels = [];
    for (const f of stateFeatures) {
      const name = (f as { properties?: { name?: string } }).properties?.name;
      if (!name) continue;
      const anchor = INSET_STATE_LABEL_LNG_LAT[name];
      const c = anchor
        ? projection(anchor)
        : path.centroid(f as never);
      if (!c || Number.isNaN(c[0]) || Number.isNaN(c[1])) continue;
      landLabels.push({ name, x: c[0], y: c[1], small: SMALL_STATES.has(name), kind: "state" });
    }
    for (const w of WATER_LABELS) {
      const xy = projection([w.lng, w.lat]);
      if (!xy || Number.isNaN(xy[0]) || Number.isNaN(xy[1])) continue;
      landLabels.push({ name: w.name, x: xy[0], y: xy[1], small: false, kind: "water", interior: w.interior });
    }
    for (const p of PROVINCE_LABELS) {
      const xy = canadaProj([p.lng, p.lat]);
      if (!xy) continue;
      landLabels.push({ name: p.name, x: xy[0], y: xy[1], small: false, kind: "province" });
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
    // The give-way dot layer, kept separate from visibleOrgs so it never enters the
    // bubble overlap/declutter passes (zero impact on real-org layout).
    const dotOrgs: Org[] = [];
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
      // GIVE-WAY DOT LAYER. GO/GOP-only generators are never placed (canDisplayOrgBase
      // returns false for them), so they are handled here as a subordinate dot layer.
      // Crucially they are collected into dotOrgs, NOT visibleOrgs — so they never
      // enter separateNeIsos/resolveBubbleOverlaps and can never move or hide a real
      // bubble. They reuse the fallbackTiny dot rendering and are nudged clear of the
      // real bubbles afterwards by layoutDotGiveWay. Visible once zoomed into a region
      // (>= reveal-K), or any time the dot is hovered/selected. The role tour does
      // NOT force them: its GO/GOP steps would otherwise reveal ~1,500 dots at the
      // overview, contradicting the zoom-gated reveal — so the tour is left unchanged.
      if (isGiveWayDot(o)) {
        const forcedDot =
          hot?.ncr_id === o.ncr_id ||
          selectedOrg?.ncr_id === o.ncr_id;
        const dotVis = onScreen && (forcedDot || k >= giveWayDotRevealK());
        o._placed = false;
        o.placementMode = dotVis ? "fallbackTiny" : undefined;
        o._renderFallback = dotVis && !forcedDot;
        o._promoteBackground = isBackgroundPromoted(o, forcedDot);
        o._vis = dotVis;
        if (dotVis) dotOrgs.push(o);
        continue;
      }
      // Disclosure is zoom-only: a dot shows once it found a non-overlapping spot
      // at this zoom bucket (computePlacements sets _placed), or as a fallback
      // tiny dot when placement failed. Panning never changes the set.
      const displayable = canDisplayOrg(o, k);
      const due = displayable && (o._frame === "terr" || o._placed === true);
      // ISOs/RTOs are always shown when on screen, even if the capacity gate held
      // their slot back — they are the headline orgs the map must never drop.
      const forced =
        displayable &&
        (isIsoRtoOperator(o) ||
          hot?.ncr_id === o.ncr_id ||
          selectedOrg?.ncr_id === o.ncr_id ||
          tourIds.has(o.ncr_id) ||
          // Focus mode: every member of the focused PJM/MISO family is forced
          // visible (and rendered above the muted background, see the raise pass
          // below) even if the current zoom would normally hold it back.
          isFocusMember(o));
      o._promoteBackground = isBackgroundPromoted(o, forced);
      const vis = onScreen && (due || forced);
      o._vis = vis;
      if (!vis) continue;
      guardVisiblePlacement(o, k, forced);
      if (!o._vis) continue;
      visibleOrgs.push(o);
    }

    // Spread the tight Northeast ISO cluster first, then run the overlap guard so
    // the rest of the field defers to those positions.
    separateNeIsos(visibleOrgs, k);
    // Backstop: drop any bubble that would still visibly overlap a more important
    // one, so the rendered field never shows two rectangles on top of each other.
    resolveBubbleOverlaps(visibleOrgs, k);
    for (let i = visibleOrgs.length - 1; i >= 0; i--) {
      if (!visibleOrgs[i]._vis) visibleOrgs.splice(i, 1);
    }
    shownCount = visibleOrgs.length;

    for (const o of visibleOrgs) {
      const isTerr = o._frame === "terr";
      const forced = isLabelForced(o, tourActive, hot);
      if (tourActive) {
        // During a walkthrough step only the highlighted set gets labels.
        if (forced && (!isTerr || hot?.ncr_id === o.ncr_id)) candidates.push(o);
      } else if (!tourRunning) {
        // Normal map: every visible mainland bubble is labeled (it was only shown
        // because its short name fits inside it). Territory-inset dots stay
        // hover-labeled. (During a blank tour beat — tourRunning && !tourActive —
        // nothing is collected so nothing is labelled.)
        if (!isTerr || forced) candidates.push(o);
      }
    }

    candidates.sort(
      (a, b) =>
        Number(tourIds.has(b.ncr_id)) - Number(tourIds.has(a.ncr_id)) ||
        Number(selectedOrg?.ncr_id === b.ncr_id) - Number(selectedOrg?.ncr_id === a.ncr_id) ||
        (a._labelRank ?? 0) - (b._labelRank ?? 0),
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
    // Keep labels from tucking under the floating topbar. Phones reserve a tall
    // band (the bar is bigger relative to the screen); desktop reserves a slim
    // one so top-row org labels don't hide behind the title chip.
    const topSafe = (compact && !tourActive ? 68 : tourActive ? 0 : 36) * unitPerPx;
    const edgeSafe = compact && !tourActive ? 5 * unitPerPx : 2 * unitPerPx;
    // Phones spread labels a little at first; the inflation now fades back out as
    // you zoom in (was growing), so zoomed-in iOS fills space instead of thinning.
    const spacing = compact && !tourActive ? Math.max(1, 1.25 - Math.max(0, k - 2) * 0.12) : 1;
    // ── Label decision tree (candidates are pre-sorted most-important first) ──
    // For each org, in importance order:
    //   1. INSIDE: if its short token fits inside the bubble at a legible size
    //      and its text box does not overlap a higher-priority label, draw it
    //      there. Importance ordering decides who wins when labels collide.
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
      return {
        x: o._sx,
        y: o._sy,
        r: orgPackingRadius(o, k) + bubblePad,
      };
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
    const labelCollisionPad = (compact ? 2.2 : 2.6) * unitPerPx;
    const inflateBox = (box: Box, pad: number): Box => ({
      x0: box.x0 - pad,
      x1: box.x1 + pad,
      y0: box.y0 - pad,
      y1: box.y1 + pad,
    });
    const labelBox = (x: number, y: number, text: string, font: number, inside: boolean): Box => {
      const w = Math.max(8 * unitPerPx, text.length * font * (inside ? insideLabelGlyphWidth(text.length) : 0.58));
      const h = font * (inside ? 1.05 : 1.15);
      return inside
        ? { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 }
        : { x0: x - w / 2, x1: x + w / 2, y0: y - h * 0.7, y1: y + h * 0.3 };
    };
    const reserveLabel = (box: Box): void => {
      const inflated = inflateBox(box, labelCollisionPad);
      placed.push(inflated);
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
      (hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id) && !tourActive;

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
      const baseFont = Math.min(labelFontPx(o, k), compact ? 23 : 28) * unitPerPx;
      const labelPadX = (compact ? 4.5 : 5) * unitPerPx;
      const labelPadY = (compact ? 4 : 4.5) * unitPerPx;

      for (const text of textOptions) {
        const insideFont = Math.min(
          baseFont,
          (r * BUBBLE_WIDTH_FACTOR * 1.74) / Math.max(1, text.length) / insideLabelGlyphWidth(text.length),
          r * BUBBLE_HEIGHT_FACTOR * 1.2,
        );
        if (
          insideFont >= hoverInsideMin &&
          insideFont * insideLabelGlyphWidth(text.length) * text.length <= r * BUBBLE_WIDTH_FACTOR * insideChord
        ) {
          return { x: sx, y: sy, font: insideFont, text: displayMapLabel(o, text), inside: true };
        }
      }

      for (const text of textOptions) {
        const acrossFont = Math.min(baseFont, (r * 2.05) / Math.max(1, text.length) / 0.58);
        if (acrossFont < hoverAcrossMin) continue;
        const w = text.length * acrossFont * 0.58;
        const h = acrossFont * 1.15;
        const box: Box = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h * 0.55, y1: sy + h * 0.45 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        return { x: sx, y: sy, font: acrossFont, text: displayMapLabel(o, text), inside: false, centered: true };
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
          return { x: lx, y: ly, font: fallbackFont, text: displayMapLabel(o, text), inside: false };
        }
      }
      return { x: sx, y: sy, font: fallbackFont, text: displayMapLabel(o, textOptions[0]), inside: false, centered: true };
    };

    for (const o of candidates) {
      if (isHoverLabelTarget(o)) continue;
      const sx = o._sx as number;
      const sy = o._sy as number;
      const r = renderedRadius(o, k);
      const brand = tinyName(o);

      // INSIDE LABEL — every visible mainland bubble carries its short name.
      // Bubbles never overlap (computePlacements) and the label sits inside the
      // bubble, so inside labels never collide with each other: draw it
      // unconditionally — no cap, no dedup, no collision test. The font spans the
      // chord down to the legible floor the disclosure gate already guaranteed, so
      // it always reads. (reserveLabel/addBubbleBlocker keep the rare forced
      // floating label below from sitting on top of it.)
      if (o._frame !== "terr") {
        const insideFont = insideLabelFont(o, k, r, brand.length);
        labelState.set(o.ncr_id, { x: sx, y: sy, font: insideFont, text: displayMapLabel(o, brand), inside: true });
        reserveLabel(labelBox(sx, sy, brand, insideFont, true));
        addBubbleBlocker(o);
        continue;
      }

      // Territory-inset dots only reach here when forced (hover/selected/tour) —
      // they carry no inside label, so fall through to a floating label.
      const forceLabel = hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id || tourIds.has(o.ncr_id);
      const lp = labelPriority(o);
      const midwest = isMidwestOrg(o);
      const shortHighValue = !compact && lp >= 68 && brand.length <= 7;
      const allowFloat =
        forceLabel ||
        (lp >= 88 && k >= (compact ? 0.85 : 0.75)) ||
        (lp >= 78 && k >= (compact ? 1.0 : 0.9)) ||
        (lp >= 68 && k >= (midwest ? 1.2 : 1.3)) ||
        (shortHighValue && k >= 1.45) ||
        (lp >= 52 && k >= (midwest ? 1.55 : 1.7)) ||
        (lp >= 38 && k >= (midwest ? 2.05 : 2.25)) ||
        (lp >= 16 && k >= (midwest ? 2.65 : 2.85)) ||
        k >= (compact ? 6.5 : 5.8);
      if (!allowFloat) continue;
      // Floating labels aren't bounded by a bubble chord (unlike inside labels),
      // so cap their on-screen size to keep deep zoom from producing oversized
      // text that overpowers the map.
      const font = Math.min(labelFontPx(o, k), compact ? 23 : 28) * unitPerPx;
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
      if (!chosen || !bubbleClears(o)) {
        continue;
      }
      reserveLabel(chosen.box);
      labelState.set(o.ncr_id, {
        x: chosen.x,
        y: chosen.y,
        font,
        text: displayMapLabel(o, chosen.text, compact ? 12 : 14),
        inside: false,
      });
      addBubbleBlocker(o);
    }

    for (const focus of [selectedOrg, hot]) {
      if (!focus?._vis || focus._sx == null || focus._sy == null || !isHoverLabelTarget(focus) || labelState.has(focus.ncr_id)) {
        continue;
      }
      // A real bubble (incl. a hovered give-way dot, which promotes to a full,
      // label-widened bubble — _renderFallback is false when forced) keeps its
      // inside label centered, exactly like the unhovered path. The bubble widened
      // to fit the name, so the label NEVER bounces below the pill on hover and
      // never flickers placement frame-to-frame while the bubble expands.
      const brand = focus._frame !== "terr" && !focus._renderFallback ? tinyName(focus) : "";
      if (brand) {
        const r = renderedRadius(focus, k);
        const insideFont = insideLabelFont(focus, k, r, brand.length);
        labelState.set(focus.ncr_id, {
          x: focus._sx,
          y: focus._sy,
          font: insideFont,
          text: displayMapLabel(focus, brand),
          inside: true,
        });
        continue;
      }
      const hoverLabel = tryHoverUnlabeledLabel(focus);
      if (hoverLabel) labelState.set(focus.ncr_id, hoverLabel);
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

    // Nudge the give-way dots clear of the now-settled real bubbles. One-directional:
    // dots read the bubbles and move themselves; bubbles are never touched. Runs after
    // the real layout is final and before the DOM sync below picks up dot positions.
    layoutDotGiveWay(dotOrgs, finalVisibleOrgs, k);

    for (const o of finalVisibleOrgs) {
      if (o._promoteBackground || selectedOrg?.ncr_id === o.ncr_id || hot?.ncr_id === o.ncr_id) {
        raiseVisibleOrg(o);
      }
    }
    // Focus-mode layering: related areas above the muted background, the focused
    // hub on top of everything (raised last). Muted orgs keep their natural order
    // underneath. Only runs while a hub is focused, so the default map is untouched.
    if (activeFocusGroup != null) {
      for (const o of finalVisibleOrgs) if (isFocusRelated(o)) raiseVisibleOrg(o);
      for (const o of finalVisibleOrgs) if (isFocusParent(o)) raiseVisibleOrg(o);
    }

    gOverlay.selectAll<SVGRectElement, Org>("rect.org").each(function (o) {
      const node = this as SVGRectElement;
      if (!o._vis) {
        if (o._wasVis !== false) {
          node.classList.add("hide");
          // Strip transient focus markers so a bubble that hides (e.g. the
          // last-clicked subarea once the panel/focus closes) can't keep a stale
          // focus-picked/parent/related/dim class. Force a clean re-toggle on return.
          node.classList.remove("focus-picked", "focus-parent", "focus-related", "focus-dim");
          o._clsMask = -1;
          o._wasVis = false;
        }
        return;
      }
      if (o._wasVis !== true) {
        node.classList.remove("hide");
        o._wasVis = true;
      }
      const cx = orgRenderX(o, fanScale, declScale);
      const cy = orgRenderY(o, fanScale, declScale);
      if (o._wox !== cx || o._woy !== cy) {
        setOrgBoxPosition(node, cx, cy);
        o._wox = cx;
        o._woy = cy;
      }
      // Size is set in transform-space (divided by the group scale). It changes
      // with zoom and, for isolated dots, with pan (the boost tracks neighbours),
      // so write only when the resolved radius actually moved — cheap, no storm.
      const rr = renderedRadius(o, k);
      if (o._rk !== k || o._rr !== rr) {
        setOrgBoxSize(node, o, k, rr / k);
        o._rk = k;
        o._rr = rr;
      }
      const labeled = labelState.has(o.ncr_id);
      const tier = disclosureTier(o, k, labeled);
      const inTour = tourActive && tourIds.has(o.ncr_id);
      const focusParent = isFocusParent(o);
      const focusRelated = isFocusRelated(o);
      const focusDim = activeFocusGroup != null && !focusParent && !focusRelated;
      const mask =
        (labeled ? 1 : 0) |
        (tier === "background" ? 2 : 0) |
        (o._promoteBackground ? 4 : 0) |
        (tier === "small" ? 8 : 0) |
        (hot?.ncr_id === o.ncr_id ? 16 : 0) |
        (selectedOrg?.ncr_id === o.ncr_id ? 32 : 0) |
        (inTour && labeled ? 64 : 0) |
        (inTour && !labeled ? 128 : 0) |
        (tourRunning && !inTour ? 256 : 0) |
        (focusParent ? 512 : 0) |
        (focusRelated ? 1024 : 0) |
        (focusDim ? 2048 : 0) |
        (focusedSubareaOrg?.ncr_id === o.ncr_id ? 4096 : 0);
      if (o._clsMask !== mask) {
        o._clsMask = mask;
        node.classList.toggle("labeled", labeled);
        node.classList.toggle("org-background", tier === "background");
        node.classList.toggle("org-promoted", !!o._promoteBackground);
        node.classList.toggle("bubble-small", tier === "small");
        node.classList.toggle("hot", (mask & 16) !== 0);
        node.classList.toggle("selected", (mask & 32) !== 0);
        // Only the labeled subset breathes (bounded count = cheap on iOS); the
        // rest of the focus set gets a static highlight. During a step everything
        // else dims; during a blank beat (tourRunning, no step) everything dims.
        node.classList.toggle("tour-flash", (mask & 64) !== 0);
        node.classList.toggle("tour-pick", (mask & 128) !== 0);
        node.classList.toggle("tour-dim", (mask & 256) !== 0);
        // PJM/MISO focus mode: the hub (parent) gets the strong orange heartbeat,
        // its members the softer outward-sweeping glow, everyone else greys out.
        node.classList.toggle("focus-parent", focusParent);
        node.classList.toggle("focus-related", focusRelated);
        node.classList.toggle("focus-dim", focusDim);
        node.classList.toggle("focus-picked", (mask & 4096) !== 0);
        // Stagger the related glow so the pulse radiates from the hub outward.
        node.style.animationDelay = focusRelated ? `${o._focusDelay ?? 0}s` : "";
      }
    });

    // Re-sync the saber rings every redraw (not just on zoom): the declutter
    // force-sim nudges bubbles at constant k as it settles, and the rings must
    // track that or they drift off to one side of their bubble.
    syncSabers(k);

    gHit.selectAll<SVGRectElement, Org>("rect.org-hit").each(function (o) {
      const node = this as SVGRectElement;
      if (!o._vis) {
        if (o._hitVis !== false) {
          node.classList.add("hide");
          o._hitVis = false;
        }
        return;
      }
      if (o._hitVis !== true) {
        node.classList.remove("hide");
        o._hitVis = true;
      }
      const cx = orgRenderX(o, fanScale, declScale);
      const cy = orgRenderY(o, fanScale, declScale);
      if (o._whx !== cx || o._why !== cy) {
        setOrgBoxPosition(node, cx, cy);
        o._whx = cx;
        o._why = cy;
      }
      const mask =
        (hot?.ncr_id === o.ncr_id ? 1 : 0) | (selectedOrg?.ncr_id === o.ncr_id ? 2 : 0);
      if (o._hitMask !== mask) {
        o._hitMask = mask;
        node.classList.toggle("hot", (mask & 1) !== 0);
        node.classList.toggle("selected", (mask & 2) !== 0);
      }
      const hr = hitTargetRadius(o, k);
      if (hitChanged || o._hr !== hr) {
        setHitBoxSize(node, o, k);
        o._hr = hr;
      }
    });

    gLabels.selectAll<SVGTextElement, Org>("text.olabel").each(function (o) {
      const node = this as SVGTextElement;
      const state = labelState.get(o.ncr_id);
      const prev = o._lw;
      if (!state) {
        if (!prev || prev.vis) {
          node.classList.add("dim");
          if (prev) prev.vis = false;
          else {
            o._lw = {
              vis: false,
              x: NaN,
              y: NaN,
              font: NaN,
              text: "",
              inside: false,
              centered: false,
              fill: "",
              stroke: "",
              strokeWidth: "",
              flags: -1,
            };
          }
        }
        return;
      }
      const lw =
        prev ??
        (o._lw = {
          vis: false,
          x: NaN,
          y: NaN,
          font: NaN,
          text: "",
          inside: false,
          centered: false,
          fill: "",
          stroke: "",
          strokeWidth: "",
          flags: -1,
        });
      if (!lw.vis) {
        node.classList.remove("dim");
        lw.vis = true;
      }
      if (lw.text !== state.text) {
        node.textContent = state.text;
        lw.text = state.text;
      }
      if (lw.x !== state.x) {
        node.setAttribute("x", String(state.x));
        lw.x = state.x;
      }
      if (lw.y !== state.y) {
        node.setAttribute("y", String(state.y));
        lw.y = state.y;
      }
      if (lw.font !== state.font) {
        node.setAttribute("font-size", String(state.font));
        lw.font = state.font;
      }
      if (lw.inside !== state.inside) {
        node.classList.toggle("inside", state.inside);
        lw.inside = state.inside;
      }
      const emphasis =
        selectedOrg?.ncr_id === o.ncr_id ? "selected" : hot?.ncr_id === o.ncr_id ? "hot" : "normal";
      const ink = orgLabelInk(state, emphasis);
      if (lw.fill !== ink.fill) {
        node.style.fill = ink.fill;
        lw.fill = ink.fill;
      }
      if (lw.stroke !== ink.stroke) {
        node.style.stroke = ink.stroke;
        lw.stroke = ink.stroke;
      }
      const strokeWidth = String(ink.strokeWidth);
      if (lw.strokeWidth !== strokeWidth) {
        node.style.strokeWidth = strokeWidth;
        lw.strokeWidth = strokeWidth;
      }
      node.style.paintOrder = "stroke fill";
      const focusRelatedLabel = isFocusRelated(o) || isFocusParent(o);
      const focusDimLabel = activeFocusGroup != null && !focusRelatedLabel;
      const flags =
        (state.centered ? 1 : 0) |
        (hot?.ncr_id === o.ncr_id ? 2 : 0) |
        (selectedOrg?.ncr_id === o.ncr_id ? 4 : 0) |
        (tourActive && !!state ? 8 : 0) |
        (focusRelatedLabel ? 16 : 0) |
        (focusDimLabel ? 32 : 0);
      if (lw.flags !== flags) {
        lw.flags = flags;
        node.classList.toggle("hover-on-dot", !!state.centered);
        node.classList.toggle("hot-label", (flags & 2) !== 0);
        node.classList.toggle("selected-label", (flags & 4) !== 0);
        node.classList.toggle("tour-flash", (flags & 8) !== 0);
        // Keep focused labels crisp; fade the rest into background context.
        node.classList.toggle("focus-on-label", (flags & 16) !== 0);
        node.classList.toggle("focus-dim", (flags & 32) !== 0);
      }
    });

    // City labels yield to NERC org labels AND bubbles: inflate every org-label
    // box and every bubble into a keep-away region so place names only land in
    // genuinely free space (important in the dense Midwest/Northeast clusters).
    const labelMargin = (compact ? 3 : 3.5) * unitPerPx;
    // Text keep-away: NERC org labels (and, as they place, the geo labels
    // themselves). A geo label must never sit on top of other text.
    const placeBlockers: Box[] = placed.map((b) => ({
      x0: b.x0 - labelMargin,
      x1: b.x1 + labelMargin,
      y0: b.y0 - labelMargin,
      y1: b.y1 + labelMargin,
    }));
    // Bubble keep-away — kept SEPARATE from the text blockers so a label that
    // can't find an open spot near its feature can fall back to sitting *behind*
    // the bubbles (the gLand group already paints under gOverlay) instead of
    // being flung far from its true location or hidden entirely.
    const bubbleBoxes: Box[] = [];
    for (const o of finalVisibleOrgs) {
      if (o._sx == null || o._sy == null) continue;
      // Tighter pad so geo labels can fill the gaps between bubbles, not just the
      // wide-open regions — they still never touch a bubble.
      const { hw, hh } = orgBubbleHalfExtents(o, k);
      const pad = (compact ? 3 : 4) * unitPerPx;
      bubbleBoxes.push({
        x0: o._sx - hw - pad,
        x1: o._sx + hw + pad,
        y0: o._sy - hh - pad,
        y1: o._sy + hh + pad,
      });
    }
    // ── Geographic context labels: cities, water bodies, state/province names ──
    // Each shows ONLY where it fits in open space (clear of every bubble, every
    // NERC label, and every other geo label). Crucially, each label tries its
    // anchor first, then a ring of nearby offsets, so a name slides into the open
    // part of its region instead of vanishing when its exact point sits near a
    // bubble — that is what lets many more of them show. Filled in usefulness
    // order so the best label wins contested space.
    const placeDotState = new Map<string, { x: number; y: number; r: number }>();
    const placeState = new Map<string, { x: number; y: number; font: number; bg: boolean }>();
    const landState = new Map<string, { x: number; y: number; font: number; bg: boolean; quiet: boolean }>();
    const ringOffsets = (R: number): Array<[number, number]> =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * 2 * Math.PI - Math.PI / 2;
        return [Math.cos(a) * R, Math.sin(a) * R] as [number, number];
      });
    // When zoomed out the whole map is compressed, so a label that roams far for
    // open space lands visibly far from its feature. Shrink the roam at low zoom
    // (≈30% at overview, full reach by k≈5) so names stay near home, and let what
    // no longer fits fall back to the background instead.
    const roam = Math.min(1, 0.3 + Math.max(0, k - 1) * 0.18);
    // Try the anchor, then each offset; place + reserve at the first OPEN spot
    // (clear of all text and all bubbles). If none is open and background is
    // allowed, drop the label at its anchor *behind* the bubbles — a faint,
    // correctly-placed name beats a bold misplaced one or none at all — provided
    // it still clears other text. bg=true marks the background placement so the
    // caller can render it quieter.
    const fitGeoLabel = (
      baseSx: number,
      baseSy: number,
      w: number,
      h: number,
      offsets: Array<[number, number]>,
      allowBackground = false,
    ): { x: number; y: number; bg: boolean } | null => {
      const boxAt = (sx: number, sy: number): Box | null => {
        const box: Box = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h * 0.6, y1: sy + h * 0.4 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe)
          return null;
        return box;
      };
      for (const [ox, oy] of offsets) {
        const sx = baseSx + ox;
        const sy = baseSy + oy;
        const box = boxAt(sx, sy);
        if (!box) continue;
        if (placeBlockers.some((q) => boxesOverlap(box, q))) continue;
        if (bubbleBoxes.some((q) => boxesOverlap(box, q))) continue;
        placeBlockers.push(box);
        return { x: sx, y: sy, bg: false };
      }
      if (allowBackground) {
        // Background fallback: at the anchor, allowed to sit under bubbles but
        // never on other text. Reserved so other geo labels still avoid it.
        // Skip if a bubble (opaque) fully covers the box — it would be invisible,
        // so placing it only wastes a slot and blocks a later label.
        const box = boxAt(baseSx, baseSy);
        const buried = (q: Box) => q.x0 <= box!.x0 && q.x1 >= box!.x1 && q.y0 <= box!.y0 && q.y1 >= box!.y1;
        if (box && !placeBlockers.some((q) => boxesOverlap(box, q)) && !bubbleBoxes.some(buried)) {
          placeBlockers.push(box);
          return { x: baseSx, y: baseSy, bg: true };
        }
      }
      return null;
    };
    if (!tourRunning) {
      for (const p of places) {
        if (p._x == null || p._y == null) continue;
        if (placeInUsInsetViewBox(p._x, p._y) && k < INSET_AMBIENT_CONTEXT_MIN_K) continue;
        if (k < placeDotMinK(p.tier)) continue;
        const sx = transform.applyX(p._x);
        const sy = transform.applyY(p._y);
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
        placeDotState.set(p.name, { x: sx, y: sy, r: placeDotRadius(p) });
      }

      // 1) Cities — most specific context; bigger metros first, zoom-gated by tier.
      // A city name may nudge slightly to dodge a bubble but stays near its point.
      let placedPlaces = 0;
      const placeCap = placeLabelLimit(k);
      // Offsets are in viewBox units (≈ geographic distance), NOT screen px, so a
      // label's wander is the same on phone and desktop — never flung across the
      // narrow mobile band into empty ocean/Arctic far from its true place.
      const cityOffsets: Array<[number, number]> = [
        [0, 0],
        ...ringOffsets(11 * roam),
        ...ringOffsets(20 * roam),
      ];
      for (const p of places) {
        if (placedPlaces >= placeCap) break;
        if (p._x == null || p._y == null) continue;
        if (placeInUsInsetViewBox(p._x, p._y) && k < INSET_AMBIENT_CONTEXT_MIN_K) continue;
        if (k < placeLabelMinK(p.tier)) continue;
        const sx = transform.applyX(p._x);
        const sy = transform.applyY(p._y);
        if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
        const px = (p.tier === 1 ? 11.5 : p.tier === 2 ? 10 : 9) * unitPerPx;
        const w = p.name.length * px * 0.66 + (compact ? 10 : 9) * unitPerPx;
        const h = px + (compact ? 8 : 7) * unitPerPx;
        const spot = fitGeoLabel(sx, sy, w, h, cityOffsets, true);
        if (!spot) continue;
        placedPlaces++;
        placeState.set(p.name, { x: spot.x, y: spot.y + px * 0.34, font: px, bg: spot.bg });
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
      // Background labels sit behind the bubbles near their true point — render
      // them faint so they read as quiet context, not foreground data.
      node.style.opacity = state.bg ? "0.5" : "";
    });

    // 2) Water bodies, then 3) state / province orientation names. Water first so
    // the big ocean gaps always read, then large state names, tiny coastal states
    // (zoom-gated), and finally Canadian provinces. Each roams a ring of offsets to
    // find its region's open space (big regions roam farther; tiny states barely
    // move). They never sit on the data, so they stay crisp instead of ghosting.
    if (!tourRunning) {
      const kindRank = (L: LandLabel) =>
        L.kind === "water" ? 0 : L.kind === "province" ? 3 : L.small ? 2 : 1;
      const landOrder = [...landLabels].sort((a, b) => kindRank(a) - kindRank(b));
      let placedLand = 0;
      // Thin out orientation labels as you zoom in — by deep zoom they would only
      // clutter the view, and the city names carry the local context.
      const deepLandT = smoothStep((k - 5) / 8);
      const landCap = Math.max(8, Math.round((compact ? 20 : 56) * (1 - 0.4 * deepLandT)));
      for (const L of landOrder) {
        if (placedLand >= landCap) break;
        if (L.kind === "state" && L.small && k < INSET_AMBIENT_CONTEXT_MIN_K) continue; // inset + tiny states
        if (L.kind === "state" && !L.small && k >= 16) continue; // big state names fade at deep zoom
        // Open ocean / Great Lakes: overview/mid context only. Interior water (rivers,
        // lakes, bays) does the opposite — it fills the open space AS you zoom into a
        // region, giving more geographic context exactly where the task wants it.
        if (L.kind === "water" && !L.interior && k >= 9) continue;
        if (L.kind === "water" && L.interior && (k < 2.5 || k >= 50)) continue;
        if (L.kind === "province" && k >= 12) continue;
        const baseSx = transform.applyX(L.x);
        const baseSy = transform.applyY(L.y);
        if (baseSx < -margin || baseSx > W + margin || baseSy < -margin || baseSy > H + margin) continue;
        // Keep overview labels close to their base size (gentle boost only) so the
        // orientation layer stays small and map-like instead of shouting.
        const grow = Math.max(0.82, 1.12 - Math.max(0, k - 1) * 0.05);
        const quiet = QUIET_LAND_LABELS.has(L.name);
        const base = L.kind === "water" ? 13 : L.small ? 9 : 11.5;
        // Quiet labels render smaller so they stop dominating the map.
        const font = base * grow * unitPerPx * (quiet ? 0.64 : 1);
        const w = L.name.length * font * 0.64 + (compact ? 10 : 9) * unitPerPx;
        const h = font + (compact ? 8 : 7) * unitPerPx;
        // viewBox-unit offsets (≈ geographic distance): big regions roam farther
        // for open space, tiny states barely move, so labels stay near home on any
        // device. Water is capped so an ocean name can't drift across the map.
        const spread = L.kind === "water" ? [42, 80, 120] : L.small ? [12] : [24, 46, 70];
        const offsets: Array<[number, number]> = [[0, 0]];
        for (const R of spread) offsets.push(...ringOffsets(R * roam));
        const spot = fitGeoLabel(baseSx, baseSy, w, h, offsets, true);
        if (!spot) continue;
        placedLand++;
        landState.set(L.name, { x: spot.x, y: spot.y, font, bg: spot.bg, quiet });
      }
    }

    // Geo labels only ever sit in open space, so they stay clearly readable — a
    // gentle density fade keeps them quiet on busy screens without ghosting them.
    const landOpacity = Math.max(0.74, 1 - shownCount / (compact ? 240 : 560));
    gLand.selectAll<SVGTextElement, LandLabel>("text.land-label").each(function (L) {
      const node = this as SVGTextElement;
      const state = landState.get(L.name);
      node.classList.toggle("dim", !state);
      if (!state) return;
      node.setAttribute("x", String(state.x));
      node.setAttribute("y", String(state.y));
      node.setAttribute("font-size", String(state.font));
      // Background labels (under the bubbles, at their true point) are dimmed so
      // they sit behind the data as quiet orientation context.
      node.style.opacity = String(
        (state.bg ? landOpacity * 0.6 : landOpacity) * (state.quiet ? 0.62 : 1),
      );
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
    // Re-centre the focus "signal" rings on the hub for the new viewport.
    syncFocusState();
  }

  // Lay out-of-footprint territory orgs
  // box. Geocoded orgs keep relative geography via geoMercator fitExtent;
  // ungeocoded orgs fall into a centred grid.
  function layoutTerritoryInsets(): void {
    territoryBoxes = [];
    // Territories hidden: leave terr orgs with undefined _x/_y so they fall out of
    // placeableOrgs (never rendered), and draw no inset.
    if (!SHOW_TERRITORIES) return;
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

  // Dashboard, tooltip, and detail panel rendering.
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

  // Special classification pills (oval tags, same format as the role pills) shown at
  // the top-right of the tooltip, above the roles: ISO/RTO for a market hub, PJM Zone
  // for a PJM transmission zone, MISO LBA for a MISO local balancing authority. Most
  // orgs carry none or one, but a dual-market utility (e.g. Duke Energy Ohio-Kentucky)
  // can legitimately be both a PJM zone and a MISO LBA, so these are independent.
  function specialClassTags(o: Org): HTMLSpanElement[] {
    const tags: HTMLSpanElement[] = [];
    if (isIsoRtoOperator(o)) {
      tags.push(
        createAreaPill(
          "ISO / RTO",
          "nerc-iso-area-pill",
          "Independent System Operator / Regional Transmission Organization",
        ),
      );
    }
    // Membership pill (PJM Zone / MISO LBA / NYISO TO / ISO-NE PTO). The hub itself
    // already shows the ISO/RTO pill, so only non-hub members get the family tag.
    // A dual-market utility (e.g. Duke Energy Ohio-Kentucky is both a PJM zone and a
    // MISO LBA) can carry more than one, so each family is tested independently.
    for (const id of MARKET_FAMILY_IDS) {
      if (isFamilyMemberOf(o, id)) {
        const m = MARKET_FAMILIES[id];
        tags.push(createAreaPill(m.pillLabel, m.pillClass, m.pillTitle));
      }
    }
    return tags;
  }

  // Hover tooltip layout:
  //   ┌ tt-head ─────────────────────────────────┐
  //   │ acronym + name        [special class tags] │
  //   ├────────────────────────────────────────────┤
  //   │ role pills (BA, RC, TOP…)  +N overflow      │
  //   └────────────────────────────────────────────┘
  // Roles render once, as colourful oval pills — no plain-text role summary.
  const TOOLTIP_ROLE_LIMIT = 4;
  function renderTooltip(o: Org): void {
    tooltip.replaceChildren();
    tooltip.setAttribute("role", "tooltip");

    const head = createEl("div", "tt-head");
    const headText = createEl("div", "tt-head-text");
    headText.append(
      createEl("div", "tt-acronym", orgAcronym(o)),
      createEl("div", "tt-name", displayName(o)),
    );
    head.append(headText);

    const tags = specialClassTags(o);
    if (tags.length) {
      const special = createEl("div", "nerc-tt-pills nerc-tt-special");
      special.append(...tags);
      head.append(special);
    }
    tooltip.append(head);

    const roles = primaryRoles(o);
    if (roles.length) {
      const chips = createEl("div", "nerc-tt-pills");
      roles.slice(0, TOOLTIP_ROLE_LIMIT).forEach((role) => chips.append(createRolePill(role, false, false)));
      if (roles.length > TOOLTIP_ROLE_LIMIT) {
        chips.append(createEl("span", "nerc-rolepill nerc-rolepill-more", `+${roles.length - TOOLTIP_ROLE_LIMIT}`));
      }
      tooltip.append(chips);
    }
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

  // Show the hover tooltip for `o`, anchored at the given screen point. Renders
  // immediately from whatever data is loaded, then re-renders once lazy details
  // arrive (guarded by tooltipRequest + the still-hovered check so a stale async
  // resolve can't overwrite a newer hover). showTooltip is the pointer-event entry;
  // both share this one implementation.
  function showTooltipAt(o: Org, anchorX: number, anchorY: number): void {
    if (selectedOrg) {
      hideTooltip();
      return;
    }
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

  function showTooltip(o: Org, ev: MouseEvent): void {
    showTooltipAt(o, ev.clientX, ev.clientY);
  }

  function hideTooltip(): void {
    tooltipRequest++;
    tooltip.hidden = true;
  }

  function hideRolePopover(): void {
    if (rolePopoverTimer != null) {
      window.clearTimeout(rolePopoverTimer);
      rolePopoverTimer = undefined;
    }
    rolePopover.hidden = true;
  }

  function showRolePopover(role: string, anchor: HTMLElement): void {
    const fullName = roleFullName(role);
    rolePopover.replaceChildren(
      createEl("span", "nerc-role-popover-code", role),
      createEl("span", "nerc-role-popover-name", fullName),
    );
    rolePopover.hidden = false;
    rolePopover.style.visibility = "hidden";
    rolePopover.style.left = "0px";
    rolePopover.style.top = "0px";

    const margin = 8;
    const gap = compact ? 7 : 8;
    const anchorRect = anchor.getBoundingClientRect();
    const popRect = rolePopover.getBoundingClientRect();
    const centeredX = anchorRect.left + anchorRect.width / 2;
    const x = Math.min(
      window.innerWidth - popRect.width - margin,
      Math.max(margin, centeredX - popRect.width / 2),
    );
    let y = anchorRect.top - popRect.height - gap;
    if (y < margin) y = anchorRect.bottom + gap;
    y = Math.min(window.innerHeight - popRect.height - margin, Math.max(margin, y));

    rolePopover.style.left = `${Math.round(x)}px`;
    rolePopover.style.top = `${Math.round(y)}px`;
    rolePopover.style.visibility = "";

    if (rolePopoverTimer != null) window.clearTimeout(rolePopoverTimer);
    rolePopoverTimer = window.setTimeout(hideRolePopover, compact ? 3600 : 4400);
  }

  function createPanelRoleRows(roles: string[]): HTMLDivElement {
    const rows = createEl("div", "p-roles");
    roles.forEach((role, index) => {
      const pill = createRolePill(role);
      pill.style.setProperty("--role-wave-delay", `${0.25 + index * 0.08}s`);
      rows.append(pill);
    });
    return rows;
  }

  function createPanelRoleBlock(o: Org): HTMLDivElement {
    return createPanelRoleRows(primaryRoles(o));
  }

  function createMapSizeTier(o: Org): HTMLDivElement {
    const score = createEl("div", "p-priority-score");
    score.append(createEl("span", "p-priority-num", sizeTierLabel(o)));
    return score;
  }

  function cleanNotePart(value: string): string {
    const note = value
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim()
      .replace(/[.;]+$/g, "");
    if (!note) return "";
    return `${note.charAt(0).toUpperCase()}${note.slice(1)}`;
  }

  function formatPanelNotes(value: string | null | undefined): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const normalized = raw.replace(/\s*\n+\s*/g, "; ").replace(/\s+/g, " ").trim();
    const splitter = /https?:\/\//i.test(normalized) || /\bwww\./i.test(normalized) ? /\s*;\s*/ : /\s*(?:;|\.\s+)\s*/;
    const parts = normalized.split(splitter).map(cleanNotePart).filter(Boolean);
    if (!parts.length) return "";
    return `${parts.join("; ")}.`;
  }

  function applyHighlights(): void {
    const hot = hoverOrg;
    gOverlay
      .selectAll<SVGRectElement, Org>("rect.org")
      .classed("hot", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected", (d) => selectedOrg?.ncr_id === d.ncr_id);

    gHit
      .selectAll<SVGRectElement, Org>("rect.org-hit")
      .classed("hot", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected", (d) => selectedOrg?.ncr_id === d.ncr_id);

    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .classed("hot-label", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected-label", (d) => selectedOrg?.ncr_id === d.ncr_id)
      // Lift the focused label to the top of the label layer so it's never
      // hidden under a neighbour in a dense cluster. (Labels are few and only
      // the shown subset is visible, so a sticky reorder is harmless.)
      .filter((d) => hot?.ncr_id === d.ncr_id || selectedOrg?.ncr_id === d.ncr_id)
      .raise();
    // Keep the svg-root focus classes in sync when applyHighlights runs without a
    // full redraw (e.g. the async detail-load path after a selection).
    syncFocusState();
  }

  // Hover preview: highlight the dot and show the tooltip without relayout —
  // labels, placement, and the detail panel stay put until click.
  function applyHoverFocus(): void {
    const hot = hoverOrg;
    const k = transform.k;
    applyHighlights();
    gOverlay.selectAll<SVGRectElement, Org>("rect.org").each(function (o) {
      const node = this as SVGRectElement;
      if (node.classList.contains("hide")) return;
      const forced = hot?.ncr_id === o.ncr_id || selectedOrg?.ncr_id === o.ncr_id;
      const labeled = lastLabelState?.has(o.ncr_id) ?? false;
      const promoted = isBackgroundPromoted(o, forced);
      node.classList.toggle("org-promoted", promoted);
      node.classList.toggle("org-background", rendersAsBackgroundDot(o, labeled, forced));
      const rr = promoted ? promotedBackgroundRadius(o, k) : renderedRadius(o, k);
      setOrgBoxSize(node, o, k, rr / k);
    });
    if (hot) raiseVisibleOrg(hot);
  }

  // Called when the pointer/focus LEAVES an org. A give-way dot promotes to a
  // bigger bubble + gains a hover label while hovered; those are produced by a
  // full redraw, so they must be cleared by one too — the lightweight
  // clearHoverFocus alone leaves the dot stuck expanded with its label still
  // drawn (it never resets _promoteBackground, which renderedRadius reads, nor
  // removes the hover-only label element). Real pills never promote, so they take
  // the cheap path with no relayout.
  function endHoverFor(left: Org | null): void {
    if (left && (isGiveWayDot(left) || left._promoteBackground)) {
      left._promoteBackground = false;
      clearHoverFocus();
      redraw();
      return;
    }
    clearHoverFocus();
  }

  function clearHoverFocus(): void {
    const k = transform.k;
    applyHighlights();
    gOverlay.selectAll<SVGRectElement, Org>("rect.org").each(function (o) {
      const node = this as SVGRectElement;
      if (node.classList.contains("hide")) return;
      const forced = selectedOrg?.ncr_id === o.ncr_id;
      const labeled = lastLabelState?.has(o.ncr_id) ?? false;
      const promoted = isBackgroundPromoted(o, forced);
      node.classList.toggle("org-promoted", promoted);
      node.classList.toggle("org-background", rendersAsBackgroundDot(o, labeled, forced));
      node.classList.toggle("hot", false);
      const rr = promoted ? promotedBackgroundRadius(o, k) : renderedRadius(o, k);
      setOrgBoxSize(node, o, k, rr / k);
    });
    gHit.selectAll<SVGRectElement, Org>("rect.org-hit").classed("hot", false);
    gLabels.selectAll<SVGTextElement, Org>("text.olabel").classed("hot-label", false);
  }

  function applyTourClasses(): void {
    const active = tourIds.size > 0;
    gOverlay
      .selectAll<SVGRectElement, Org>("rect.org")
      .classed("tour-flash", (d) => active && tourIds.has(d.ncr_id))
      .classed("tour-dim", (d) => active && !tourIds.has(d.ncr_id));

    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .classed("tour-flash", (d) => active && tourIds.has(d.ncr_id));
  }

  // Each field is a self-contained block (label above value) so the grid can lay
  // them out in columns with a thin divider between rows — clearly separated, not
  // mashed together. `wide` spans the full width (roles + regional entity).
  function addDlRow(
    dl: HTMLDListElement,
    term: string,
    value: string | Node,
    wide = false,
  ): void {
    const field = createEl("div", `p-field${wide ? " p-field-wide" : ""}`);
    const dt = createEl("dt", undefined, term);
    const dd = createEl("dd");
    if (typeof value === "string") dd.textContent = value;
    else dd.append(value);
    field.append(dt, dd);
    dl.append(field);
  }

  function createPanelTag(className: string, text: string): HTMLSpanElement {
    return createEl("span", `${className} nerc-panel-tag`, text);
  }

  // Collapse shrinks the card to its title bar so it stops covering the map without
  // losing the selection. The button is static markup; this keeps its label/aria in
  // sync with the panel state.
  function setPanelCollapsed(collapsed: boolean): void {
    panel.classList.toggle("collapsed", collapsed);
    panelCollapseBtn.textContent = collapsed ? "+" : "–";
    panelCollapseBtn.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
    panelCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
  }

  function renderPanel(o: Org): void {
    o = applyOrgDetails(o);
    panelBody.replaceChildren();
    panelBody.scrollTop = 0;
    // The close/collapse buttons are static siblings of the scrolling body (see
    // index.astro) so they stay pinned while the body scrolls. Just reset the
    // collapse state for the freshly-selected org.
    setPanelCollapsed(false);
    panelBody.style.setProperty("--org-color", safeColor(o.color));
    const title = createEl("div", "p-title");
    title.style.setProperty("--org-color", safeColor(o.color));
    const acronym = createEl("span", "p-acronym", orgAcronym(o));
    title.append(acronym, createEl("h2", undefined, displayName(o)));
    panelBody.append(
      title,
      createEl("p", "p-sub", `${idLabel(o)}${o.seed ? " | seed record" : ""} | ${typeLabel(o.org_type)}`),
    );
    // Compact classification tags. Details stay in the rows below.
    if (isIsoRtoOperator(o)) {
      const note = createEl("p", "p-isorto");
      note.append(createPanelTag("p-isorto-badge", "ISO / RTO"));
      panelBody.append(note);
    }
    for (const id of MARKET_FAMILY_IDS) {
      if (isFamilyMemberOf(o, id)) {
        const m = MARKET_FAMILIES[id];
        const note = createEl("p", m.panelTagClass);
        note.append(createPanelTag(m.panelBadgeClass, m.pillLabel));
        panelBody.append(note);
      }
    }
    const dl = createEl("dl");
    addDlRow(dl, `Roles (${o.role_count})`, createPanelRoleBlock(o), true);
    addDlRow(dl, "Regional Entity", regionLabel(o), true);
    addDlRow(dl, "Location", o.headquarters_address ?? locationLabel(o));
    addDlRow(dl, "Location confidence", `${confidenceLabel(o.geo_confidence)}${o.geo_source ? ` | ${o.geo_source}` : ""}`);
    addDlRow(dl, "Map size / priority", createMapSizeTier(o));
    const notes = formatPanelNotes(o.geo_notes);
    if (notes) addDlRow(dl, "Notes", notes);

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
      addDlRow(dl, `Also registered here (${o.combined_members.length})`, list, true);
      if (o.entity_name !== displayName(o)) {
        addDlRow(dl, "Primary registration", o.entity_name, true);
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
    hideRolePopover();
    panel.hidden = true;
    selectedOrg = null;
    focusedSubareaOrg = null;
    hoverOrg = null;
    clearFocus();
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

  function buttonZoomFocusPoint(factor: number): [number, number] {
    if (factor <= 1 || transform.k < 2.2) return [W / 2, H / 2];
    const points: Array<{ x: number; y: number; w: number }> = [];
    let sx = 0;
    let sy = 0;
    let total = 0;
    const topFocusSafe = compact ? 78 : 90;
    const bottomFocusSafe = compact ? 56 : 44;
    for (const o of placeableOrgs) {
      if (!o._vis || o._frame === "terr" || o._sx == null || o._sy == null) continue;
      if (o._sx < 0 || o._sx > W || o._sy < 0 || o._sy > H) continue;
      if (o._sy < topFocusSafe || o._sy > H - bottomFocusSafe) continue;
      const rPx = renderedRadius(o, transform.k) / unitPerPx;
      const w =
        1 +
        Math.min(4, rPx / 18) +
        3 * smoothStep((visualPriority(o) - 38) / 62) +
        0.15 * meaningfulRoleCount(o);
      sx += o._sx * w;
      sy += o._sy * w;
      total += w;
      points.push({ x: o._sx, y: o._sy, w });
    }
    if (total < 8) return [W / 2, H / 2];
    let cx = sx / total;
    let cy = sy / total;
    if (transform.k >= 4.2 && points.length >= 6) {
      const densityR = compact ? 150 : 230;
      let best = points[0];
      let bestScore = -Infinity;
      for (const p of points) {
        let density = 0;
        for (const q of points) {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d > densityR) continue;
          const t = 1 - d / densityR;
          density += q.w * t * t;
        }
        const centerPenalty = Math.hypot(p.x - W / 2, p.y - H / 2) / Math.hypot(W, H);
        const score = density + p.w * 0.35 - centerPenalty * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      cx = best.x;
      cy = best.y;
    }
    const steer = transform.k >= 4.2
      ? 0.46 + 0.36 * smoothStep((transform.k - 4.2) / 8)
      : 0.18 + 0.34 * smoothStep((transform.k - 2.4) / 8);
    const ySteer = steer * (transform.k >= 4.2 ? 0.55 : 0.75);
    const x = W / 2 + (cx - W / 2) * steer;
    const y = H / 2 + (cy - H / 2) * ySteer;
    return [
      Math.max(W * 0.24, Math.min(W * 0.76, x)),
      Math.max(H * 0.3, Math.min(H * 0.76, y)),
    ];
  }

  // Smooth zoom step for the on-screen +/- controls. After the overview, zoom-in
  // leans toward the visible org field so repeated button taps do not tunnel
  // into empty national-center whitespace.
  function zoomByFactor(factor: number): void {
    if (!zoomBehavior) return;
    svg.interrupt();
    const focus = buttonZoomFocusPoint(factor);
    svg
      .transition()
      .duration(220)
      .call(zoomBehavior.scaleBy as never, factor, focus);
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

  // The detail card's rectangle in viewBox units (or null when hidden). Centering
  // and edge-nudging use it to frame the selection in the area the card leaves
  // clear — a bottom-right card on desktop, a full-width sheet on mobile.
  function panelRectVB(): { left: number; top: number; right: number; bottom: number } | null {
    if (panel.hidden) return null;
    const pr = panel.getBoundingClientRect();
    if (pr.width <= 0 || pr.height <= 0) return null;
    return {
      left: pr.left * unitPerPx,
      top: pr.top * unitPerPx,
      right: pr.right * unitPerPx,
      bottom: pr.bottom * unitPerPx,
    };
  }

  function centerOnOrg(o: Org, duration = 300): void {
    if (o._x == null || o._y == null) return;
    // Ensure a readable zoom, but never zoom the user back out if they've
    // already zoomed in deeper.
    const scale = Math.min(MAX_ZOOM, Math.max(transform.k, o.is_iso_rto ? 3.2 : 4.2));
    // Frame the org (and its focus family) in the space the card leaves clear: lift
    // the focus point above the card's top edge, and on desktop — where the card
    // hugs the bottom-right — lean it a touch left so the family isn't pushed under
    // the card. Mobile (full-width sheet) keeps the horizontal centre.
    const card = panelRectVB();
    const topSafe = (compact ? 96 : 64) * unitPerPx;
    let cx = W / 2;
    let cy = H * 0.46;
    if (card) {
      cy = Math.max(H * 0.34, Math.min(H * 0.52, (topSafe + card.top) / 2));
      if (card.left > W * 0.4) cx = W * 0.45; // desktop bottom-right card → bias left
    }
    const next = zoomIdentity.translate(cx, cy).scale(scale).translate(-o._x, -o._y);
    animateTransform(next, duration);
  }

  // Frame the whole PJM or MISO family in view — zooms out when needed so every
  // member fits in the area the detail card leaves clear.
  function fitFocusGroup(group: MarketFamilyId, duration = 380): void {
    const members = orgs.filter((o) => marketFamily(o) === group && o._x != null && o._y != null);
    if (members.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const o of members) {
      minX = Math.min(minX, o._x as number);
      maxX = Math.max(maxX, o._x as number);
      minY = Math.min(minY, o._y as number);
      maxY = Math.max(maxY, o._y as number);
    }

    const span = Math.max(maxX - minX, maxY - minY, 24 * unitPerPx);
    const pad = span * 0.1 + 20 * unitPerPx;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;
    const dataCx = (minX + maxX) / 2;
    const dataCy = (minY + maxY) / 2;
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;

    let mL = (compact ? 24 : 32) * unitPerPx;
    let mT = (compact ? 68 : 48) * unitPerPx;
    let mR = (compact ? 24 : 32) * unitPerPx;
    let mB = (compact ? 36 : 28) * unitPerPx;
    const card = panelRectVB();
    if (card) {
      if (card.left > W * 0.35) {
        mR = Math.max(mR, W - card.left + 14 * unitPerPx);
        mB = Math.max(mB, H - card.top + 10 * unitPerPx);
      } else {
        mB = Math.max(mB, H - card.top + 8 * unitPerPx);
      }
    }
    const viewW = Math.max(W * 0.35, W - mL - mR);
    const viewH = Math.max(H * 0.35, H - mT - mB);
    const viewCx = mL + viewW / 2;
    const viewCy = mT + viewH / 2;

    // Fill the clear viewport a little past the padded bbox (the pad is empty
    // margin) so the family frames up closer/more zoomed-in rather than floating
    // small in the middle.
    const k = Math.max(
      0.72,
      Math.min(MAX_ZOOM, Math.min(viewW / bboxW, viewH / bboxH) * 1.12),
    );
    focusPanPending = true;
    const next = zoomIdentity.translate(viewCx, viewCy).scale(k).translate(-dataCx, -dataCy);
    requestAnimationFrame(() => {
      focusPanPending = false;
      animateTransform(next, duration);
    });
  }

  // Brief one-shot pulse on a bubble — used to acknowledge a subarea click when the
  // panel stays anchored to its parent hub, so the click still feels responsive.
  function pingSubarea(o: Org): void {
    const node = gOverlay
      .selectAll<SVGRectElement, Org>("rect.org")
      .filter((d) => d.ncr_id === o.ncr_id)
      .node();
    if (!node) return;
    node.classList.remove("focus-ping");
    void node.getBoundingClientRect(); // reflow so the animation restarts each click
    node.classList.add("focus-ping");
    window.setTimeout(() => node.classList.remove("focus-ping"), 520);
  }

  function selectOrg(o: Org, opts: { center?: boolean } = {}): void {
    if (tourRunning) stopTour(true);
    hoverOrg = null;
    hideRolePopover();
    // Focus mode (PJM/MISO only). Clicking a hub focuses its family; clicking one
    // of that family's related areas keeps focus active and opens that area's
    // panel; clicking anything else clears focus. Must run before panelOrgForSelection.
    if (isMarketHub(o)) {
      setFocusGroup(marketFamily(o) as MarketFamilyId);
    } else if (!(activeFocusGroup != null && marketFamily(o) === activeFocusGroup)) {
      clearFocus();
    }
    // The org the panel will show. Focused subareas keep PJM/MISO focus active
    // but open their own detail panel rather than redirecting to the hub.
    const panelOrg = panelOrgForSelection(o);
    focusedSubareaOrg =
      activeFocusGroup != null && marketFamily(o) === activeFocusGroup && !isMarketHub(o) ? o : null;
    (window as unknown as Record<string, unknown>).__lastPick = { o: o.entity_name, sub: focusedSubareaOrg?.entity_name ?? null, same: selectedOrg != null && selectedOrg.ncr_id === panelOrg.ncr_id };

    // Re-selecting the org already in the panel keeps the panel and the view exactly
    // as they are: no re-render, no pan. The pick just pulses + highlights so it
    // still feels interactive.
    const sameSelection = selectedOrg != null && selectedOrg.ncr_id === panelOrg.ncr_id;
    if (sameSelection) {
      hideTooltip();
      clearOrgPointerFocus();
      raiseVisibleOrg(o);
      if (focusedSubareaOrg) pingSubarea(o);
      if (isMarketHub(o)) {
        centerSelection = true;
        fitFocusGroup(marketFamily(o) as MarketFamilyId);
      }
      redraw(); // refresh the focus-picked highlight onto the newly clicked subarea
      applyHighlights();
      return;
    }

    selectedOrg = panelOrg;
    infoPanel.hidden = true;
    metricsPanel.hidden = true;
    renderPanel(panelOrg);
    if (!hasOrgDetails(panelOrg)) {
      const panelId = panelOrg.ncr_id;
      void ensureOrgDetails(panelOrg)
        .then((fullOrg) => {
          if (selectedOrg?.ncr_id !== panelId) return;
          selectedOrg = fullOrg;
          renderPanel(fullOrg);
          applyHighlights();
        })
        .catch(() => {});
    }
    hideTooltip();
    clearOrgPointerFocus();
    raiseVisibleOrg(o);
    if (focusedSubareaOrg) {
      raiseVisibleOrg(focusedSubareaOrg);
      pingSubarea(focusedSubareaOrg);
    }
    // Hub click: zoom out to frame the whole PJM/MISO family in clear view.
    if (isMarketHub(o)) {
      centerSelection = true;
      requestAnimationFrame(() => fitFocusGroup(marketFamily(o) as MarketFamilyId));
      applyHighlights();
      return;
    }
    // Only deliberate navigations (search / tour, opts.center) hard-centre + zoom on
    // a pick. Subarea and ordinary org clicks stay at the current zoom and just
    // gently edge-nudge the pick into clear view (via renderPanel).
    centerSelection = opts.center === true;
    if (centerSelection) centerOnOrg(panelOrg);
    else redraw();
    applyHighlights();
  }

  function raiseVisibleOrg(o: Org): void {
    gOverlay
      .selectAll<SVGRectElement, Org>("rect.org")
      .filter((d) => d.ncr_id === o.ncr_id)
      .raise();
    gHit
      .selectAll<SVGRectElement, Org>("rect.org-hit")
      .filter((d) => d.ncr_id === o.ncr_id)
      .raise();
    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .filter((d) => d.ncr_id === o.ncr_id)
      .raise();
  }

  function wireOrgPointer(selection: ReturnType<typeof gOverlay.selectAll<SVGRectElement, Org>>): void {
    selection
      .on("mouseenter", (ev, o) => {
        if (selectedOrg) {
          hoverOrg = null;
          hideTooltip();
          clearHoverFocus();
          return;
        }
        // Resolve the same way a click does: a visible dot tucked against a pill
        // gets hover priority over the pill's (padded) hit rect, rather than the
        // pill always winning just because its hit element sits on top.
        const target = nearestOrgAtPointer(ev as MouseEvent, o);
        hoverOrg = target;
        showTooltip(target, ev as MouseEvent);
        applyHoverFocus();
      })
      .on("mousemove", (ev) => {
        if (selectedOrg || tooltip.hidden) return;
        placeTooltip((ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      })
      .on("mouseleave", () => {
        const left = hoverOrg;
        hoverOrg = null;
        hideTooltip();
        endHoverFor(left);
      })
      .on("focus", function (_ev, o) {
        if (selectedOrg) {
          hoverOrg = null;
          hideTooltip();
          clearHoverFocus();
          return;
        }
        hoverOrg = o;
        const rect = (this as SVGRectElement).getBoundingClientRect();
        showTooltipAt(o, rect.right, rect.top);
        applyHoverFocus();
      })
      .on("blur", () => {
        const left = hoverOrg;
        hoverOrg = null;
        hideTooltip();
        endHoverFor(left);
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
        raiseVisibleOrg(picked);
        selectOrg(picked);
      });
  }

  function updateView(opts: { stopTourFirst?: boolean } = {}): void {
    if (opts.stopTourFirst) stopTour();
    redraw();
    renderStats();
  }

  // Controls, zoom, and tour wiring.
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
    // Detail-card close/collapse (static markup; wired once). The buttons sit
    // outside the scrolling body so they stay pinned as the card scrolls.
    panelCloseBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closePanel();
    });
    panelCollapseBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setPanelCollapsed(!panel.classList.contains("collapsed"));
    });
    // Clear focus → back to the calm default map (also closes the detail panel).
    focusClearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closePanel();
    });

    // On-screen zoom controls. These only change zoom — they never open a panel —
    // so re: changing zoom is clearly separate from the Metrics/Info popovers.
    byId<HTMLButtonElement>("nerc-zoom-in").addEventListener("click", () => zoomByFactor(1.55));
    byId<HTMLButtonElement>("nerc-zoom-out").addEventListener("click", () => zoomByFactor(1 / 1.55));
    byId<HTMLButtonElement>("nerc-zoom-home").addEventListener("click", () => {
      homeView(260);
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        hideRolePopover();
        stopTour();
        closePopovers();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
        const step = ev.shiftKey ? 115 : 52;
        const dx = ev.key === "ArrowLeft" ? step : ev.key === "ArrowRight" ? -step : 0;
        const dy = ev.key === "ArrowUp" ? step : ev.key === "ArrowDown" ? -step : 0;
        ev.preventDefault();
        animateTransform(zoomIdentity.translate(transform.x + dx, transform.y + dy).scale(transform.k), 160);
      }
    });

    document.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (target?.closest(".nerc-role-popover, .nerc-rolepill[data-role]")) return;
      hideRolePopover();
    });
    window.addEventListener("resize", hideRolePopover);
    panelBody.addEventListener("scroll", hideRolePopover, { passive: true });
  }

  function revealActionButtons(): void {
    metricsToggle.textContent = "Data";
    infoToggle.textContent = "Info";
  }

  function setupZoom(): void {
    zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.72, MAX_ZOOM])
      .clickDistance(compact ? 6 : 4)
      .tapDistance(compact ? 12 : 8)
      .wheelDelta(wheelDelta)
      .filter((event) => !event.ctrlKey && !event.button)
      // Pan/zoom gestures are allowed DURING a walkthrough so you can explore
      // while it plays — the tour only highlights, it never drives the camera per
      // step, so a manual move just changes what you're looking at. (The Stop
      // Tour button and a tap on empty map still end it.)
      .on("start", (ev) => {
        if (isPanSourceEvent(ev.sourceEvent)) userPanning = true;
        if (isWheelEvent(ev.sourceEvent)) wheelZooming = true;
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
      if (tourRunning) stopTour(true);
      closePopovers();
    });
  }

  function setPlayState(running: boolean): void {
    const aria = running ? "Stop walkthrough" : "Play walkthrough";
    playBtn.textContent = running ? "Stop Tour" : "Take Tour";
    fabBtn.textContent = running ? "Stop" : "Tour";
    for (const b of [playBtn, fabBtn]) {
      b.setAttribute("aria-label", aria);
      b.classList.toggle("is-running", running);
    }
  }

  function showTourStoppedNotice(): void {
    if (tourNoticeTimer) window.clearTimeout(tourNoticeTimer);
    tourStatus.replaceChildren(
      createEl("strong", "tour-title", "Tour stopped."),
      createEl("span", "tour-progress", "Explore freely."),
    );
    tourStatus.hidden = false;
    tourNoticeTimer = window.setTimeout(() => {
      if (!tourRunning) tourStatus.hidden = true;
      tourNoticeTimer = undefined;
    }, 2200);
  }

  function stopTour(showNotice = false): void {
    tourTimers.forEach((timer) => window.clearTimeout(timer));
    tourTimers = [];
    svg.interrupt(); // cancel any in-flight reset transition so nothing stacks
    tourIds = new Set();
    tourRunning = false;
    invalidateOrgLayout();
    if (showNotice) {
      showTourStoppedNotice();
    } else {
      if (tourNoticeTimer) window.clearTimeout(tourNoticeTimer);
      tourNoticeTimer = undefined;
      tourStatus.hidden = true;
    }
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
    focusedSubareaOrg = null;
    clearFocus();
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
    const [orgsPayload, topo, canadaMaybe] = await Promise.all([
      orgsPayloadPromise,
      topoPromise,
      canadaPromise,
    ]);

    if (!Array.isArray(orgsPayload.orgs)) throw new Error("No orgs array found in NERC payload");
    orgs = orgsPayload.orgs;
    computeStaticRanks(); // prime per-org memos and integer sort ranks once

    // Canada landmass (context). Non-fatal if the file is missing.
    canadaFeature = canadaMaybe;

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
      .attr("class", (d) => "land-label " + d.kind)
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

    const visibleBubbles = gOverlay
      .selectAll("rect.org")
      .data(visibleOrder, (o: unknown) => (o as Org).ncr_id)
      .join("rect")
      .attr(
        "class",
        (o) =>
          "org" +
          (o.geo_confidence === "ESTIMATED" || o.geo_confidence === "LOW" ? " estimated" : "") +
          (o.nerc_registered === false ? " unregistered" : ""),
      )
      .attr("fill", (o) => safeColor(o.color))
      .attr("transform", null)
      .each(function (o) {
        const node = this as SVGRectElement;
        const k = transform.k;
        setOrgBoxSize(node, o, k, renderedRadius(o, k) / Math.max(k, 0.001));
        setOrgBoxPosition(node, orgRenderX(o), orgRenderY(o));
      })
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (o) => `${orgAcronym(o)} ${displayName(o)}`);

    wireOrgPointer(visibleBubbles as never);

    // Saber outlines for the ISO/RTO bubbles. pathLength=100 normalizes the dash
    // pattern so one CSS keyframe runs the light cleanly around every ring
    // regardless of its size or the zoom level; syncSabers() keeps each ring on
    // its bubble. They never take pointer events (the bubble underneath does).
    gSaber
      .selectAll("rect.org-saber")
      .data(visibleOrder.filter(isIsoRtoOperator), (o: unknown) => (o as Org).ncr_id)
      .join("rect")
      // A market hub trades the generic orange saber for its own family colour, so
      // PJM/MISO/NYISO/ISO-NE read as distinct gravitational centres; every other
      // ISO/RTO keeps the orange light.
      .attr("class", (o) => {
        const fam = marketFamily(o);
        return "org-saber" + (fam && isMarketHub(o) ? ` ${MARKET_FAMILIES[fam].saberClass}` : "");
      })
      .attr("pathLength", 100)
      .attr("aria-hidden", "true");
    syncSabers(transform.k);

    const hitTargets = gHit
      .selectAll("rect.org-hit")
      .data(hitOrder, (o: unknown) => (o as Org).ncr_id)
      .join("rect")
      .attr("class", "org-hit")
      .attr("aria-hidden", "true")
      .each(function (o) {
        const node = this as SVGRectElement;
        setHitBoxSize(node, o, transform.k);
        setOrgBoxPosition(node, orgRenderX(o), orgRenderY(o));
      });

    wireOrgPointer(hitTargets as never);

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
  }


  init().catch((err) => {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    loadingEl.textContent = `Could not load map data. (${msg})`;
    loadingEl.style.display = "grid";
  });
}
