// Build-time fold for multiple NERC registrations that share one headquarters.
// Unions roles onto the canonical org, attaches combined_members for the detail
// panel, and drops satellite rows from the published org list.

import { enrichOrg } from "./enrich.mjs";

/**
 * @param {Array<Record<string, unknown>>} orgs enriched org records
 * @param {{ combines?: Array<{ canonical: string, members?: string[], label?: string, summary?: string, display_name?: string }> }} config
 * @returns {{ orgs: Array<Record<string, unknown>>, folded: number }}
 */
export function applyMapCombines(orgs, config) {
  const combines = config?.combines ?? [];
  if (!combines.length) return { orgs, folded: 0 };

  const byId = new Map(orgs.map((o) => [o.ncr_id, o]));
  const absorbed = new Set();

  for (const group of combines) {
    const canonical = byId.get(group.canonical);
    if (!canonical) continue;

    const members = (group.members ?? [])
      .map((id) => byId.get(id))
      .filter(Boolean);
    if (!members.length) continue;

    const roleSet = new Set(canonical.roles ?? []);
    /** @type {Array<{ ncr_id: string, entity_name: string, region: string | null, roles: string[] }>} */
    const combinedMembers = [];
    for (const m of members) {
      for (const role of m.roles ?? []) roleSet.add(role);
      combinedMembers.push({
        ncr_id: m.ncr_id,
        entity_name: m.entity_name,
        region: m.region ?? null,
        roles: m.roles ?? [],
      });
      absorbed.add(m.ncr_id);
    }

    const mergedRoles = [...roleSet].sort();

    const regionSet = new Set();
    for (const r of canonical.regions ?? []) if (r) regionSet.add(r);
    if (canonical.region) regionSet.add(canonical.region);
    for (const m of members) {
      for (const r of m.regions ?? []) if (r) regionSet.add(r);
      if (m.region) regionSet.add(m.region);
    }
    const mergedRegions = [...regionSet].sort();

    const merged = enrichOrg({
      ...canonical,
      roles: mergedRoles,
      region: canonical.region ?? mergedRegions[0] ?? null,
      ...(mergedRegions.length > 1 ? { regions: mergedRegions } : {}),
    });
    merged.combined_members = combinedMembers;
    if (group.summary) merged.map_combine_summary = group.summary;
    if (group.display_name) merged.map_combine_label = group.display_name;
    byId.set(group.canonical, merged);
  }

  if (!absorbed.size) return { orgs, folded: 0 };

  const out = orgs
    .filter((o) => !absorbed.has(o.ncr_id))
    .map((o) => byId.get(o.ncr_id) ?? o);

  return { orgs: out, folded: absorbed.size };
}
