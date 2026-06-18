// Machine-readable parts of docs/standards/name-shortest.md.
// This module audits researched labels; it does not shorten or rewrite them.

export const NAME_SHORTEST_MIN = 3;
export const NAME_SHORTEST_BEST_MAX = 8;
export const NAME_SHORTEST_PREFERRED_MAX = 12;
export const NAME_SHORTEST_HARD_MAX = 15;

export const NAME_REVIEW_STATUS_APPROVED = "approved";

export const NAME_SHORTEST_TYPES = new Set([
  "alias_code",
  "acronym",
  "parent_project",
  "meaningful_name",
  "location",
]);

const GENERIC_LABELS = new Set([
  "AND",
  "THE",
  "ONE",
  "WATER",
  "POWER",
  "COMPANY",
  "CORPORATION",
  "UTILITY",
  "DEPARTMENT",
  "CITY",
  "TOWN",
]);

const LEGAL_WORD_RE =
  /\b(?:LLC|L\.L\.C\.?|INC(?:ORPORATED)?\.?|LP|L\.P\.?|COMPANY|CORPORATION|CORP\.?)\b/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizedNameLabel(label) {
  return String(label ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function nameShortestIssues(entry) {
  const label = String(entry?.shortest ?? "").trim();
  const shortestType = String(entry?.shortest_type ?? "").trim();
  const notes = String(entry?.review_notes ?? "").trim();
  const issues = [];

  if (!label) {
    issues.push("missing_shortest");
    return issues;
  }

  if (label.length > NAME_SHORTEST_HARD_MAX) {
    if (shortestType !== "alias_code" || !notes) issues.push("over_15_characters");
    else issues.push("documented_alias_over_15");
  } else if (label.length > NAME_SHORTEST_PREFERRED_MAX) {
    issues.push("length_13_to_15");
  }

  const actualShortName =
    shortestType === "alias_code" || shortestType === "acronym";
  if (label.length < NAME_SHORTEST_MIN && !actualShortName) {
    issues.push("under_3_without_alias_evidence");
  }
  if (/^[A-Za-z]{2}$/.test(label) && !actualShortName) {
    issues.push("two_letter_label_needs_alias_evidence");
  }
  if (GENERIC_LABELS.has(normalizedNameLabel(label)) && !actualShortName) {
    issues.push("generic_label");
  }
  if (LEGAL_WORD_RE.test(label)) {
    issues.push("legal_suffix_in_shortest");
  }
  if (/\s{2,}/.test(label) || label !== label.trim()) {
    issues.push("whitespace_cleanup");
  }
  return issues;
}

export function isApprovedNameReview(entry) {
  if (entry?.review_status !== NAME_REVIEW_STATUS_APPROVED) return false;
  if (!NAME_SHORTEST_TYPES.has(entry?.shortest_type)) return false;
  if (!String(entry?.shortest_source ?? "").trim()) return false;
  if (!ISO_DATE_RE.test(String(entry?.reviewed_at ?? ""))) return false;
  return !nameShortestIssues(entry).some((issue) =>
    issue === "missing_shortest" ||
    issue === "over_15_characters" ||
    issue === "under_3_without_alias_evidence" ||
    issue === "two_letter_label_needs_alias_evidence" ||
    issue === "generic_label" ||
    issue === "legal_suffix_in_shortest" ||
    issue === "whitespace_cleanup"
  );
}
