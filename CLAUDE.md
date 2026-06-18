# Claude project handoff

Read [AGENTS.md](AGENTS.md), [LESSONS.md](LESSONS.md), and
[the naming standard](docs/standards/name-shortest.md) before changing names.

## Name review

Use these files:

- `scripts/nerc/name-review-first-500.md`: remaining work
- `src/data/nerc/name-queue.jsonl`: research context
- `src/data/nerc/org-names.json`: file to edit

The first 20 records are complete. The worklist starts at order 21.

For each run:

1. Take the first 20 lines from `scripts/nerc/name-review-first-500.md`.
2. Research each organization's real alias, acronym, or shortest meaningful
   name.
3. Update the matching `ncr_id` in `src/data/nerc/org-names.json`.
4. Keep the existing name changes. Do not edit map code, coordinates, roles, or
   weights.
5. Delete each completed line from the worklist.
6. Leave a line in place when the name cannot be determined.
7. Run the validation commands below.
8. Commit and push the 20-name batch.

An `org-names.json` entry may contain:

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
  "shortest_source_url": "https://www.pjm.com/"
}
```

Do not add review statuses, dates, or notes.

Allowed `shortest_type` values:

- `alias_code`
- `acronym`
- `parent_project`
- `meaningful_name`
- `location`

Validation:

```bash
node -e 'const d=require("./src/data/nerc/org-names.json"); const ids=d.names.map(x=>x.ncr_id); if(ids.length!==new Set(ids).size) process.exit(1)'
npm run nerc:build
npm run nerc:payload-check
npm run ux-check
npm run check
```

Do not run `npm run nerc:name-queue` during this pinned batch. Do not deploy
unless the user explicitly asks.
