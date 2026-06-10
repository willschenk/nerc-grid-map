# Map label filler bug — Connecticut Light and Power → "and"

**Status:** Open (documented only; no fix applied)  
**Production baseline:** [gh-pages `c0ca47b`](https://github.com/willschenk/nerc-grid-map/commit/c0ca47ba553f5cd0fe95a75cb77caf6615aa873d) — deployed 2026-06-10, live at https://willschenk.github.io/nerc-grid-map/  
**Decision (2026-06-09):** Keep production behavior exactly as deployed. Do not ship algorithmic or batch label fixes until a minimal, manually reviewed approach is agreed.

---

## Summary

At low zoom, some map bubbles show **meaningless single-word labels** — connectives, generic industry nouns, or ordinals — instead of a recognizable brand token. The map is otherwise considered **flawless** on the current production deploy; this is the one remaining text bug called out for future work.

Typical failures:

| Entity name | Label shown | Why it feels wrong |
|-------------|-------------|-------------------|
| Connecticut Light and Power | `and` | Connective, not a brand |
| Madison Gas and Electric | `and` | Same pattern |
| Hydro One | `One` | Generic ordinal |
| Muscatine Power & Water | `Water` | Generic utility noun |
| *(similar multi-word utility names)* | `Gas`, `Light`, `Power`, `Electric`, … | Industry filler, not distinctive |

These labels appear on **tiny bubbles at low zoom** (and in hover/chip paths that call the same shortening helpers). Full legal names still appear in the sidebar and at higher zoom where space allows.

---

## How labels are produced

There are **two stages** that both call the same core function:

### Build time (`src/lib/nerc/enrich.mjs`)

`compactDisplayName()` writes `name_shortest` into `public/nerc/orgs-render.json` (and related baked output). Priority:

1. `SHORT_NAME_OVERRIDES` — exact `entity_name` match  
2. `KNOWN_ACRONYMS` — prefix match on entity name  
3. `org-names.json` → `shortest` (researched per `ncr_id`)  
4. Algorithm + **`tightenMapLabel()`** in `src/lib/nerc/display-names.mjs`

Hard cap: **`MAP_LABEL_MAX = 8`** characters.

### Runtime (`src/lib/nerc/map/nerc-org-map.ts`)

`tinyName()`, `midName()`, and `labelTextOptions()` may re-apply `tightenMapLabel()` and can prefer curated `NAME_RULES` when those produce a shorter label than baked `name_shortest`.

So a bad label can originate at **build time**, at **runtime**, or **both**.

---

## Root cause

The bug lives in **`tightenMapLabel()`** in `src/lib/nerc/display-names.mjs`.

After stripping trailing industry descriptors (`Electric`, `Power`, `Gas`, `Light`, …) via `stripDescriptorTail()` and `TRAILING_WORD`, the function applies a **“prefer the last word when it is shorter than the first”** rule:

```javascript
// display-names.mjs — simplified excerpt
const parts = stripDescriptorTail(words);
if (parts.length >= 2) {
  const last = parts[parts.length - 1];
  const first = parts[0];
  if (
    last.length >= 3 &&
    last.length <= maxLen &&
    !DESCRIPTOR_TAIL.has(last.toUpperCase()) &&
    last.length < first.length
  ) {
    s = last;  // ← bug: no check that `last` is a meaningful brand token
  }
}
```

**What goes wrong:**

1. **`stripDescriptorTail`** removes `Light`, `Power`, `Gas`, `Electric`, etc. from the end, but leaves connectives like **`and`** and generic tokens like **`One`**, **`Water`**.
2. The **last-word preference** then picks that leftover token because it is shorter than the geographic/brand first word (`Connecticut`, `Madison`, `Hydro`, `Muscatine`).
3. A second path (lines ~126–128) can also prefer **`again.slice(1).join(" ")`** as a tail when the leading word is short — same class of failure for `"X Power & Water"` → `Water`.

`DESCRIPTOR_TAIL` blocks many industry words but **does not block** connectives (`and`, `of`, `the`) or generic nouns (`one`, `water`) when they survive as the final token.

---

## What production has today

Production (`c0ca47b`) ships **without** any filler guard. The algorithm above runs unchanged. Bubble placement, declutter, disclosure, and dot counts on that deploy are **correct and should not be touched** when addressing this bug.

**Local dev note:** `main` HEAD has the map mount `<script>` **outside** `</BaseLayout>`, which can leave the page stuck on “Loading map…” in dev. The production build that produced `c0ca47b` had the script **inside** `BaseLayout` (a small `index.astro` placement fix). That placement change is **not** part of this label bug; it only affects whether local dev matches the working deploy.

---

## Fix attempts (all rejected or reverted)

### 1. Automated short-name batches (batches 1–4)

**Approach:** Script-driven patches to `KNOWN_ACRONYMS`, `NAME_RULES`, and `org-names.json` `shortest` (~100 labels per batch), targeting ugly 8-character truncations (`Greenfie`, `Stillwat`, …) and missing market acronyms.

**Files touched:** `enrich.mjs`, `nerc-org-map.ts`, `org-names.json`, `apply-short-name-batch-*.mjs`, rebuilt `public/nerc/*`.

**Outcome:** **Reverted per user request.** Some fixes were good, but many labels became **worse** or inconsistent. User prefers a **manual curated list** later, not bulk automation.

**Secondary bugs discovered during batches:**

| Issue | Detail |
|-------|--------|
| Batch script append bug | Early script only inserted one `KNOWN` key before `]);`; many intended keys never landed |
| Generic key ordering | e.g. `invenergy` beat site-specific keys until keys used normalized forms and were ordered before the generic prefix |
| `siteLabelFromEntity()` override | Good `org-names` values overridden (e.g. Spruance → `Operatin`); fixed with targeted `KNOWN` entries, not broad algorithm changes |
| `tightenMapLabel` truncating curated names | e.g. `Hattiesbg` (9 chars) → `Hattiesb` when KNOWN value exceeded 8 chars |

### 2. Fix #1 — filler guard in `tightenMapLabel()` (algorithmic)

**Approach:** Add `isFillerLabel()` with a blocklist (`and`, `of`, `the`, `gas`, `water`, `light`, `power`, `one`, …), `recoverLabel()` to pick a distinctive word or initials, and runtime skips in `tinyName()` / `labelTextOptions()` when baked `name_shortest` is filler.

**Files changed (locally, then reverted):**

- `src/lib/nerc/display-names.mjs` — `FILLER_LABELS`, `isFillerLabel`, `recoverLabel`, guards in `tightenMapLabel`
- `src/lib/nerc/map/nerc-org-map.ts` — import `isFillerLabel`, skip filler in label paths

**Outcome:** **Reverted.** User reported local did not match production feel (“not how I like it”) and asked to **keep deployed behavior 100%** and document only.

**Observations:**

- The filler guard **did** correct the specific examples (`and`, `One`, `Water`) in isolation.
- Local regressions (extra tiny background dots, overall density) were traced to **uncommitted data/pipeline WIP** being rebuilt on every `npm run dev` (`predev` → `build-orgs.mjs`), not to the filler guard alone. Restoring committed `public/nerc/*` and data scripts aligned dot counts with HEAD; user still did not want to keep the label fix without full production parity review.

### 3. Per-entity overrides only (partial, in batch work)

**Approach:** Add `KNOWN_ACRONYMS` / `NAME_RULES` entries such as `hydro one` → `Hydro One`, utility-specific acronyms.

**Outcome:** Works for **individual** entities but does not fix the **class** of failures for every `"Geo + Gas and Electric"` pattern without hundreds of manual rows. Not pursued as the sole fix after batch revert.

### 4. Bad deploy rollback (`7b39787` → `c0ca47b`)

**Context:** A later deploy regressed bubble behavior. User force-pushed `gh-pages` back to `c0ca47b`.

**Lesson:** Label and renderer changes must be validated against the **known-good deploy** before any `npm run deploy`. A label-only fix must not ride along with renderer or data pipeline changes.

---

## Recommended direction (future work)

When this bug is picked up again:

1. **Do not resume automated 100-label batches** until the user supplies a manual target list.
2. **Prefer minimal diffs:** either small `KNOWN_ACRONYMS` / `SHORT_NAME_OVERRIDES` for confirmed bad rows, or a **surgical** change to `tightenMapLabel()` that rejects connectives/generic nouns **without** altering bubble layout, declutter, or data pipeline output.
3. **Verify against `c0ca47b`:** compare dot counts, tiny-bubble density, and a fixed set of zoom levels before deploy. Use `?audit` if needed (see `LESSONS.md`).
4. **Display-only discipline:** label fixes should not require changes to `geocoded-orgs.json`, `build-orgs.mjs`, or alternate-location logic unless explicitly requested.
5. **Test cases to keep:** Connecticut Light and Power, Madison Gas and Electric, Hydro One, Muscatine Power & Water; plus digit-preserving labels (`IN1`, `1803`) if touching `recoverLabel()`.

---

## Key files

| File | Role |
|------|------|
| `src/lib/nerc/display-names.mjs` | `tightenMapLabel`, `MAP_LABEL_MAX`, `compressSpacedBrand` |
| `src/lib/nerc/enrich.mjs` | Build-time `name_shortest` via `compactDisplayName` |
| `src/lib/nerc/map/nerc-org-map.ts` | Runtime `tinyName`, `NAME_RULES`, bubble label selection |
| `src/data/nerc/org-names.json` | Researched `shortest` names (manual curation target) |
| `public/nerc/orgs-render.json` | Baked labels consumed at runtime |

---

## Commands

```bash
npm run dev          # local map (rebuilds data via predev)
npm run nerc:build   # rebuild public/nerc/*
npm run nerc:qa      # validate baked output
npm run check        # astro + TypeScript
# npm run deploy     # only when explicitly requested — do not deploy label experiments
```

---

## Changelog for this document

| Date | Note |
|------|------|
| 2026-06-09 | Initial write after reverting local Fix #1; production frozen at `c0ca47b` |
