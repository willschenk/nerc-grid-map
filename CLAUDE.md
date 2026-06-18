# Claude project handoff

Read [AGENTS.md](AGENTS.md) and [LESSONS.md](LESSONS.md) before making changes.
Those files remain authoritative for repository hygiene, map invariants, testing,
commits, pushes, and shared-working-tree safety.

## Organization-label work

The organization-label rules and workflow are split by responsibility:

| Location | Purpose |
| --- | --- |
| `docs/standards/name-shortest.md` | Authoritative human naming rules |
| `src/lib/nerc/name-standards.mjs` | Machine-readable limits and approval validation |
| `scripts/nerc/build-name-queue.mjs` | Builds the complete review queue |
| `scripts/nerc/cursor-name-queue.md` | General one-record review workflow |
| `src/data/nerc/name-queue.jsonl` | Ordered review input, including hidden/source-only records |
| `src/data/nerc/name-queue.csv` | Human-readable form of the same queue |
| `src/data/nerc/org-names.json` | Manual source of truth for reviewed names |
| `scripts/nerc/build-orgs.mjs` | Applies reviewed names to registry and supplemental records |

Do not encode naming policy in the renderer. Do not edit generated
`public/nerc/orgs*.json` directly.

## Batch 001: first 500 entries

This batch is in progress. Continue only when the user explicitly asks Claude
to update the next names.

Batch membership is pinned to the currently committed
`src/data/nerc/name-queue.jsonl`:

- Queue rows: `order` 1 through 500, inclusive
- Queue Git object: `6e18b83d4ce8abd7315200fcffd2d8750d70618a`
- First record: `NCR05315` - Pend Oreille County Public Utility District No. 1
- Last record: `SUP-reedy-creek-improvement-district` - Reedy Creek Improvement District
- Source mix: 433 geocoded records and 67 supplemental records
- Map status: 343 published, 100 combined members, 52 retired seeds, 5 source-only

**Do not run `npm run nerc:name-queue` or `nerc:name-queue-all` before or during
Batch 001.** Regeneration removes approved rows and changes order numbers. The
committed queue is the immutable batch manifest until all 500 records are done.

## Required edit behavior

For each Batch 001 row:

1. Read `docs/standards/name-shortest.md`.
2. Research the actual alias/code first, then the actual acronym.
3. Check the NERC record, OASIS, ISO/RTO material, official company/project
   website, public filings, press releases, and existing `area_aliases` when
   practical.
4. Inspect `collision_ids` and `nearby_collision_ids` from the queue row.
5. Update the matching `ncr_id` object in `src/data/nerc/org-names.json`.
6. Append a new object only when no matching `ncr_id` exists, which is expected
   for many supplemental records.
7. Never create a second object for an existing `ncr_id`.
8. Preserve `entity_name` exactly unless the user separately requests source
   long-name corrections.
9. Fill all review metadata:
   - `shortest_type`
   - `shortest_source`
   - `shortest_source_url` when available
   - `review_notes`
   - `review_status: "approved"`
   - `reviewed_at` as `YYYY-MM-DD`
10. Remove the approved record's line from
    `scripts/nerc/name-review-first-500.md`.
11. Keep `shortest` recognizable and evidence-backed. Do not invent utility
    codes merely to fit the renderer's current compact-token limit.

Allowed `shortest_type` values:

- `alias_code`
- `acronym`
- `parent_project`
- `meaningful_name`
- `location`

The researched `shortest` target is:

- Best: fewer than 9 characters
- Strong: 9-12 characters
- Avoid: 13-15 characters
- Hard practical maximum: 15 characters
- More than 15 only for an unavoidable actual alias, with evidence and notes

The map may derive a shorter rendered token. `current.shortest` and
`rendered_shortest` in the queue are intentionally separate.

## Scope boundaries

During Batch 001:

- Edit `src/data/nerc/org-names.json` for rows 1-500 only.
- Process only the next 20 lines in
  `scripts/nerc/name-review-first-500.md` during each run.
- Remove a worklist line only after that record is approved and validated.
- Do not edit renderer TypeScript/CSS, coordinates, roles, weights, map combines,
  area aliases, or supplemental organization definitions.
- Do not perform long-name spelling/capitalization corrections in source data;
  record them in `review_notes` for a separately scoped pass.
- Do not deploy unless the user explicitly requests deployment.
- Preserve unrelated working-tree changes.

If evidence is inconclusive, do not guess. Leave the record unapproved, explain
the blocker in `review_notes`, and count it under `Blocked` below.

## Batch and commit protocol

For each run:

1. Take the first 20 lines from
   `scripts/nerc/name-review-first-500.md`.
2. Review and update those 20 records only.
3. Delete each approved record's line from the worklist.
4. Leave blocked records in the worklist with the blocker documented in
   `review_notes`.
5. Validate JSON parsing and duplicate IDs.
6. Run the required checks.
7. Commit and push the coherent 20-record change.

## Validation

After each 20-record batch:

```bash
node -e 'const d=require("./src/data/nerc/org-names.json"); const ids=d.names.map(x=>x.ncr_id); if(ids.length!==new Set(ids).size) process.exit(1)'
npm run nerc:build
npm run nerc:payload-check
npm run ux-check
npm run check
```

Generated timestamp-only changes in `public/nerc/orgs*.json` must not be swept
into a commit accidentally. Name output changes are expected once reviewed names
are applied; stage only intentional files.

After all 500 records are approved or explicitly blocked:

1. Run `npm run nerc:name-queue`.
2. Confirm approved Batch 001 records leave the default queue.
3. Run `npm run nerc:qa`.
4. Compare representative desktop and mobile map views before any deployment.

## Batch progress

- Batch status: In progress
- Completed records: 20 / 500
- Approved records: 20
- Blocked records: 0
- Next queue order: 21
- Last completed `ncr_id`: `NCR13476`
- Last update: 2026-06-18
- Notes: Orders 1-20 were approved in commit `4cb1501`.
