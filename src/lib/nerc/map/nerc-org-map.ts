import { geoAlbersUsa, geoPath } from "d3-geo";
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
  _x?: number;
  _y?: number;
  _rx?: number;
  _ry?: number;
  _sx?: number;
  _sy?: number;
  _vis?: boolean;
  _rk?: number;
};

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

const TYPE_LABELS: Record<string, string> = {
  ISO_RTO: "ISO / RTO",
  IOU: "Investor-owned utility",
  cooperative: "Electric cooperative",
  municipal: "Municipal / public power",
  federal: "Federal power authority",
  merchant: "Merchant / IPP",
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

function orgAcronym(o: Org): string {
  return o.acronym || fallbackAcronym(o.entity_name);
}

function typeLabel(value: string | null): string {
  return TYPE_LABELS[value ?? "other"] ?? value ?? "Other";
}

function confidenceLabel(value: string | null): string {
  return CONFIDENCE_LABELS[value ?? ""] ?? value ?? "Unknown";
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
  // Geographic context stays below every NERC mark and label.
  const gPlaces = svg.append("g").attr("class", "places");
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
  const prefersReducedMotion = (): boolean =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // User-space units per on-screen pixel (W / element width). Lets us size
  // labels in real pixels so they read the same on desktop and iOS.
  let unitPerPx = 1;
  // Phone-sized screens get fewer labels when zoomed in (less screen real
  // estate for the same physical-size labels).
  let compact = false;
  // Live "shown in view" counter element inside the metrics panel.
  let shownEl: HTMLElement | null = null;
  let orgMarkFanScale = NaN;

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
    const full = shortName(o.entity_name);
    if (k < 3.2 || full.length > (compact ? 22 : 32)) return orgAcronym(o);
    return full;
  }

  // Which orgs are eligible to *try* for a label at this zoom. Kept sparse at
  // low zoom (only the heaviest entities) and opened up fully once zoomed in,
  // where viewport culling keeps the on-screen candidate count small.
  function shouldTryLabel(o: Org, k: number): boolean {
    if (k < 1.25) return o.weight >= 12;
    if (k < 1.8) return o.weight >= 7;
    if (k < 2.6) return o.weight >= 5;
    if (k < 3.4) return o.weight >= 4;
    if (k < 4.8) return o.weight >= 3;
    if (k < 6.8) return o.weight >= 2;
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
      k < 1.25 ? 46 :
      k < 1.8 ? 70 :
      k < 2.6 ? 88 :
      k < 3.4 ? 110 :
      k < 4.8 ? 132 :
      k < 6.8 ? 162 :
      190;
    return compact ? Math.round(cap * 0.68) : cap;
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
    const base = Math.max(2, RADIUS_SCALE(o.weight));
    const grown = base * Math.pow(k, 0.1);
    return compact ? grown : Math.min(grown, base + 4 * unitPerPx);
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

  function orgRenderX(o: Org, fanScale = spiderFanScale(transform.k)): number {
    return (o._x as number) + (o._rx ?? 0) * fanScale;
  }

  function orgRenderY(o: Org, fanScale = spiderFanScale(transform.k)): number {
    return (o._y as number) + (o._ry ?? 0) * fanScale;
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
    const fanScale = spiderFanScale(k);
    if (!force && fanScale === orgMarkFanScale) return;
    orgMarkFanScale = fanScale;
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .attr("cx", (o) => orgRenderX(o, fanScale))
      .attr("cy", (o) => orgRenderY(o, fanScale));
    gHit
      .selectAll<SVGCircleElement, Org>("circle.org-hit")
      .attr("cx", (o) => orgRenderX(o, fanScale))
      .attr("cy", (o) => orgRenderY(o, fanScale));
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
  }

  // (Re)fit the projection to the current viewBox and push fresh coordinates to
  // the map paths and org circles. Safe to call before circles exist (init) or
  // on every resize.
  function project(): void {
    if (!nationFeature) return;
    hitK = NaN;
    orgMarkFanScale = NaN;
    projection.fitSize([W, H], nationFeature as never);
    gMap.selectAll<SVGPathElement, unknown>("path.state").attr("d", path as never);
    gMap.select<SVGPathElement>("path.nation").attr("d", path(nationFeature as never));
    for (const o of orgs) {
      o._rk = undefined;
      if (o.lng == null || o.lat == null) {
        o._x = undefined;
        o._y = undefined;
        continue;
      }
      const p = projection([o.lng, o.lat]);
      if (!p) {
        o._x = undefined;
        o._y = undefined;
        continue;
      }
      o._x = p[0];
      o._y = p[1];
    }
    assignSpiderOffsets();
    positionOrgMarks(transform.k, true);
    for (const p of places) {
      const xy = projection([p.lng, p.lat]);
      p._x = xy ? xy[0] : undefined;
      p._y = xy ? xy[1] : undefined;
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
    gOverlay.attr("transform", tStr);
    gHit.attr("transform", tStr);
    const fanScale = spiderFanScale(k);
    positionOrgMarks(k);

    const hot = hoverOrg ?? selectedOrg;
    const tourActive = tourIds.size > 0;
    // While a tour runs but no step is showing (tourRunning && !tourActive) the
    // map "blanks": everything dims, nothing is labelled. That makes each role
    // reveal read clearly and idles the breathing animation (cheaper on iOS).
    // Hit radii only depend on zoom, so only rewrite them when k changes.
    const hitChanged = hitK !== k;
    hitK = k;

    // Project to screen space once, drop off-screen dots, collect label candidates.
    const margin = 90;
    const candidates: Org[] = [];
    let shownCount = 0;
    for (const o of placeableOrgs) {
      if (o._x == null || o._y == null) {
        o._vis = false;
        continue;
      }
      const sx = transform.applyX(orgRenderX(o, fanScale));
      const sy = transform.applyY(orgRenderY(o, fanScale));
      o._sx = sx;
      o._sy = sy;
      const vis = sx >= -margin && sx <= W + margin && sy >= -margin && sy <= H + margin;
      o._vis = vis;
      if (!vis) continue;
      shownCount++;
      if (tourActive) {
        // During a walkthrough step only the highlighted set gets labels.
        if (tourIds.has(o.ncr_id) || hot?.ncr_id === o.ncr_id) candidates.push(o);
      } else if (!tourRunning && (hot?.ncr_id === o.ncr_id || shouldTryLabel(o, k))) {
        // Normal map. (During a blank beat — tourRunning && !tourActive — we
        // deliberately collect no candidates so nothing is labelled.)
        candidates.push(o);
      }
    }
    if (shownEl && !metricsPanel.hidden) shownEl.textContent = String(shownCount);

    candidates.sort(
      (a, b) =>
        Number(tourIds.has(b.ncr_id)) - Number(tourIds.has(a.ncr_id)) ||
        Number(selectedOrg?.ncr_id === b.ncr_id) - Number(selectedOrg?.ncr_id === a.ncr_id) ||
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
    const labelState = new Map<string, { x: number; y: number; font: number; text: string }>();
    const placed: Box[] = [];
    // Bound the animated/highlighted set so it stays cheap on iOS.
    const maxLabels = tourActive ? (compact ? 45 : 130) : labelLimit(k);
    const topSafe = compact && !tourActive ? 72 * unitPerPx : 0;
    const edgeSafe = compact && !tourActive ? 5 * unitPerPx : 2 * unitPerPx;
    const clusterRadius = (compact ? 24 : 18) * unitPerPx;
    const labeledClusters: Array<{ x: number; y: number }> = [];
    // On phones, inflate the collision box as you zoom in so labels spread out
    // (less information overload). Untouched on desktop and during the tour.
    const spacing = compact && !tourActive ? Math.min(2.05, 1 + Math.max(0, k - 1.8) * 0.24) : 1;
    for (const o of candidates) {
      if (placed.length >= maxLabels) break;
      const sx = o._sx as number;
      const sy = o._sy as number;
      const forceLabel = hot?.ncr_id === o.ncr_id;
      if (
        !forceLabel &&
        labeledClusters.some((p) => (p.x - sx) ** 2 + (p.y - sy) ** 2 <= clusterRadius ** 2)
      ) {
        continue;
      }
      const r = visualRadius(o, k);
      const text = labelText(o, k);
      const font = labelFontPx(o, k) * unitPerPx;
      const w = (Math.max(14, text.length * font * 0.56) + 5) * spacing;
      const h = (font + 5) * spacing;
      // Try a handful of spots so a blocked label nudges off its neighbour
      // instead of disappearing, while hugging its own bubble closely.
      const spots = [
        [sx, sy + font * 0.32],
        [sx, sy - r * 0.8 - 1],
        [sx, sy + r * 0.8 + font * 0.8],
        [sx + r * 0.8 + 1, sy + font * 0.32],
        [sx - r * 0.8 - 1, sy + font * 0.32],
      ];
      let chosen: { x: number; y: number; box: Box } | null = null;
      for (const [lx, ly] of spots) {
        const box: Box = { x0: lx - w / 2, x1: lx + w / 2, y0: ly - h * 0.7, y1: ly + h * 0.3 };
        if (box.x0 < edgeSafe || box.x1 > W - edgeSafe || box.y0 < topSafe || box.y1 > H - edgeSafe) continue;
        if (placed.some((p) => boxesOverlap(box, p))) continue;
        chosen = { x: lx, y: ly, box };
        break;
      }
      if (!chosen) continue;
      placed.push(chosen.box);
      if (!forceLabel) labeledClusters.push({ x: sx, y: sy });
      labelState.set(o.ncr_id, { x: chosen.x, y: chosen.y, font, text });
    }

    gOverlay.selectAll<SVGCircleElement, Org>("circle.org").each(function (o) {
      const node = this as SVGCircleElement;
      node.classList.toggle("hide", !o._vis);
      if (!o._vis) return;
      // Radius is set in transform-space (divided by the group scale) and only
      // when the zoom level actually changed for this dot.
      if (o._rk !== k) {
        node.setAttribute("r", String(visualRadius(o, k) / k));
        o._rk = k;
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
    });

    gHit.selectAll<SVGCircleElement, Org>("circle.org-hit").each(function (o) {
      const node = this as SVGCircleElement;
      node.classList.toggle("hide", !o._vis);
      if (!o._vis || !hitChanged) return;
      // Keep hit targets on the old growth curve so smaller visual bubbles do
      // not become harder to click.
      const hitRadius = Math.max(2, RADIUS_SCALE(o.weight) * Math.pow(k, 0.1));
      const minHitRadius = (compact ? 16 : 10) * unitPerPx;
      node.setAttribute("r", String(Math.max(hitRadius, minHitRadius) / k));
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
      node.classList.toggle("hot-label", hot?.ncr_id === o.ncr_id);
      node.classList.toggle("selected-label", selectedOrg?.ncr_id === o.ncr_id);
      node.classList.toggle("tour-flash", tourActive && !!state);
    });

    const placeBlockers = [...placed];
    for (const o of placeableOrgs) {
      if (!o._vis || o._sx == null || o._sy == null) continue;
      const r = visualRadius(o, k) + 2 * unitPerPx;
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

  function renderStats(): void {
    const mapped = placeableOrgs.length;
    const shown = placeableOrgs.reduce((n, o) => n + (o._vis ? 1 : 0), 0);
    const top = createEl("div", "nerc-metrics-top");
    const kpi = (label: string, value: number): HTMLElement => {
      const box = createEl("div", "nerc-kpi");
      const strong = createEl("strong", undefined, String(value));
      box.append(createEl("span", undefined, label), strong);
      return box;
    };
    const shownKpi = kpi("Shown in view", shown);
    shownEl = shownKpi.querySelector("strong");
    top.append(shownKpi, kpi("Mapped", mapped));

    metricsBody.replaceChildren(
      top,
      statSection("By organization type", tally(placeableOrgs.map((o) => o.org_type), "other"), (k) => typeLabel(k)),
    );
  }

  function renderTooltip(o: Org): void {
    tooltip.replaceChildren();
    tooltip.append(
      createEl("div", "tt-acronym", orgAcronym(o)),
      createEl("div", "tt-name", o.entity_name),
      createEl("div", "tt-sub", `${o.region ?? "No region"} | ${typeLabel(o.org_type)} | ${o.role_count} roles | weight ${o.weight}`),
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
      .classed("selected-label", (d) => selectedOrg?.ncr_id === d.ncr_id);
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
    panelBody.append(title, createEl("p", "p-sub", `${o.ncr_id}${o.seed ? " | seed record" : ""} | ${typeLabel(o.org_type)}`));

    const dl = createEl("dl");
    const roles = createEl("div", "p-roles");
    o.roles.forEach((role) => {
      const row = createEl("div", "p-role");
      row.append(createRolePill(role), createEl("span", undefined, roleFullName(role)));
      roles.append(row);
    });
    addDlRow(dl, `Roles (${o.role_count})`, roles);
    addDlRow(dl, "Role weight", `${o.weight}${o.is_iso_rto ? " | ISO/RTO scale" : ""}`);
    addDlRow(dl, "NERC region", o.region ?? "-");
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
    }
    panel.hidden = false;
  }

  function closePanel(): void {
    panel.hidden = true;
    selectedOrg = null;
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
    const scale = Math.min(500, Math.max(transform.k, o.is_iso_rto ? 3.2 : 4.2));
    const next = zoomIdentity.translate(W / 2, H / 2).scale(scale).translate(-o._x, -o._y);
    animateTransform(next, duration);
  }

  function selectOrg(o: Org, opts: { center?: boolean } = {}): void {
    stopTour();
    selectedOrg = o;
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
      .scaleExtent([0.72, 500])
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
    tourStatus.hidden = true;
    setPlayState(false);
    if (placeableOrgs.length) redraw();
    else applyTourClasses();
  }

  function showTourStep(label: string, match: (o: Org) => boolean, index: number, total: number): void {
    const matches = placeableOrgs.filter(match);
    tourIds = new Set(matches.map((o) => o.ncr_id));
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

    const topoAny = topo as { objects: Record<string, unknown> };
    const states = feature(topo as never, topoAny.objects.states as never) as never as { features: unknown[] };
    nationFeature = feature(topo as never, topoAny.objects.nation as never) as never;

    gMap.selectAll("path.state").data(states.features).join("path").attr("class", "state");
    gMap.append("path").attr("class", "nation");

    measure();
    project();
    placeableOrgs = orgs.filter((o) => o._x != null && o._y != null);
    const visibleOrder = [...placeableOrgs].sort((a, b) => a.weight - b.weight || a.role_count - b.role_count);
    const hitOrder = [...placeableOrgs].sort((a, b) => b.weight - a.weight || b.role_count - a.role_count);

    const visibleCircles = gOverlay
      .selectAll("circle.org")
      .data(visibleOrder, (o: unknown) => (o as Org).ncr_id)
      .join("circle")
      .attr("class", (o) => "org" + (o.geo_confidence === "ESTIMATED" || o.geo_confidence === "LOW" ? " estimated" : ""))
      .attr("fill", (o) => safeColor(o.color))
      .attr("cx", (o) => orgRenderX(o))
      .attr("cy", (o) => orgRenderY(o))
      .attr("r", (o) => visualRadius(o, transform.k))
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
      .attr("r", (o) => Math.max(10, RADIUS_SCALE(o.weight)))
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
