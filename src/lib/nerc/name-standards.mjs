// Machine-readable parts of docs/standards/name-shortest.md.
// This module audits researched labels; it does not shorten or rewrite them.

export const NAME_SHORTEST_MIN = 3;
export const NAME_SHORTEST_BEST_MAX = 8;
export const NAME_SHORTEST_PREFERRED_MAX = 16;
export const NAME_SHORTEST_HARD_MAX = 22;

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
  const shortestSource = String(entry?.shortest_source ?? "").trim();
  const issues = [];

  if (!label) {
    issues.push("missing_shortest");
    return issues;
  }

  const projectOwnerProvided = shortestSource === "user_provided";
  const actualShortName =
    shortestType === "alias_code" || shortestType === "acronym" || projectOwnerProvided;

  if (label.length > NAME_SHORTEST_HARD_MAX) {
    if (!actualShortName || !shortestSource) issues.push("over_22_characters");
    else issues.push("documented_alias_over_22");
  } else if (label.length > NAME_SHORTEST_PREFERRED_MAX) {
    issues.push("length_17_to_22");
  }

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