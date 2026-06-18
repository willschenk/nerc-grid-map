# Organization name review

Read `docs/standards/name-shortest.md`.

## Repeatable AI task

1. Take the first 20 lines from `scripts/nerc/name-review-first-500.md`.
2. Use `src/data/nerc/name-queue.jsonl` for organization context.
3. Research the real alias, acronym, or shortest meaningful name.
4. Update the matching `ncr_id` in `src/data/nerc/org-names.json`.
5. Delete each completed line from `scripts/nerc/name-review-first-500.md`.
6. Leave uncertain records in the worklist.
7. Validate, commit, and push.

Keep each organization entry simple:

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

Do not add review statuses, dates, or notes. Do not edit map behavior,
coordinates, roles, weights, or generated files under `public/nerc/`.

Validation:

```bash
node -e 'const d=require("./src/data/nerc/org-names.json"); const ids=d.names.map(x=>x.ncr_id); if(ids.length!==new Set(ids).size) process.exit(1)'
npm run nerc:build
npm run nerc:payload-check
npm run ux-check
npm run check
```
