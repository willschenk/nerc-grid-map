#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const payloadPath = new URL("../../public/nerc/orgs-render.json", import.meta.url);

const payload = JSON.parse(await readFile(payloadPath, "utf8"));
const orgs = payload.orgs;
const failures = [];
const warnings = [];

if (!Array.isArray(orgs)) {
  failures.push("public/nerc/orgs-render.json must contain an orgs array.");
} else {
  if (payload.count !== orgs.length) {
    failures.push(`payload count ${payload.count} does not match org array length ${orgs.length}.`);
  }

  let majorOverviewCandidates = 0;
  let unlabeled = 0;

  for (const org of orgs) {
    const id = org.ncr_id ?? "(missing id)";
    const label = String(org.name_shortest || org.acronym || org.name_short || "").trim();
    const roles = Array.isArray(org.roles) ? org.roles : [];

    if (!org.ncr_id) failures.push("org is missing ncr_id.");
    if (!label) {
      unlabeled += 1;
      failures.push(`${id} has no compact map label.`);
    } else if (label.length > 8) {
      failures.push(`${id} compact map label "${label}" is longer than 8 characters.`);
    }

    if (!roles.length) failures.push(`${id} has no roles.`);
    if (org.out_of_footprint !== true && (!Number.isFinite(org.lat) || !Number.isFinite(org.lng))) {
      failures.push(`${id} has invalid mainland coordinates.`);
    }

    const highRoles = ["RC", "BA", "PC", "TOP", "TSP"];
    const hasHighRole = roles.some((role) => highRoles.includes(role));
    if ((hasHighRole || org.is_iso_rto || org.name_major || org.org_type === "federal") && (org.weight ?? 0) >= 14) {
      majorOverviewCandidates += 1;
    }

    if (/^(and|the|one|water|power|company|corporation|utility|department|city|town)$/i.test(label)) {
      warnings.push(`${id} compact label "${label}" looks generic.`);
    }
    if (/^[a-z]+[A-Z]/.test(label)) {
      warnings.push(`${id} compact label "${label}" has unusual casing.`);
    }
  }

  if (majorOverviewCandidates < 35) {
    failures.push(`only ${majorOverviewCandidates} major overview candidates found; expected at least 35.`);
  }
  if (unlabeled > 0) failures.push(`${unlabeled} orgs are missing compact labels.`);
}

console.log(`UX check: ${Array.isArray(orgs) ? orgs.length.toLocaleString() : 0} render orgs inspected.`);
if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  for (const warning of warnings.slice(0, 20)) console.log(`- ${warning}`);
  if (warnings.length > 20) console.log(`- ... ${warnings.length - 20} more warnings`);
}

if (failures.length) {
  console.error(`Failures (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("UX check passed.");
}
