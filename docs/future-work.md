# Future work & research ideas

A brainstorm backlog for the NERC grid map — things worth doing, researching, or
deciding later. **Nothing here is committed work.** It's a menu to pick from.
Grouped roughly by area, with the highest-leverage / lowest-risk items called out.

---

## 1. Names & map labels (research-heavy)

- [ ] **Resolve the `ALTE` attribution conflict.** `src/data/nerc/area-aliases.json`
  assigns `ALTE` → "ALLETE / Minnesota Power" (NCR00674), but the renderer's
  `MISO_CONTROL_AREA_CODES` and the requested label list treat `ALTE` as Alliant
  Energy East (NCR00961). Determine the correct MISO LBA code (likely Alliant East =
  `ALTE`, ALLETE/Minnesota Power = `MP`) and make the alias data + renderer agree.
  Until then NCR00961 keeps a non-conflicting label.
- [ ] **Mobile-friendly label for LIPA.** "Long Island" (11 chars) was requested but
  exceeds the 8-char compact-label budget (`ux-check` fails). Options: keep `LIPA`,
  use a short form (e.g. `LI`), or relax the mobile rule for a small allowlist.
- [ ] **Audit the renderer's hard-coded `MISO_CONTROL_AREA_CODES` / PJM zone sets
  against `area-aliases.json`.** The ALTE drift suggests the two sources have diverged;
  reconcile to one source of truth.
- [ ] **Confirm "missing" area orgs.** Carolina Power & Light East/West (`CPLE`/`CPLW`)
  and Michigan Electric Coordinated System (`MECS`) had no matching registrations —
  verify they're truly folded into successors (Duke Energy Progress, etc.) and not
  just unmatched.
- [ ] **Continue the name-curation queue** (`src/data/nerc/name-queue.jsonl`,
  `docs/standards/name-shortest.md`) — many orgs still use algorithmic acronyms.

## 2. Data quality & combines

- [ ] **Sweep for other co-located registrations to combine** (the Virginia Power →
  Dominion fold is one example). Same-entity rows at one HQ should be one map bubble.
- [ ] **Decide on plant-site registrations** (e.g. Dominion's North Anna nuclear) —
  keep as distinct facilities (current behavior) or fold into the parent bubble.
- [ ] **Work the 24 QA warnings** from `npm run nerc:qa` (shared-coordinate clusters,
  confidence, etc.).
- [ ] **Geocoding confidence**: raise MEDIUM → HIGH where a better source exists;
  resolve the remaining LOW record.
- [ ] **Refresh the registry** from the latest official NERC Compliance Registry
  export and re-run the ingest → build → QA pipeline.

## 3. Give-way dot layer (GO/GOP generators)

- [ ] **Per-device tuning** of `GIVE_WAY_DOT_REVEAL_K`, size, and the org/dot gaps;
  validate on real phones, not just emulated viewports.
- [ ] **Dense-cluster handling**: when too many dots box each other out, consider
  light clustering / a count badge instead of hiding individual dots.
- [ ] **Dot labels on hover/zoom**: a tiny inline acronym at deep zoom so a dot is
  identifiable before clicking.

## 4. Map interaction & UX

- [ ] **Search / filter** (by name, role, region, market) to jump to an org.
- [ ] **On-map legend / key** for bubble colors (role sets), the saber ring, and the
  give-way dots.
- [ ] **Deep-zoom hit-test staleness**: after an *animated* zoom the cached `_sx/_sy`
  can lag for a frame; `nearestOrgAtPointer` now reprojects live, but audit other
  click/hover paths for the same staleness.
- [ ] **Accessibility**: keyboard navigation between bubbles, ARIA on the detail
  panel, reduced-motion coverage, color-contrast pass.
- [ ] **Shareable deep links** (org/zoom/center in the URL).

## 5. PJM / MISO focus mode

- [ ] **Extend focus families** beyond PJM/MISO (SPP, ISO-NE, NYISO) once the
  membership data is curated — the code is generic via `marketFamily`.
- [ ] **Area-pill coverage audit**: confirm every PJM zone / MISO LBA org shows the
  right classification pill.

## 6. Tooling & tech debt

- [ ] **Consolidate the `scripts/perf/*.mjs` CDP harnesses** (focus-test, verify-fixes,
  verify-giveway-dots, ad-hoc /tmp scripts) into one driver with shared setup.
- [ ] **CI**: run `npm run check`, `nerc:qa`, `ux-check`, and the CDP suites on PRs.
- [ ] **Document the build pipeline** end-to-end (ingest → enrich → build-orgs →
  payload split → render) for new contributors.

---

### Suggested near-term order

1. Reconcile `ALTE` / MISO-code source-of-truth (unblocks correct area labels).
2. Co-located-registration combine sweep (clear data-quality wins).
3. On-map legend + search (biggest user-facing UX gains).
4. Registry data refresh.
