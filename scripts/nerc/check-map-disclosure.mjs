#!/usr/bin/env node
// Regression guard: zoom-gated disclosure and compact label ordering.
// Usage: node scripts/nerc/check-map-disclosure.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tightenMapLabel, MAP_LABEL_MAX } from "../../src/lib/nerc/display-names.mjs";

const MAP_SRC = resolve("src/lib/nerc/map/nerc-org-map.ts");
const src = readFileSync(MAP_SRC, "utf8");
const errors = [];

const WEAK = new Set([
  "A", "AN", "AND", "AT", "BY", "CO", "COMPANY", "COOP", "COOPERATIVE", "CORP", "CORPORATION",
  "EAST", "ELECTRIC", "ENERGY", "FOR", "GAS", "GENERATION", "GENERATING", "LIGHT", "NEW", "NORTH",
  "OF", "OLD", "ONE", "POWER", "SOUTH", "THE", "TO", "UTILITY", "UTILITIES", "WATER", "WEST",
]);

function isWeakMapLabel(text) {
  const token = String(text ?? "").trim();
  if (!token) return true;
  const clean = token.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!clean || /\d/.test(clean)) return false;
  return WEAK.has(clean);
}

function compactMapLabel(text, maxLen = MAP_LABEL_MAX) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (raw.length <= maxLen && !isWeakMapLabel(raw)) return raw;

  const label = tightenMapLabel(raw, maxLen);
  if (label && label.length <= maxLen && !isWeakMapLabel(label)) return label;

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = tightenMapLabel(words[0], maxLen);
    if (first && first.length <= maxLen && !isWeakMapLabel(first)) return first;
    const initials = words.map((w) => w[0]).join("");
    if (initials.length >= 2 && initials.length <= maxLen && !isWeakMapLabel(initials)) return initials;
  }
  return null;
}

// --- Source structure checks ---
const canDisplayBlock = src.match(/function canDisplayOrg\([\s\S]*?\n  \}/);
if (!canDisplayBlock) {
  errors.push("could not find canDisplayOrg() in nerc-org-map.ts");
} else {
  const body = canDisplayBlock[0];
  if (/return true;\s*\}/.test(body) && !/overviewRevealK/.test(body)) {
    errors.push("canDisplayOrg() appears to return constant true (regression from a4408a3)");
  }
  if (!/overviewRevealK\(o\)/.test(body)) {
    errors.push("canDisplayOrg() missing overviewRevealK(o) gate");
  }
  if (!/fullRegistryRevealK\(\)/.test(body)) {
    errors.push("canDisplayOrg() missing fullRegistryRevealK() gate");
  }
  if (!/transmissionOwnerOnlyRevealK\(\)/.test(body)) {
    errors.push("canDisplayOrg() missing transmissionOwnerOnlyRevealK() gate");
  }
  if (!/pseMarketDisplayK\(\)/.test(body)) {
    errors.push("canDisplayOrg() missing pseMarketDisplayK() gate");
  }
  if (!/isGenerationOnly\(o\)/.test(body)) {
    errors.push("canDisplayOrg() missing isGenerationOnly(o) exclusion");
  }
}

if (/return \[midTight,\s*tiny\]/.test(src)) {
  errors.push("labelTextOptions() returns [midTight, tiny]; compact token must come first");
}

if (!/return \[tiny,\s*midTight\]/.test(src)) {
  errors.push("labelTextOptions() should return [tiny, midTight] at deeper zoom");
}

if (!/function isWeakMapLabel/.test(src)) {
  errors.push("missing isWeakMapLabel() helper for weak fragment rejection");
}

// --- Label fragment fixtures (mirrors runtime pick rules) ---
const LABEL_FIXTURES = [
  {
    label: "Connecticut Light and Power",
    name_shortest: "and",
    acronym: "CL&P",
    banned: ["and"],
    expectIncludes: ["CL", "CLP", "Connecticut", "CL&P"],
  },
  {
    label: "Hydro One",
    name_shortest: "One",
    acronym: "Hydro One",
    banned: ["One"],
    expectIncludes: ["Hydro"],
  },
  {
    label: "Madison Gas and Electric",
    name_shortest: "and",
    acronym: "MGE",
    banned: ["and"],
    expectIncludes: ["MGE"],
  },
  {
    label: "Muscatine Power & Water",
    name_shortest: "Water",
    acronym: "MP&W",
    banned: ["Water"],
    expectIncludes: ["MP", "Muscatine", "MP&W"],
  },
];

for (const fx of LABEL_FIXTURES) {
  const fromShortest = compactMapLabel(fx.name_shortest);
  const fromAcronym = compactMapLabel(fx.acronym);
  const fromName = compactMapLabel(fx.label);
  const picked = fromShortest ?? fromAcronym ?? fromName ?? tightenMapLabel(fx.acronym || fx.label, MAP_LABEL_MAX);

  for (const bad of fx.banned) {
    if (picked === bad) {
      errors.push(`label fixture "${fx.label}": picked banned fragment "${bad}"`);
    }
  }
  if (isWeakMapLabel(picked)) {
    errors.push(`label fixture "${fx.label}": picked weak token "${picked}"`);
  }
  const ok = fx.expectIncludes.some((needle) => picked.includes(needle));
  if (!ok) {
    errors.push(`label fixture "${fx.label}": picked "${picked}", expected one of ${fx.expectIncludes.join(", ")}`);
  }
}

if (errors.length) {
  console.error("check-map-disclosure FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("check-map-disclosure OK");
