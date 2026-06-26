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

- [ ] **Work names from the largest / highest-impact organizations first.** Start
  with major ISOs/RTOs, BAs, RCs, TOPs, large utilities, and high-weight orgs before
  small GO/GOP records. Confirm their `shortest`, `short`, and `normal` values follow
  `docs/standards/name-shortest.md`, and verify the rendered size feels reasonable
  relative to role weight and importance.
- [ ] **Audit organization size/rank consistency.** Look for cases where an org with
  fewer or less important roles renders larger than an org with more or higher-value
  roles. Fix ranking, weight, tier, or display metadata only where the current sizing
  is clearly unreasonable; do not add new UI behavior.
- [ ] **Prioritize project-owner supplied acronyms and mappings.** User-provided
  values such as `CIN`, `YAD`, and other known-good labels supplied from personal
  experience are priority evidence. Treat them as valid unless they were explicitly
  marked uncertain, likely combined, not found, or needing verification.
- [ ] **Resolve the `ALTE` attribution conflict.** `src/data/nerc/area-aliases.json`
  assigns `ALTE` → "ALLETE / Minnesota Power" (NCR00674), but the renderer's
  `MISO_CONTROL_AREA_CODES` and the requested label list treat `ALTE` as Alliant
  Energy East (NCR00961). Determine the correct MISO LBA code using the current
  standard: project-owner supplied mappings first, then official/authoritative
  sources. Make the alias data + renderer agree.
- [ ] **Reconcile the renderer's hard-coded `MISO_CONTROL_AREA_CODES` / PJM zone sets
  against `area-aliases.json`.** The ALTE drift shows the two sources have diverged;
  pick one source of truth and make them match. Preserve known-good project-owner
  area labels when they exist.
- [ ] **Confirm the "missing" area orgs.** Carolina Power & Light East/West
  (`CPLE`/`CPLW`) and Michigan Electric Coordinated System (`MECS`) had no matching
  registration — verify whether they are folded into successors, represented by a
  different current registration, or simply unmatched.
- [ ] **Work the `name-queue.csv` collisions.** Many rows carry `duplicate_label` /
  `nearby_label_collision` issues; research the correct distinguishing `shortest`
  per `docs/standards/name-shortest.md`. Prefer official/project-owner acronyms,
  then parent/project + useful suffix, then readable place/project labels.
- [ ] **Review legacy vs canonical name mappings under the current standard.** Do not
  treat user-provided values as second-class legacy codes. A canonical public acronym
  can replace a stale legacy format, but a project-owner supplied known-good mapping
  wins when no stronger contrary evidence exists.

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

1. Review largest / highest-impact organizations first, including size/rank sanity.
2. Reconcile `ALTE` / MISO-code source-of-truth using project-owner mappings first.
3. Co-located-registration combine sweep.
4. Work the `name-queue.csv` collisions in Cursor batches.
5. Registry data refresh.
