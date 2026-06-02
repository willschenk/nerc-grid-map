// NERC functional role tables. Single source of truth for weights, colors, names,
// and normalization. Imported by build scripts (Node ESM) and the map page (Vite).
// Spec: nerc-map-instructions.md Parts 2 and 3.

// Role weight: grid-authority roles dominate dot size over asset/commercial roles.
// (Spec Part 3.2. The source spec listed GOP twice; deduplicated here.)
/** @type {Record<string, number>} */
export const ROLE_WEIGHTS = {
  RC: 10, // Reliability Coordinator - rarest, widest authority
  BA: 8, // Balancing Authority - real-time grid control
  PC: 7, // Planning Coordinator - wide-area planning authority
  TOP: 6, // Transmission Operator - real-time transmission control
  TSP: 5, // Transmission Service Provider - commercial grid access
  TP: 4, // Transmission Planner
  RSG: 3, // Reserve Sharing Group
  FRSG: 3, // Frequency Response Sharing Group
  RRSG: 3, // Reactive Reserve Sharing Group
  RP: 2, // Resource Planner
  TO: 2, // Transmission Owner
  GO: 2, // Generator Owner
  GOP: 2, // Generator Operator
  LSE: 2, // Load-Serving Entity
  DP: 1, // Distribution Provider
  PSE: 1, // Purchasing-Selling Entity
};

// Each role's fixed point in HSL space. An org's color is the weighted centroid
// of its roles' points, so similar role sets land at nearby colors. (Spec Part 3.3.2.)
/** @type {Record<string, number[]>} */
export const ROLE_ANCHORS = {
  RC: [260, 75, 45], // violet - rarest, most authoritative; stands alone
  BA: [230, 70, 42], // deep blue - close to RC (RC oversees BA)
  PC: [245, 65, 48], // blue-violet - close to RC/BA (planning authority)
  TOP: [175, 72, 38], // teal - transmission operations cluster
  TSP: [158, 65, 42], // green-teal - commercial twin of TOP
  TP: [145, 60, 44], // mid-green - planning twin of TSP
  TO: [15, 68, 48], // coral-orange - asset ownership cluster (warm)
  GO: [28, 72, 46], // orange - close to TO (parallel structure)
  GOP: [38, 65, 48], // amber - close to GO (operator of GO's assets)
  LSE: [95, 58, 42], // yellow-green - commercial load cluster
  PSE: [5, 65, 44], // red-orange - market player; warm, distinct from TO
  DP: [210, 25, 55], // muted blue - low saturation; supporting role
  RP: [200, 30, 52], // muted blue - close to DP
  RSG: [190, 30, 50], // muted teal - coordination roles; low saturation
  FRSG: [182, 28, 52],
  RRSG: [185, 26, 54],
};

/** @type {Record<string, string>} */
export const ROLE_FULL_NAMES = {
  RC: "Reliability Coordinator",
  BA: "Balancing Authority",
  PC: "Planning Coordinator",
  TOP: "Transmission Operator",
  TSP: "Transmission Service Provider",
  TP: "Transmission Planner",
  RSG: "Reserve Sharing Group",
  FRSG: "Frequency Response Sharing Group",
  RRSG: "Reactive Reserve Sharing Group",
  RP: "Resource Planner",
  TO: "Transmission Owner",
  GO: "Generator Owner",
  GOP: "Generator Operator",
  LSE: "Load-Serving Entity",
  DP: "Distribution Provider",
  PSE: "Purchasing-Selling Entity",
};

// Tier grouping for reference and optional UI ordering. (Spec Part 3.2.)
/** @type {Record<string, number>} */
export const ROLE_TIER = {
  RC: 1, BA: 1, PC: 1, TOP: 1, TSP: 1,
  TP: 2, RSG: 2, FRSG: 2, RRSG: 2, RP: 2,
  TO: 3, GO: 3, GOP: 3, LSE: 3, DP: 3, PSE: 3,
};

// Roles that make an org a "public" grid participant. An org holding none of
// these is private (asset-owner / market only). (Spec Part 5 is_private check.)
export const PUBLIC_ROLES = ["RC", "BA", "TOP", "PC", "TSP", "TP", "LSE", "DP"];

// Raw NCR Matrix column labels -> normalized role tag. (Spec Part 2.1.)
// Category and suffix variants are also handled procedurally in normalizeRoles.
/** @type {Record<string, string>} */
export const RAW_ROLE_MAP = {
  BA: "BA",
  DP: "DP",
  "GO CATEGORY 1": "GO",
  "GO CATEGORY 2": "GO",
  "GOP CATEGORY 1": "GOP",
  "GOP CATEGORY 2": "GOP",
  PCPA: "PC",
  PC: "PC",
  RC: "RC",
  RP: "RP",
  RSG: "RSG",
  TO: "TO",
  TOP: "TOP",
  TP: "TP",
  TSP: "TSP",
  DPUF: "DP",
  FRSG: "FRSG",
  RRSG: "RRSG",
  LSE: "LSE",
  PSE: "PSE",
};

// Every valid normalized tag.
export const KNOWN_ROLES = Object.keys(ROLE_WEIGHTS);

// NERC region centroids for last-resort geocoding estimation. (Spec Part 1.5 step 8.)
/** @type {Record<string, number[]>} */
export const REGION_CENTROIDS = {
  WECC: [40.5, -114.0],
  MRO: [44.5, -96.5],
  SPP: [37.5, -97.5],
  SERC: [34.5, -86.5],
  RFC: [40.5, -79.5],
  NPCC: [43.5, -73.5],
  TRE: [31.5, -97.5],
  FRCC: [28.0, -82.5],
};
