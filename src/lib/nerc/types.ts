// NERC org data model. (Spec Part 2.2.) The runtime data lives in public/orgs.json,
// produced by scripts/nerc/build-orgs.mjs via enrichOrg().

export type NERCRegion = "MRO" | "WECC" | "SERC" | "RF" | "NPCC" | "Texas RE";

export type RoleTag =
  | "RC" | "BA" | "PC" | "TOP" | "TSP" | "TP"
  | "RSG" | "FRSG" | "RRSG" | "RP"
  | "TO" | "GO" | "GOP" | "LSE" | "DP" | "PSE";

// Standardized on HIGH | MEDIUM | LOW | ESTIMATED. The spec's Part 2 listed NONE;
// enrichOrg() maps NONE -> ESTIMATED so every record carries a usable coordinate.
export type GeoConfidence = "HIGH" | "MEDIUM" | "LOW" | "ESTIMATED";

export type OrgType =
  | "IOU" | "cooperative" | "municipal" | "federal"
  | "merchant" | "ISO_RTO" | "cca" | "other" | null;

export type NERCOrg = {
  // Identity
  ncr_id: string; // "NCR11516" - primary key
  entity_name: string;
  acronym: string;
  acronym_source: string | null;
  area_aliases?: string[];

  // Classification
  region: NERCRegion | null; // primary RE (first alphabetically when multi-RE)
  regions?: NERCRegion[]; // all REs from the compliance matrix (when >1)
  roles: RoleTag[]; // deduplicated, normalized
  role_count: number;
  is_private: boolean;

  // Location
  lat: number | null; // 4 decimals
  lng: number | null; // 4 decimals
  headquarters_address: string | null;
  city: string | null;
  state: string | null; // 2-letter US state or CA/MX province
  country: string; // "US" | "CA" | "MX"

  // Geocoding metadata
  geo_confidence: GeoConfidence;
  geo_source: string | null;
  geo_source_url: string | null;
  geo_notes: string;
  geo_needs_review: boolean;

  // Computed at build time
  weight: number; // sum of ROLE_WEIGHTS
  color: string; // precomputed "hsl(H, S%, L%)"
  is_iso_rto: boolean; // weight >= 35
  org_type: OrgType;
  parent_org: string | null; // NCR ID of parent if subsidiary
  eia_utility_id: number | null;

  // Provenance
  seed?: boolean; // true for hand-curated seed records (placeholder NCR ID)
};

// The raw geocoding-agent output, before enrichOrg(). (Spec Part 1.2.)
export type GeoRecord = {
  ncr_id: string;
  entity_name: string;
  acronym?: string | null;
  acronym_source?: string | null;
  region?: string;
  roles: string[];
  lat: number;
  lng: number;
  headquarters_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string;
  confidence?: string;
  source?: string;
  source_url?: string | null;
  notes?: string;
  skip?: boolean;
  skip_reason?: string;
  org_type?: OrgType;
  parent_org?: string | null;
  eia_utility_id?: number | null;
  seed?: boolean;
};
