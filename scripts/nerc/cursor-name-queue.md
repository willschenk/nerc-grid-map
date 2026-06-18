# Organization-label standards review queue

Use this workflow to review `name_shortest` one organization at a time without
changing map visibility, placement, or source coordinates.

Read [the authoritative naming standard](../../docs/standards/name-shortest.md)
before editing labels.

## Queue coverage

`npm run nerc:name-queue` writes:

- `src/data/nerc/name-queue.jsonl`
- `src/data/nerc/name-queue.csv`

The queue contains every unapproved source record, including:

- published organizations
- organizations currently hidden by zoom disclosure
- registrations folded into a combined map bubble
- retired seed records
- supplemental and source-only records

Records are never deduplicated by entity name. Every `ncr_id` can be reviewed.
Issue flags and high-weight published organizations sort first.
`rendered_shortest` shows the currently published compact token when the record
has its own map bubble; `current.shortest` is the researched/source value to edit.

`npm run nerc:name-queue-all` includes approved records for a full audit.

## Review one record

1. Take the first queue row you want to review.
2. Research the real alias/code or acronym using the sources in the standard.
3. Find the matching `ncr_id` in `src/data/nerc/org-names.json`.
4. Update or append one object. Keep `entity_name` exactly aligned with the source
   record.
5. Fill the review metadata and set `review_status` to `approved`.

Example:

```json
{
  "ncr_id": "NCR00879",
  "entity_name": "PJM Interconnection, LLC",
  "shortest": "PJM",
  "short": "PJM Interconnection",
  "normal": "PJM Interconnection, LLC",
  "tier": "major",
  "shortest_type": "alias_code",
  "shortest_source": "official_website",
  "shortest_source_url": "https://www.pjm.com/",
  "review_notes": "PJM is the organization's established operating name.",
  "review_status": "approved",
  "reviewed_at": "2026-06-18"
}
```

Allowed `shortest_type` values:

- `alias_code`
- `acronym`
- `parent_project`
- `meaningful_name`
- `location`

Suggested `shortest_source` values:

- `official_website`
- `nerc_record`
- `oasis`
- `iso_rto_material`
- `public_filing`
- `press_release`
- `area_alias`
- `inferred`

Use `review_notes` for inferred labels, collision distinctions, parent/project
patterns, and any actual alias longer than 15 characters.

## Name tiers

| Field | Purpose |
| --- | --- |
| `shortest` | Researched map label governed by the naming standard |
| `short` | Short readable brand form |
| `normal` | Full brand or near-legal name |
| `tier` | `major` pins the organization to its shortest form; otherwise `normal` |

The renderer may derive a tighter token when a researched label does not fit the
current bubble. Do not replace a real alias with an invented code to satisfy that
temporary render constraint.

## Regenerate and verify

After each coherent review batch:

```bash
npm run nerc:name-queue
npm run nerc:build
npm run nerc:payload-check
npm run ux-check
npm run check
```

Approved records with complete metadata leave the default queue. Queue generation
does not edit `org-names.json` or any organization name.
