# Research proposals (Cursor output)

Cursor's batch-research prompts (see `docs/cursor-research-prompts.md`) append
their findings to CSV files **in this folder** — never directly to the real
source data. That keeps the build safe regardless of model mistakes.

Expected files (created on demand):

- `name-proposals.csv` — proposed `name_shortest` labels.
- `combine-proposals.csv` — same-entity co-location combine candidates.
- `area-code-proposals.csv` — MISO/PJM area-code → org checks.

A human reviews these, then applies the verified rows
(`needs_review = no`, `confidence = high`) to the real source files
(`org-names.json`, `map-combines.json`, `area-aliases.json`) and runs
`npm run nerc:build && npm run nerc:qa && npm run ux-check && npm run check`.

These CSVs are working scratch output; they can be cleared once applied.
