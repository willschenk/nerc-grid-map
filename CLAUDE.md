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

This batch is prepared but **not started**. Begin only after the user explicitly
asks Claude to start updating names.

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
10. Keep `shortest` recognizable and evidence-backed. Do not invent utility
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
- Update the progress section in this file after every completed chunk.
- Do not edit renderer TypeScript/CSS, coordinates, roles, weights, map combines,
  area aliases, or supplemental organization definitions.
- Do not perform long-name spelling/capitalization corrections in source data;
  record them in `review_notes` for a separately scoped pass.
- Do not deploy unless the user explicitly requests deployment.
- Preserve unrelated working-tree changes.

If evidence is inconclusive, do not guess. Leave the record unapproved, explain
the blocker in `review_notes`, and count it under `Blocked` below.

## Chunk and commit protocol

Work in ten fixed chunks of 50 queue rows:

| Chunk | Queue orders | Status | Approved | Blocked |
| --- | ---: | --- | ---: | ---: |
| 1 | 1-50 | Not started | 0 | 0 |
| 2 | 51-100 | Not started | 0 | 0 |
| 3 | 101-150 | Not started | 0 | 0 |
| 4 | 151-200 | Not started | 0 | 0 |
| 5 | 201-250 | Not started | 0 | 0 |
| 6 | 251-300 | Not started | 0 | 0 |
| 7 | 301-350 | Not started | 0 | 0 |
| 8 | 351-400 | Not started | 0 | 0 |
| 9 | 401-450 | Not started | 0 | 0 |
| 10 | 451-500 | Not started | 0 | 0 |

After each chunk:

1. Update its row in the table.
2. Update the batch summary below.
3. Validate JSON parsing and duplicate IDs.
4. Run the required checks.
5. Commit and push that coherent 50-record change.

Do not mark a chunk complete merely because 50 records were attempted. Its
`Approved + Blocked` total must equal 50.

## Validation

After each 50-record chunk:

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

- Batch status: Not started
- Completed records: 0 / 500
- Approved records: 0
- Blocked records: 0
- Next queue order: 1
- Last completed `ncr_id`: None
- Last update: 2026-06-18
- Notes: Batch manifest pinned; no organization names changed by this setup.
