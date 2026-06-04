# Cursor research queue — three-tier display names, one entity at a time

This is the hand-off for researching short display names for NERC entities. Each
entity gets THREE name tiers so the map can pick the right length for the zoom /
dot size:

| tier        | what it is                          | examples                                   |
|-------------|-------------------------------------|--------------------------------------------|
| `shortest`  | the bare acronym                    | `PJM`, `CE`, `ERCOT`, `MISO`               |
| `short`     | a short readable form               | `PJM Interconnection`, `Consumers`, `CAISO`|
| `normal`    | the full brand / near-legal name    | `PJM Interconnection, LLC`, `Consumers Energy` |

Plus a `tier` flag: set it to `"major"` for the biggest, most recognizable
entities (the ISOs/RTOs and the largest utilities). **A `"major"` entity is
pinned to its `shortest` acronym at every zoom level** — e.g. PJM only ever
renders as `PJM` on the map, never "PJM Interconnection". For everyone else use
`tier: "normal"`; the map balances `shortest` vs `short` based on space.

## What to do (one entity per run — this prompt is queued ~100x)

1. Open **`src/data/nerc/name-queue.jsonl`** — one entity per line, already in the
   research input shape: `{ncr_id, entity_name, acronym, region, roles, weight, is_iso_rto}`.
   It is ordered **biggest/most-important first**, so just take the FIRST entity
   whose `ncr_id` is not already in `org-names.json`.
2. Research that entity (its common acronym and brand name — name + region is
   enough; 100% source accuracy is not required). Decide all three tiers:
   - `shortest`: the tightest acronym people actually use. Keep it ≤ ~6 chars when
     you can. If there's no real acronym, use the shortest recognizable token
     (e.g. `Consumers` → `CE`? only if it's genuinely used; otherwise `Consumers`).
   - `short`: short but readable, drop legal suffixes (`Inc.`, `LLC`, `Company`).
   - `normal`: the full brand name (legal suffix optional, keep it natural).
   - `tier`: `"major"` if `is_iso_rto` is true OR `weight >= 30` OR it's a
     nationally-known utility; otherwise `"normal"`.
3. Append ONE object to the `"names"` array in **`src/data/nerc/org-names.json`**:
   ```json
   {
     "ncr_id": "NCR00879",
     "entity_name": "PJM Interconnection, LLC",
     "shortest": "PJM",
     "short": "PJM Interconnection",
     "normal": "PJM Interconnection, LLC",
     "tier": "major"
   }
   ```
   - **Echo `ncr_id` and `entity_name` exactly** from the queue line.
   - Do not edit or reorder existing entries; only append.
4. After every ~25–50 entities run `npm run nerc:build` to fold the names into
   `public/nerc/orgs.json` and confirm the build is clean.

## Re-generating the queue

`node scripts/nerc/build-name-queue.mjs` recomputes "geocoded minus already-named",
so finished entities drop off automatically and the heaviest unnamed ones float to
the top. `name-queue.csv` is the same list, human-readable.

## IDs: use the queue's id, not a seed id

Some big entities (PJM, ERCOT, CAISO…) exist as both a placeholder `NCR-SEED-xxx`
row and their real `NCRxxxxx` registry row. The queue already lists the **real**
id and dedupes the seed away — always key `org-names.json` by the `ncr_id` printed
in `name-queue.jsonl`. (The seed retires itself once the real row is present.)
