# Future work & research ideas

A brainstorm backlog for the NERC grid map — research, data-quality, and
correctness work worth doing later. **Nothing here is committed work**, and this
list is intentionally scoped to *improving what already exists* — not adding new
UI features. Grouped by area; highest-leverage items first within each.

The bulk research items (names, locations, combines) are meant to be run through
Cursor in batches — see **`docs/cursor-research-prompts.md`** for ready-to-paste
prompts.

---

## 1. Names & map labels (research-heavy)

- [ ] **Resolve the `ALTE` attribution conflict.** `src/data/nerc/area-aliases.json`
  assigns `ALTE` → "ALLETE / Minnesota Power" (NCR00674), but the renderer's
  `MISO_CONTROL_AREA_CODES` and the requested label list treat `ALTE` as Alliant
  Energy East (NCR00961). Determine the correct MISO LBA code (likely Alliant East =
  `ALTE`, ALLETE/Minnesota Power = `MP`) and make the alias data + renderer agree.
- [ ] **Reconcile the renderer's hard-coded `MISO_CONTROL_AREA_CODES` / PJM zone sets
  against `area-aliases.json`.** The ALTE drift shows the two sources have diverged;
  pick one source of truth and make them match.
- [ ] **Confirm the "missing" area orgs.** Carolina Power & Light East/West
  (`CPLE`/`CPLW`) and Michigan Electric Coordinated System (`MECS`) had no matching
  registration — verify they're truly folded into successors (Duke Energy Progress,
  etc.) and not just unmatched.
- [ ] **Work the `name-queue.csv` collisions.** Many rows carry `duplicate_label` /
  `nearby_label_collision` issues; research the correct distinguishing `shortest`
  per `docs/standards/name-shortest.md`.
- [ ] **Note:** `NIPS` and `CIN` were set by explicit user request even though
  `name-shortest.md` prefers `NIPSCO` and flags `CIN` as an unverified legacy
  planning-area code. If revisiting the standard, decide which wins.

## 2. Data quality & combines

- [ ] **Sweep for co-located registrations to combine** (the Virginia Power →
  Dominion fold is one example). Same-entity rows at one HQ should be one map bubble.
  Use `location-queue.csv` (shared-coordinate clusters) as the starting list.
- [ ] **Decide on plant-site registrations** (e.g. Dominion's North Anna nuclear) —
  keep as distinct facilities (current behavior) or fold into the parent bubble.
- [ ] **Work the QA warnings** from `npm run nerc:qa` (shared-coordinate clusters,
  confidence, etc.).
- [ ] **Refresh the registry** from the latest official NERC Compliance Registry
  export and re-run ingest → build → QA.

## 3. Give-way dot layer (GO/GOP generators)

- [ ] **Per-device tuning** of `GIVE_WAY_DOT_REVEAL_K`, size, and the org/dot gap
  constants; validate on real phones, not just emulated viewports.
- [ ] **Dense-cluster handling**: when too many dots box each other out and hide,
  decide whether light clustering or a count indicator beats hiding individuals.

## 4. Map polish & correctness (existing behavior only)

- [ ] **Deep-zoom hit-test staleness**: after an *animated* zoom the cached
  `_sx/_sy` can lag for a frame; `nearestOrgAtPointer` now reprojects live, but audit
  other click/hover paths for the same staleness.
- [ ] **Accessibility polish** of what exists: ARIA on the detail panel, color
  contrast, and full `prefers-reduced-motion` coverage.

## 5. PJM / MISO focus mode

- [ ] **Extend focus families** to SPP / ISO-NE / NYISO once membership data is
  curated — the code is generic via `marketFamily`, so this is mostly data.
- [ ] **Area-pill coverage audit**: confirm every PJM zone / MISO LBA org shows the
  correct classification pill.

## 6. Tooling & tech debt

- [ ] **Consolidate the `scripts/perf/*.mjs` CDP harnesses** (focus-test,
  verify-fixes, verify-giveway-dots) into one driver with shared setup.
- [ ] **CI**: run `npm run check`, `nerc:qa`, `ux-check`, and the CDP suites on PRs.
- [x] **Document the build pipeline** end-to-end — done: see
  `docs/build-pipeline.md`.

---

### Suggested near-term order

1. Reconcile `ALTE` / MISO-code source-of-truth (unblocks correct area labels).
2. Co-located-registration combine sweep (clear data-quality wins).
3. Work the `name-queue.csv` collisions in Cursor batches.
4. Registry data refresh.
