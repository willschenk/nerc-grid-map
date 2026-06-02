import { geoAlbersUsa, geoPath } from "d3-geo";
import { scaleSqrt } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import { feature } from "topojson-client";
import { ROLE_FULL_NAMES } from "../roles.mjs";

type RoleMode = "OR" | "AND";

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
};

type OrgsPayload = {
  generated_at?: string;
  source_file?: string;
  count?: number;
  orgs: Org[];
};

type PassOptions = {
  ignoreRoles?: boolean;
  ignoreRegions?: boolean;
  ignoreTypes?: boolean;
  ignoreConfidence?: boolean;
  ignoreQuick?: boolean;
  ignoreMinCount?: boolean;
};

const W = 960;
const H = 600;
const RADIUS_SCALE = scaleSqrt().domain([1, 45]).range([4, 48]);

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

const QUICK_LABELS: Record<string, string> = {
  iso: "ISO / RTO",
  ba: "BA",
  review: "Needs review",
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

const REGION_ORDER = ["WECC", "MRO", "SPP", "SERC", "RFC", "RF", "NPCC", "TRE", "FRCC"];

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

function roleOrder(): string[] {
  const roles = Object.keys(ROLE_FULL_NAMES);
  return ["BA", ...roles.filter((r) => r !== "BA")];
}

function uniqueCount(values: Array<string | null | undefined>): number {
  return new Set(values.filter((v): v is string => Boolean(v))).size;
}

function regionRank(region: string): number {
  const idx = REGION_ORDER.indexOf(region);
  return idx === -1 ? REGION_ORDER.length : idx;
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
  const gOverlay = svg.append("g").attr("class", "overlay");
  const gLabels = svg.append("g").attr("class", "labels");

  const tooltip = byId<HTMLElement>("nerc-tooltip");
  const panel = byId<HTMLElement>("nerc-panel");
  const panelBody = byId<HTMLElement>("nerc-panel-body");
  const infoPanel = byId<HTMLElement>("nerc-info-panel");
  const statEl = byId<HTMLElement>("nerc-stat");
  const loadingEl = byId<HTMLElement>("nerc-loading");
  const tourStatus = byId<HTMLElement>("nerc-tour-status");
  const activeFiltersEl = byId<HTMLElement>("nerc-active-filters");
  const slider = byId<HTMLInputElement>("nerc-mincount");
  const sliderVal = byId<HTMLElement>("nerc-mincount-val");
  const modeBtn = byId<HTMLButtonElement>("nerc-mode");

  const statVisible = byId<HTMLElement>("nerc-stat-visible");
  const statTotal = byId<HTMLElement>("nerc-stat-total");
  const statIso = byId<HTMLElement>("nerc-stat-iso");
  const statBa = byId<HTMLElement>("nerc-stat-ba");
  const statRegion = byId<HTMLElement>("nerc-stat-region");

  const projection = geoAlbersUsa();
  const path = geoPath(projection);

  let transform: ZoomTransform = zoomIdentity;
  let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let orgs: Org[] = [];
  let placeableOrgs: Org[] = [];
  let selectedOrg: Org | null = null;
  let hoverOrg: Org | null = null;
  let tourIds = new Set<string>();
  let tourTimers: number[] = [];

  const selRoles = new Set<string>();
  const selRegions = new Set<string>();
  const selTypes = new Set<string>();
  const selConfidence = new Set<string>();
  const quickFilters = new Set<string>();
  let roleMode: RoleMode = "OR";
  let minCount = 1;

  function colorFor(role: string): string {
    const el = document.querySelector(`.nerc-role[data-role="${CSS.escape(role)}"] .nerc-dot`) as HTMLElement | null;
    return el ? getComputedStyle(el).backgroundColor : "#777";
  }

  function createRolePill(role: string, full = false): HTMLSpanElement {
    const pill = createEl("span", "nerc-rolepill", full ? `${role} - ${roleFullName(role)}` : role);
    pill.style.backgroundColor = colorFor(role);
    return pill;
  }

  function matchesQuick(o: Org): boolean {
    if (quickFilters.has("iso") && !o.is_iso_rto) return false;
    if (quickFilters.has("ba") && !o.roles.includes("BA")) return false;
    if (
      quickFilters.has("review") &&
      o.geo_needs_review !== true &&
      o.geo_confidence !== "LOW" &&
      o.geo_confidence !== "ESTIMATED"
    ) {
      return false;
    }
    return true;
  }

  function passes(o: Org, opts: PassOptions = {}): boolean {
    if (!opts.ignoreMinCount && o.role_count < minCount) return false;
    if (!opts.ignoreQuick && !matchesQuick(o)) return false;
    if (!opts.ignoreRegions && selRegions.size && !(o.region && selRegions.has(o.region))) return false;
    if (!opts.ignoreTypes && selTypes.size && !(o.org_type && selTypes.has(o.org_type))) return false;
    if (!opts.ignoreConfidence && selConfidence.size && !selConfidence.has(o.geo_confidence)) return false;
    if (!opts.ignoreRoles && selRoles.size) {
      const roles = [...selRoles];
      const ok = roleMode === "AND" ? roles.every((r) => o.roles.includes(r)) : roles.some((r) => o.roles.includes(r));
      if (!ok) return false;
    }
    return true;
  }

  function filteredOrgs(opts: PassOptions = {}): Org[] {
    return placeableOrgs.filter((o) => passes(o, opts));
  }

  function labelText(o: Org, k: number): string {
    if (k < 2.2) return orgAcronym(o);
    return shortName(o.entity_name);
  }

  function shouldTryLabel(o: Org, k: number): boolean {
    if (k < 1.25) return true;
    if (k < 2.0) return o.weight >= 4;
    if (k < 3.4) return o.weight >= 2;
    return true;
  }

  function labelFont(o: Org, k: number): number {
    if (k < 1.25) return o.weight >= 35 ? 11 : 8.5;
    if (k < 2.2) return o.weight >= 20 ? 11 : 9;
    return o.weight >= 35 ? 12 : o.weight >= 15 ? 10 : 8.5;
  }

  function boxesOverlap(
    a: { x0: number; x1: number; y0: number; y1: number },
    b: { x0: number; x1: number; y0: number; y1: number },
  ): boolean {
    return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
  }

  function redraw(): void {
    const k = transform.k;
    const labelState = new Map<string, { x: number; y: number; font: number; text: string }>();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];

    const labelCandidates = placeableOrgs
      .filter((o) => {
        if (!passes(o)) return false;
        return tourIds.has(o.ncr_id) || selectedOrg?.ncr_id === o.ncr_id || hoverOrg?.ncr_id === o.ncr_id || shouldTryLabel(o, k);
      })
      .sort(
        (a, b) =>
          Number(tourIds.has(b.ncr_id)) - Number(tourIds.has(a.ncr_id)) ||
          Number(selectedOrg?.ncr_id === b.ncr_id) - Number(selectedOrg?.ncr_id === a.ncr_id) ||
          b.weight - a.weight ||
          b.role_count - a.role_count ||
          a.entity_name.localeCompare(b.entity_name),
      );

    for (const o of labelCandidates) {
      if (o._x == null || o._y == null) continue;
      const cx = transform.applyX(o._x);
      const cy = transform.applyY(o._y);
      const r = Math.max(2, RADIUS_SCALE(o.weight) / Math.sqrt(k));
      const text = labelText(o, k);
      const font = labelFont(o, k);
      const centered = k < 1.55;
      const x = cx;
      const y = centered ? cy + font * 0.35 : cy - r - 3;
      const w = Math.max(16, text.length * font * 0.62) + 7;
      const h = font + 6;
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h * 0.75, y1: y + h * 0.35 };
      if (placed.some((p) => boxesOverlap(box, p))) continue;
      placed.push(box);
      labelState.set(o.ncr_id, { x, y, font, text });
    }

    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .each(function (o) {
        const node = this as SVGCircleElement;
        const pass = passes(o);
        node.classList.toggle("hide", !pass);
        if (!pass || o._x == null || o._y == null) return;
        node.classList.toggle("labeled", labelState.has(o.ncr_id));
        const cx = transform.applyX(o._x);
        const cy = transform.applyY(o._y);
        const r = Math.max(2, RADIUS_SCALE(o.weight) / Math.sqrt(k));
        node.setAttribute("cx", String(cx));
        node.setAttribute("cy", String(cy));
        node.setAttribute("r", String(r));
      });

    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .each(function (o) {
        const node = this as SVGTextElement;
        const state = labelState.get(o.ncr_id);
        node.classList.toggle("dim", !state);
        if (!state) return;
        node.textContent = state.text;
        node.setAttribute("x", String(state.x));
        node.setAttribute("y", String(state.y));
        node.setAttribute("font-size", String(state.font));
      });

    applyHighlights();
    applyTourClasses();
    renderStats();
  }

  function renderStats(): void {
    const shown = filteredOrgs();
    const total = orgs.length;
    const iso = shown.filter((o) => o.is_iso_rto).length;
    const ba = shown.filter((o) => o.roles.includes("BA")).length;
    const regions = uniqueCount(shown.map((o) => o.region));
    statVisible.textContent = String(shown.length);
    statTotal.textContent = String(total);
    statIso.textContent = String(iso);
    statBa.textContent = String(ba);
    statRegion.textContent = String(regions);
    statEl.textContent =
      `${shown.length} of ${total} entities shown` + (transform.k > 1.05 ? ` | zoom ${transform.k.toFixed(1)}x` : "");
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
      .classed("selected", (d) => selectedOrg?.ncr_id === d.ncr_id)
      .classed("peer-dim", (d) => !!hoverOrg && hoverOrg.ncr_id !== d.ncr_id && passes(d));

    gLabels
      .selectAll<SVGTextElement, Org>("text.olabel")
      .classed("hot-label", (d) => hot?.ncr_id === d.ncr_id)
      .classed("selected-label", (d) => selectedOrg?.ncr_id === d.ncr_id)
      .classed("peer-dim", (d) => !!hoverOrg && hoverOrg.ncr_id !== d.ncr_id);
  }

  function applyTourClasses(): void {
    const active = tourIds.size > 0;
    gOverlay
      .selectAll<SVGCircleElement, Org>("circle.org")
      .classed("tour-flash", (d) => active && tourIds.has(d.ncr_id))
      .classed("tour-dim", (d) => active && passes(d) && !tourIds.has(d.ncr_id));

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

  function animateTransform(next: ZoomTransform, duration = 350): void {
    if (!zoomBehavior) {
      transform = next;
      gMap.attr("transform", transform.toString());
      redraw();
      return;
    }
    svg.transition().duration(duration).call(zoomBehavior.transform as never, next);
  }

  function homeView(duration = 350): void {
    animateTransform(zoomIdentity, duration);
  }

  function fitTo(list: Org[], duration = 450): void {
    const pts = list.filter((o) => o._x != null && o._y != null);
    if (!pts.length) {
      homeView(duration);
      return;
    }
    if (pts.length === 1) {
      centerOnOrg(pts[0], duration);
      return;
    }

    const xs = pts.map((o) => o._x as number);
    const ys = pts.map((o) => o._y as number);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const dx = Math.max(30, maxX - minX);
    const dy = Math.max(30, maxY - minY);
    const scale = Math.min(12, Math.max(0.85, 0.84 / Math.max(dx / W, dy / H)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const next = zoomIdentity.translate(W / 2, H / 2).scale(scale).translate(-cx, -cy);
    animateTransform(next, duration);
  }

  function centerOnOrg(o: Org, duration = 450): void {
    if (o._x == null || o._y == null) return;
    const scale = Math.min(8, Math.max(transform.k, o.is_iso_rto ? 3.2 : 4.2));
    const next = zoomIdentity.translate(W / 2, H / 2).scale(scale).translate(-o._x, -o._y);
    animateTransform(next, duration);
  }

  function selectOrg(o: Org, opts: { center?: boolean } = {}): void {
    stopTour();
    selectedOrg = o;
    infoPanel.hidden = true;
    renderPanel(o);
    hideTooltip();
    if (opts.center) centerOnOrg(o);
    else redraw();
    applyHighlights();
  }

  function renderActiveFilters(): void {
    activeFiltersEl.replaceChildren();
    const frag = document.createDocumentFragment();

    const addChip = (label: string, remove: () => void) => {
      const btn = createEl("button", "nerc-pill nerc-filter-chip", `${label} x`);
      btn.type = "button";
      btn.addEventListener("click", () => {
        remove();
        syncControls();
        updateView({ stopTourFirst: true });
      });
      frag.append(btn);
    };

    if (minCount > 1) addChip(`Min roles ${minCount}`, () => {
      minCount = 1;
      slider.value = "1";
      sliderVal.textContent = "1";
    });
    [...quickFilters].sort().forEach((q) => addChip(QUICK_LABELS[q] ?? q, () => quickFilters.delete(q)));
    [...selRoles].sort().forEach((role) => addChip(`Role ${role}`, () => selRoles.delete(role)));
    [...selRegions].sort((a, b) => regionRank(a) - regionRank(b) || a.localeCompare(b)).forEach((region) => addChip(`Region ${region}`, () => selRegions.delete(region)));
    [...selTypes].sort().forEach((type) => addChip(typeLabel(type), () => selTypes.delete(type)));
    [...selConfidence].sort().forEach((c) => addChip(confidenceLabel(c), () => selConfidence.delete(c)));

    activeFiltersEl.hidden = frag.childNodes.length === 0;
    activeFiltersEl.append(frag);
  }

  function updateRoleCounts(): void {
    document.querySelectorAll<HTMLElement>("[data-count-for]").forEach((el) => {
      const role = el.dataset.countFor;
      if (!role) return;
      const n = filteredOrgs({ ignoreRoles: true }).filter((o) => o.roles.includes(role)).length;
      el.textContent = n ? String(n) : "";
    });
  }

  function syncControls(): void {
    document.querySelectorAll<HTMLButtonElement>(".nerc-role").forEach((btn) => {
      btn.classList.toggle("active", !!btn.dataset.role && selRoles.has(btn.dataset.role));
    });
    document.querySelectorAll<HTMLButtonElement>(".nerc-region").forEach((btn) => {
      btn.classList.toggle("active", !!btn.dataset.region && selRegions.has(btn.dataset.region));
    });
    document.querySelectorAll<HTMLButtonElement>(".nerc-type").forEach((btn) => {
      btn.classList.toggle("active", !!btn.dataset.type && selTypes.has(btn.dataset.type));
    });
    document.querySelectorAll<HTMLButtonElement>(".nerc-confidence").forEach((btn) => {
      btn.classList.toggle("active", !!btn.dataset.confidence && selConfidence.has(btn.dataset.confidence));
    });
    document.querySelectorAll<HTMLButtonElement>(".nerc-quick-filter").forEach((btn) => {
      btn.classList.toggle("active", !!btn.dataset.quick && quickFilters.has(btn.dataset.quick));
    });
    modeBtn.dataset.mode = roleMode;
    modeBtn.textContent = `match: ${roleMode === "OR" ? "ANY" : "ALL"}`;
  }

  function updateView(opts: { stopTourFirst?: boolean } = {}): void {
    if (opts.stopTourFirst) stopTour();
    syncControls();
    redraw();
    renderActiveFilters();
    updateRoleCounts();
  }

  function renderRegionPills(): void {
    const container = byId<HTMLElement>("nerc-regions");
    const counts = new Map<string, number>();
    for (const o of orgs) {
      if (!o.region) continue;
      counts.set(o.region, (counts.get(o.region) ?? 0) + 1);
    }
    const regions = [...counts.keys()].sort((a, b) => regionRank(a) - regionRank(b) || a.localeCompare(b));
    container.replaceChildren();
    for (const region of regions) {
      const btn = createEl("button", "nerc-pill nerc-region", `${region} ${counts.get(region) ?? ""}`);
      btn.type = "button";
      btn.dataset.region = region;
      container.append(btn);
    }
  }

  function wireControls(): void {
    document.querySelectorAll<HTMLButtonElement>(".nerc-role").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.dataset.role;
        if (!role) return;
        if (selRoles.has(role)) selRoles.delete(role);
        else selRoles.add(role);
        updateView({ stopTourFirst: true });
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".nerc-region").forEach((btn) => {
      btn.addEventListener("click", () => {
        const region = btn.dataset.region;
        if (!region) return;
        if (selRegions.has(region)) selRegions.delete(region);
        else selRegions.add(region);
        updateView({ stopTourFirst: true });
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".nerc-type").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        if (!type) return;
        if (selTypes.has(type)) selTypes.delete(type);
        else selTypes.add(type);
        updateView({ stopTourFirst: true });
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".nerc-confidence").forEach((btn) => {
      btn.addEventListener("click", () => {
        const confidence = btn.dataset.confidence;
        if (!confidence) return;
        if (selConfidence.has(confidence)) selConfidence.delete(confidence);
        else selConfidence.add(confidence);
        updateView({ stopTourFirst: true });
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".nerc-quick-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        const quick = btn.dataset.quick;
        if (!quick) return;
        if (quickFilters.has(quick)) quickFilters.delete(quick);
        else quickFilters.add(quick);
        updateView({ stopTourFirst: true });
      });
    });

    modeBtn.addEventListener("click", () => {
      roleMode = roleMode === "OR" ? "AND" : "OR";
      updateView({ stopTourFirst: true });
    });

    slider.addEventListener("input", () => {
      minCount = Number(slider.value);
      sliderVal.textContent = slider.value;
      updateView({ stopTourFirst: true });
    });

    byId<HTMLButtonElement>("nerc-reset").addEventListener("click", () => {
      selRoles.clear();
      selRegions.clear();
      selTypes.clear();
      selConfidence.clear();
      quickFilters.clear();
      minCount = 1;
      roleMode = "OR";
      slider.value = "1";
      sliderVal.textContent = "1";
      selectedOrg = null;
      hoverOrg = null;
      panel.hidden = true;
      homeView();
      updateView({ stopTourFirst: true });
    });

    byId<HTMLButtonElement>("nerc-panel-close").addEventListener("click", closePanel);
    byId<HTMLButtonElement>("nerc-info-toggle").addEventListener("click", () => {
      infoPanel.hidden = !infoPanel.hidden;
    });
    byId<HTMLButtonElement>("nerc-info-close").addEventListener("click", closeInfo);
    byId<HTMLButtonElement>("nerc-fit-filtered").addEventListener("click", () => {
      stopTour();
      fitTo(filteredOrgs());
    });
    byId<HTMLButtonElement>("nerc-zoom-home").addEventListener("click", () => {
      stopTour();
      homeView();
    });
    byId<HTMLButtonElement>("nerc-zoom-in").addEventListener("click", () => {
      stopTour();
      if (zoomBehavior) svg.transition().duration(220).call(zoomBehavior.scaleBy as never, 1.35);
    });
    byId<HTMLButtonElement>("nerc-zoom-out").addEventListener("click", () => {
      stopTour();
      if (zoomBehavior) svg.transition().duration(220).call(zoomBehavior.scaleBy as never, 0.74);
    });
    byId<HTMLButtonElement>("nerc-replay-tour").addEventListener("click", () => startTour());

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        stopTour();
        closePanel();
        closeInfo();
        hideTooltip();
      }
    });
  }

  function setupZoom(): void {
    zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.8, 12])
      .on("zoom", (ev) => {
        transform = ev.transform;
        gMap.attr("transform", transform.toString());
        redraw();
      });
    svg.call(zoomBehavior);
    svg.on("dblclick.zoom", null);
    svg.on("click", () => {
      closePanel();
      hideTooltip();
    });
  }

  function stopTour(): void {
    tourTimers.forEach((timer) => window.clearTimeout(timer));
    tourTimers = [];
    tourIds = new Set();
    tourStatus.hidden = true;
    if (placeableOrgs.length) redraw();
    else applyTourClasses();
  }

  function showTourStep(label: string, description: string, match: (o: Org) => boolean): void {
    const matches = filteredOrgs().filter(match);
    tourIds = new Set(matches.map((o) => o.ncr_id));
    tourStatus.replaceChildren(
      createEl("span", "tour-kicker", "Role focus"),
      createEl("strong", "tour-title", label),
      createEl("span", "tour-sub", `${matches.length} entities highlighted | ${description}`),
    );
    tourStatus.hidden = matches.length === 0;
    redraw();
  }

  function startTour(): void {
    stopTour();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const steps = [
      { label: "ISOs and RTOs", description: "regional grid and market operators", match: (o: Org) => o.is_iso_rto },
      ...roleOrder().map((role) => ({
        label: ROLE_TOUR_LABELS[role] ?? `${roleFullName(role)} (${role})`,
        description: roleFullName(role),
        match: (o: Org) => o.roles.includes(role),
      })),
    ].filter((step) => filteredOrgs().some(step.match));

    const firstStepMs = 900;
    const stepMs = 1700;
    steps.forEach((step, idx) => {
      tourTimers.push(window.setTimeout(() => showTourStep(step.label, step.description, step.match), firstStepMs + idx * stepMs));
    });
    tourTimers.push(window.setTimeout(() => stopTour(), firstStepMs + steps.length * stepMs + 900));
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
    const nation = feature(topo as never, topoAny.objects.nation as never) as never;
    projection.fitSize([W, H], nation as never);

    gMap.selectAll("path.state").data(states.features).join("path").attr("class", "state").attr("d", path as never);
    gMap.append("path").attr("class", "nation").attr("d", path(nation as never));

    for (const o of orgs) {
      if (o.lng == null || o.lat == null) continue;
      const p = projection([o.lng, o.lat]);
      if (!p) continue;
      o._x = p[0];
      o._y = p[1];
    }
    placeableOrgs = orgs.filter((o) => o._x != null && o._y != null);
    const ordered = [...placeableOrgs].sort((a, b) => a.weight - b.weight);

    gOverlay
      .selectAll("circle.org")
      .data(ordered, (o: unknown) => (o as Org).ncr_id)
      .join("circle")
      .attr("class", (o) => "org" + (o.geo_confidence === "ESTIMATED" || o.geo_confidence === "LOW" ? " estimated" : ""))
      .attr("fill", (o) => safeColor(o.color))
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (o) => `${orgAcronym(o)} ${o.entity_name}`)
      .on("mouseenter", (ev, o) => {
        hoverOrg = o;
        applyHighlights();
        showTooltip(o, ev as MouseEvent);
      })
      .on("mousemove", (ev, o) => showTooltip(o, ev as MouseEvent))
      .on("mouseleave", () => {
        hoverOrg = null;
        applyHighlights();
        hideTooltip();
      })
      .on("focus", function (_ev, o) {
        hoverOrg = o;
        applyHighlights();
        const rect = (this as SVGCircleElement).getBoundingClientRect();
        showTooltipAt(o, rect.right, rect.top);
      })
      .on("blur", () => {
        hoverOrg = null;
        applyHighlights();
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
        selectOrg(o);
      });

    gLabels
      .selectAll("text.olabel")
      .data(ordered, (o: unknown) => (o as Org).ncr_id)
      .join("text")
      .attr("class", "olabel")
      .text((o) => orgAcronym(o));

    const maxRoles = Math.max(...orgs.map((o) => o.role_count), 1);
    slider.max = String(maxRoles);
    renderRegionPills();
    setupZoom();
    wireControls();
    loadingEl.style.display = "none";
    updateView();
    window.setTimeout(() => startTour(), 1200);
  }

  init().catch((err) => {
    console.error(err);
    loadingEl.textContent = "Could not load map data.";
  });
}
